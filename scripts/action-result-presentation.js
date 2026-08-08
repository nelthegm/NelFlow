/**
 * Compact action / immunity result presentation (0.14.1).
 *
 * Presentation only — never applies Frightened, Demoralize immunity, Trip,
 * Grapple, or other action effects.
 *
 * Audit notes:
 * - "Unknown (Cyclops Zombie)" is produced by Workbench / Asymonous Benefactor
 *   Demoralize macros as `Unknown <span data-visibility="gm">(token.name)</span>`.
 *   NelFlow compact UI resolves visible token names from structured UUIDs and
 *   never reproduces that parenthetical GM leak pattern for players.
 * - "Click to apply effects and immunity" is a Workbench compendium macro link
 *   that applies Frightened and/or Demoralize Immunity CD depending on outcome.
 *   It remains accessible via Details; NelFlow never auto-clicks it.
 */

import { MODULE_ID } from "./constants.js";
import { getActionDefinition } from "./nelcine-action-definitions.js";
import { inspectPf2eActionCheckMessage } from "./nelcine-action-bridge.js";
import { plainNoteText, extractContextNotes, noteVisibleToCurrentUser } from "./strike-riders.js";

const MAX_RECENT = 40;
const DEGREES = Object.freeze({
  criticalFailure: "Critical Failure",
  failure: "Failure",
  success: "Success",
  criticalSuccess: "Critical Success",
});

/** @type {object[]} */
const recentActionPresentations = [];
/** @type {((summary: object) => void)|null} */
let actionWatcher = null;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function localize(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch {
    return key;
  }
}

/**
 * Resolve a display-safe target name from structured UUIDs.
 * Never blindly replaces the literal string "Unknown".
 * Never leaks a hidden token name to players.
 *
 * @param {{ tokenUuid?: string|null, actorUuid?: string|null, recordedName?: string|null }} input
 * @returns {{ name: string|null, visible: boolean, source: string }}
 */
export function resolveActionTargetDisplay(input = {}) {
  const tokenUuid = safeString(input.tokenUuid);
  const actorUuid = safeString(input.actorUuid);
  const recorded = safeString(input.recordedName);

  let tokenDoc = null;
  let actor = null;
  try {
    if (tokenUuid && typeof fromUuidSync === "function") {
      tokenDoc = fromUuidSync(tokenUuid, { strict: false });
    }
  } catch {
    tokenDoc = null;
  }
  try {
    if (!tokenDoc?.actor && actorUuid && typeof fromUuidSync === "function") {
      actor = fromUuidSync(actorUuid, { strict: false });
    } else {
      actor = tokenDoc?.actor ?? null;
    }
  } catch {
    actor = null;
  }

  const rawName = safeString(tokenDoc?.name) ?? safeString(actor?.name) ?? recorded;
  if (!rawName) {
    return { name: null, visible: false, source: "missing" };
  }

  // Never emit document handles.
  if (typeof rawName !== "string") {
    return { name: null, visible: false, source: "invalid" };
  }

  const nameVisibilityEnabled = Boolean(game.pf2e?.settings?.tokens?.nameVisibility);
  const playersCanSee = tokenDoc?.playersCanSeeName === true;
  const isGm = game.user?.isGM === true;
  const isOwner = Boolean(actor?.isOwner || tokenDoc?.isOwner);

  if (isGm || isOwner || !nameVisibilityEnabled || playersCanSee) {
    return { name: rawName, visible: true, source: "structured-visible" };
  }

  return {
    name: localize("Nelflow.Roll.HiddenTarget"),
    visible: false,
    source: "privacy-hidden",
  };
}

/**
 * Detect authoritative immunity statements for an action check.
 * Prefer structured notes / flags. Do not invent from action name alone.
 *
 * @param {ChatMessage} message
 * @param {object} inspection
 * @returns {{ immune: boolean, traits: string[], source: string|null, controlPreserved: boolean }}
 */
export function detectActionImmunity(message, inspection = {}) {
  const traits = [];
  let source = null;

  // 1) Structured PF2e context notes visible to the viewer.
  for (const note of extractContextNotes(message)) {
    if (!noteVisibleToCurrentUser(note)) continue;
    const title = (plainNoteText(note.title) ?? "").toLowerCase();
    const text = (plainNoteText(note.text) ?? "").toLowerCase();
    const blob = `${title} ${text}`;
    if (!/\bimmune\b|\bimmunity\b|\bunaffected\b/.test(blob)) continue;
    source = "context-notes";
    const match = blob.match(/immune(?:\s+to)?\s+([a-z0-9-]+)/i);
    if (match?.[1]) traits.push(match[1].toUpperCase());
  }

  // 2) Known module flag shapes (Workbench / Benefactor macros) when present.
  const demoralizeFlag = message?.flags?.demoralize ?? message?.flags?.["xdy-pf2e-workbench"]?.demoralize;
  if (demoralizeFlag && typeof demoralizeFlag === "object") {
    const immune = demoralizeFlag.immune === true || demoralizeFlag.isImmune === true;
    const trait = safeString(demoralizeFlag.trait ?? demoralizeFlag.immunity ?? demoralizeFlag.immuneTrait);
    if (immune || trait) {
      source = source ?? "module-flag";
      if (trait) traits.push(trait.toUpperCase());
      else if (immune) traits.push("MENTAL");
    }
  }

  // 3) Presentation-only mirror of already-visible immunity labels in content.
  // Never used to apply effects; only classifies display when notes/flags absent.
  if (!traits.length && message?.content && typeof message.content === "string") {
    const content = message.content;
    if (/Immune\s+to/i.test(content) || /data-immunity/i.test(content)) {
      const matches = [...content.matchAll(/Immune\s+to\s*(?:<\/?[^>]+>\s*)*([A-Za-z][A-Za-z0-9-]*)/gi)];
      for (const match of matches) {
        if (match[1]) traits.push(match[1].toUpperCase());
      }
      if (traits.length) source = "content-label";
    }
  }

  const unique = [...new Set(traits.filter(Boolean))];
  // Workbench apply-effects macro remains a required manual step in uncertain
  // and success paths; always preserve Details access.
  return {
    immune: unique.length > 0,
    traits: unique,
    source,
    controlPreserved: true,
  };
}

/**
 * Detect whether the message content hosts an apply-effects control / macro link.
 * Presentation awareness only — never clicks it.
 * @param {ChatMessage} message
 * @param {HTMLElement|null} html
 */
export function detectApplyEffectsControl(message, html = null) {
  const content = typeof message?.content === "string" ? message.content : "";
  const fromContent =
    /Click to apply effects and immunity/i.test(content) ||
    /Click to apply all effects/i.test(content) ||
    /Demoralize Immunity CD/i.test(content) ||
    /xdy-pf2e-workbench/i.test(content);

  let fromDom = false;
  if (html && typeof HTMLElement !== "undefined" && html instanceof HTMLElement) {
    fromDom = Boolean(
      html.querySelector(
        [
          'a[data-uuid*="xdy-pf2e-workbench"]',
          'a.content-link[data-type="Macro"]',
          'button[data-action="apply-effect"]',
          ".nelflow-action-native-detail a",
        ].join(","),
      ) || /Click to apply effects/i.test(html.textContent ?? ""),
    );
  }

  if (!fromContent && !fromDom) {
    return { present: false, owner: null, label: null };
  }
  return {
    present: true,
    owner: fromContent || /xdy-pf2e-workbench/i.test(content) ? "xdy-pf2e-workbench" : "pf2e-or-module",
    label: "apply-effects-immunity",
  };
}

function degreeLabel(degree) {
  if (!degree || !DEGREES[degree]) return null;
  try {
    const keys = {
      criticalFailure: "Nelflow.Outcome.CriticalFailure",
      failure: "Nelflow.Outcome.Failure",
      success: "Nelflow.Outcome.Success",
      criticalSuccess: "Nelflow.Outcome.CriticalSuccess",
    };
    return localize(keys[degree]);
  } catch {
    return DEGREES[degree];
  }
}

function rememberActionPresentation(entry) {
  recentActionPresentations.unshift(entry);
  while (recentActionPresentations.length > MAX_RECENT) recentActionPresentations.pop();
  if (typeof actionWatcher === "function") {
    try {
      actionWatcher(entry);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Build a presentation-safe summary for diagnostics / UI.
 * @param {ChatMessage} message
 * @param {HTMLElement|null} html
 */
export function inspectActionResultPresentation(message, html = null) {
  const inspection = inspectPf2eActionCheckMessage(message);
  if (!inspection?.supported) {
    return {
      supported: false,
      reason: inspection?.reason ?? "unsupported",
      messageId: safeString(message?.id),
    };
  }

  const target = resolveActionTargetDisplay({
    tokenUuid: inspection.targetTokenUuid,
    actorUuid: inspection.targetActorUuid,
  });
  const immunity = detectActionImmunity(message, inspection);
  const control = detectApplyEffectsControl(message, html);
  const definition = getActionDefinition(inspection.slug);

  const summary = {
    supported: true,
    messageId: safeString(message.id),
    actionSlug: inspection.slug,
    actionName: definition?.name ?? inspection.slug,
    degree: inspection.degree,
    targetName: target.name,
    targetVisible: target.visible,
    targetSource: target.source,
    immune: immunity.immune,
    immunityTraits: immunity.traits,
    immunitySource: immunity.source,
    controlPresent: control.present,
    controlOwner: control.owner,
    controlLabel: control.label,
    controlPreserved: true,
    nativeCollapsed: false,
    detailsRetained: true,
  };
  rememberActionPresentation(summary);
  return summary;
}

function setActionExpanded(html, expanded) {
  html.classList.toggle("nelflow-action-collapsed", !expanded);
  const button = html.querySelector(":scope > .nelflow-action-summary .nelflow-action-details");
  if (!button) return;
  const label = localize(expanded ? "Nelflow.Native.HideDetails" : "Nelflow.Native.ShowDetails");
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", label);
  button.title = label;
  const text = button.querySelector("span");
  if (text) text.textContent = label;
}

/**
 * Compact a supported PF2e action check card when safe.
 * Always retains Details expansion for native/Workbench controls.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 * @returns {boolean}
 */
export function renderActionResultPresentation(message, html) {
  if (!(html && typeof HTMLElement !== "undefined" && html instanceof HTMLElement)) return false;
  if (html.querySelector(":scope > .nelflow-action-summary")) return true;
  if (!message?.visible || !message.isContentVisible) return false;
  // Do not compete with Strike stacks / save resolvers.
  if (message.getFlag?.(MODULE_ID, "stack")) return false;
  if (message.getFlag?.(MODULE_ID, "transaction")) return false;
  if (message.getFlag?.(MODULE_ID, "saveResolver")) return false;

  const inspection = inspectPf2eActionCheckMessage(message);
  if (!inspection?.supported) return false;

  const header = Array.from(html.children).find((el) => el.classList.contains("message-header"));
  const content = Array.from(html.children).find((el) => el.classList.contains("message-content"));
  if (!header || !content) return false;

  const summaryInfo = inspectActionResultPresentation(message, html);
  const definition = getActionDefinition(inspection.slug);
  const actionName = (definition?.name ?? inspection.slug ?? "Action").toUpperCase();
  const targetName = summaryInfo.targetName ?? localize("Nelflow.Native.Target");

  const summary = document.createElement("div");
  summary.className = "nelflow-action-summary";
  summary.dataset.nelflowAction = inspection.slug;

  const title = document.createElement("div");
  title.className = "nelflow-action-summary__title";
  const strong = document.createElement("strong");
  strong.textContent = actionName;
  const arrow = document.createElement("span");
  arrow.textContent = " → ";
  const target = document.createElement("span");
  target.className = "nelflow-action-summary__target";
  target.textContent = targetName;
  title.append(strong, arrow, target);

  const result = document.createElement("div");
  result.className = "nelflow-action-summary__result";

  if (summaryInfo.immune) {
    result.classList.add("nelflow-action-summary__result--immune");
    const immune = document.createElement("span");
    immune.className = "nelflow-action-summary__immune";
    immune.textContent = localize("Nelflow.Action.Immune");
    result.append(immune);
    for (const trait of summaryInfo.immunityTraits) {
      const tag = document.createElement("span");
      tag.className = "nelflow-action-summary__trait";
      tag.textContent = trait;
      result.append(tag);
    }
    const none = document.createElement("span");
    none.className = "nelflow-action-summary__none";
    none.textContent = localize("Nelflow.Action.NoEffect");
    result.append(none);
  } else {
    const degree = degreeLabel(inspection.degree);
    if (degree) {
      const deg = document.createElement("span");
      deg.textContent = degree;
      result.append(deg);
    }
  }

  const details = document.createElement("button");
  details.type = "button";
  details.className = "nelflow-action-details nelflow-native-toggle";
  details.title = localize("Nelflow.Native.ShowDetails");
  details.setAttribute("aria-label", localize("Nelflow.Native.ShowDetails"));
  details.setAttribute("aria-expanded", "false");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-chevron-down";
  icon.setAttribute("aria-hidden", "true");
  const detailText = document.createElement("span");
  detailText.textContent = localize("Nelflow.Native.ShowDetails");
  details.append(icon, detailText);
  details.addEventListener("click", () => {
    setActionExpanded(html, html.classList.contains("nelflow-action-collapsed"));
  });

  if (summaryInfo.controlPresent) {
    const controlNote = document.createElement("span");
    controlNote.className = "nelflow-action-summary__control";
    controlNote.textContent = localize("Nelflow.Action.EffectsAvailable");
    controlNote.title = localize("Nelflow.Action.EffectsAvailableHint");
    summary.append(title, result, controlNote, details);
  } else {
    summary.append(title, result, details);
  }

  header.after(summary);
  header.classList.add("nelflow-action-header");
  content.classList.add("nelflow-action-native-detail");
  html.classList.add("nelflow-action-compact", "nelflow-action-collapsed");

  summaryInfo.nativeCollapsed = true;
  summaryInfo.detailsRetained = true;
  return true;
}

export function getRecentActionPresentations() {
  return recentActionPresentations.map((e) => ({ ...e }));
}

export function watchActionResultPresentation() {
  if (actionWatcher) return true;
  actionWatcher = (entry) => {
    if (!entry?.supported) return;
    const target = entry.targetName ? ` → ${entry.targetName}` : "";
    console.debug(`NelFlow | ACTION ${entry.actionName}${target}`);
    if (entry.immune) {
      console.debug(`NelFlow | IMMUNE ${(entry.immunityTraits ?? []).join(", ").toLowerCase()}`);
    }
    if (entry.controlPresent) {
      console.debug(`NelFlow | CONTROL preserved: ${entry.controlLabel ?? "native"}`);
    }
  };
  return true;
}

export function stopWatchingActionResultPresentation() {
  const had = Boolean(actionWatcher);
  actionWatcher = null;
  return had;
}

export function clearActionResultPresentationDiagnostics() {
  recentActionPresentations.length = 0;
  actionWatcher = null;
}

export function installActionResultPresentationApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};
  const existing = root.integrations.nelcineActions ?? {};
  root.integrations.nelcineActions = Object.freeze({
    ...existing,
    inspectPresentation: (messageId) => {
      const message = game.messages?.get?.(messageId);
      return message ? inspectActionResultPresentation(message) : null;
    },
    getRecentPresentations: () => getRecentActionPresentations(),
  });
  root.dev.watchActionResultPresentation = () => watchActionResultPresentation();
  root.dev.stopWatchingActionResultPresentation = () => stopWatchingActionResultPresentation();
}
