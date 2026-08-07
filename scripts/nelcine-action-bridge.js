/**
 * NelCine PF2e combat actionResult bridge (0.13.0 / Slice 4B).
 * Presentation only — never rolls, moves tokens, or applies conditions.
 */

import { SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";
import {
  ACTION_DEFINITIONS,
  detectActionSlugFromOptions,
  getActionDefinition,
  SUPPORTED_ACTION_SLUGS,
} from "./nelcine-action-definitions.js";
import {
  cancelMatchingPendingConditionPresentations,
  clearActionConditionCorrelation,
  inspectActionConditionCorrelation,
  registerRepresentedConsequence,
} from "./nelcine-action-correlation.js";

export const NELCINE_MODULE_ID = "nelcine";
export const ACTION_RESULT_TYPE = "actionResult";

const MAX_RECENT = 40;
const MAX_EMITTED = 80;
const DEGREES = new Set(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** @type {Map<string, number>} */
const emittedKeys = new Map();
/** @type {object[]} */
const recentEvents = [];
/** @type {((summary: object) => void)|null} */
let watcher = null;
let hooksRegistered = false;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {boolean}
 */
export function isAuthoritativeActionEmitter() {
  if (game.user?.isGM !== true) return false;
  const api = game.nelcine;
  if (typeof api?.sync?.isPrimaryGM === "function") return Boolean(api.sync.isPrimaryGM());
  const elected = electProcessingGm(game.users ?? [], game.user.id);
  return elected === game.user.id;
}

/**
 * @returns {object}
 */
export function detectNelcineActionRuntime() {
  const mod = game.modules?.get?.(NELCINE_MODULE_ID);
  const active = mod?.active === true;
  const api = game.nelcine ?? null;
  const broadcast =
    typeof api?.integrations?.nelflow?.broadcastActionResult === "function"
      ? api.integrations.nelflow.broadcastActionResult.bind(api.integrations.nelflow)
      : null;
  const normalize =
    typeof api?.integrations?.nelflow?.normalizeActionResult === "function"
      ? api.integrations.nelflow.normalizeActionResult.bind(api.integrations.nelflow)
      : null;
  return {
    active,
    version: typeof mod?.version === "string" ? mod.version : null,
    broadcast,
    normalize,
    hasBroadcastApi: typeof broadcast === "function",
  };
}

function readActionSettingEnabled() {
  try {
    return getSetting(SETTINGS.NELCINE_ACTION_CINEMATICS) !== false;
  } catch {
    return true;
  }
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function claimActionPresentationKey(key) {
  if (typeof key !== "string" || !key) return false;
  if (emittedKeys.has(key)) return false;
  emittedKeys.set(key, Date.now());
  while (emittedKeys.size > MAX_EMITTED) {
    const oldest = emittedKeys.keys().next().value;
    emittedKeys.delete(oldest);
  }
  return true;
}

function rememberRecent(entry) {
  recentEvents.unshift(entry);
  while (recentEvents.length > MAX_RECENT) recentEvents.pop();
  if (typeof watcher === "function") {
    try {
      watcher(entry);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Extract natural d20 from a CheckRoll when available.
 * @param {object|null|undefined} roll
 * @returns {number|null}
 */
export function extractNaturalFromCheckRoll(roll) {
  if (!roll) return null;
  const dice = Array.isArray(roll.dice) ? roll.dice : [];
  for (const die of dice) {
    if (Number(die?.faces) === 20 && Number.isFinite(Number(die.total))) return Number(die.total);
  }
  const terms = Array.isArray(roll.terms) ? roll.terms : [];
  for (const term of terms) {
    if (Number(term?.faces) === 20 && Number.isFinite(Number(term.total))) return Number(term.total);
    const results = Array.isArray(term?.results) ? term.results : [];
    for (const result of results) {
      if (result?.active === false) continue;
      if (Number.isFinite(Number(result?.result))) return Number(result.result);
    }
  }
  const postRoll = roll?.options?.contextualOptions?.postRoll;
  if (Array.isArray(postRoll)) {
    for (const entry of postRoll) {
      const match = typeof entry === "string" ? entry.match(/^check:total:natural:(\d+)$/) : null;
      if (match) return Number(match[1]);
    }
  }
  return null;
}

/**
 * @param {ChatMessage} message
 * @returns {object|null}
 */
export function inspectPf2eActionCheckMessage(message) {
  if (!message || message.isRoll === false && !message.rolls?.length) {
    // Still allow when rolls exist even if isRoll unset in tests.
  }
  const ctx = message?.flags?.pf2e?.context;
  if (!ctx || typeof ctx !== "object") return null;
  if (ctx.type === "damage-roll" || ctx.type === "damage-taken") return null;
  if (ctx.type === "saving-throw" || ctx.type === "flat-check") return null;

  const options = Array.isArray(ctx.options) ? ctx.options : [];
  // Strikes use strike options without our supported action:slugs.
  if (options.some((o) => o === "attack-roll" || String(o).startsWith("strike:"))) {
    const slug = detectActionSlugFromOptions(options);
    if (slug !== "escape") return null;
  }

  const slug = detectActionSlugFromOptions(options);
  if (!slug) {
    return {
      supported: false,
      reason: "unsupported",
      slug: null,
      contextType: ctx.type ?? null,
    };
  }

  const definition = getActionDefinition(slug);
  if (!definition) {
    return { supported: false, reason: "unsupported", slug, contextType: ctx.type ?? null };
  }

  const degree = DEGREES.has(ctx.outcome) ? ctx.outcome : null;
  const roll = Array.isArray(message.rolls) ? message.rolls[0] : null;
  const dcVisible = ctx.dc?.visible !== false;
  const dcValue = safeNumber(ctx.dc?.value);
  const statistic =
    safeString(message.flags?.pf2e?.modifierName) ??
    (() => {
      const hit = options.find((o) => typeof o === "string" && o.startsWith("check:statistic:"));
      return hit ? hit.slice("check:statistic:".length) : null;
    })();

  return {
    supported: true,
    reason: null,
    slug,
    definition,
    contextType: ctx.type ?? null,
    degree,
    statistic,
    natural: extractNaturalFromCheckRoll(roll),
    modifier: safeNumber(roll?.options?.totalModifier),
    total: safeNumber(roll?.total),
    dc: dcVisible ? dcValue : null,
    dcPublic: dcVisible && dcValue != null,
    sourceActorUuid: safeString(ctx.origin?.actor),
    sourceTokenUuid: safeString(ctx.origin?.token),
    targetActorUuid: safeString(ctx.target?.actor),
    targetTokenUuid: safeString(ctx.target?.token),
    messageId: safeString(message.id),
    options,
  };
}

/**
 * Build display-safe actionResult payload.
 * @param {object} input
 * @returns {object|null}
 */
export function buildActionResultPayload(input = {}) {
  const transactionId = safeString(input.transactionId);
  const slug = safeString(input.action?.slug) ?? safeString(input.slug);
  if (!transactionId || !slug) return null;
  const definition = getActionDefinition(slug);
  const degree = DEGREES.has(input.check?.degree) ? input.check.degree : null;

  const payload = {
    schemaVersion: 1,
    type: ACTION_RESULT_TYPE,
    transactionId,
    source: null,
    target: null,
    action: {
      slug,
      name: safeString(input.action?.name) ?? definition?.name ?? slug,
      img: safeString(input.action?.img),
    },
    category: safeString(input.category) ?? definition?.category ?? null,
    check: {
      statistic: safeString(input.check?.statistic),
      natural: safeNumber(input.check?.natural),
      modifier: safeNumber(input.check?.modifier),
      total: safeNumber(input.check?.total),
      dc: null,
      dcPublic: false,
      degree,
    },
    consequences: [],
    detail: safeString(input.detail),
    sceneId: safeString(input.sceneId),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };

  if (input.check?.dcPublic === true && Number.isFinite(input.check?.dc)) {
    payload.check.dc = Number(input.check.dc);
    payload.check.dcPublic = true;
  }

  if (input.source && typeof input.source === "object") {
    payload.source = {
      actorUuid: safeString(input.source.actorUuid),
      tokenUuid: safeString(input.source.tokenUuid),
      name: safeString(input.source.name),
      img: safeString(input.source.img),
    };
  }
  if (input.target && typeof input.target === "object") {
    payload.target = {
      actorUuid: safeString(input.target.actorUuid),
      tokenUuid: safeString(input.target.tokenUuid),
      name: safeString(input.target.name),
      img: safeString(input.target.img),
    };
  } else if (input.target === null) {
    payload.target = null;
  }

  if (Array.isArray(input.consequences)) {
    for (const entry of input.consequences) {
      const label = safeString(entry?.label);
      const cSlug = safeString(entry?.slug);
      if (!label && !cSlug) continue;
      const consequence = {
        slug: cSlug,
        label: label ?? cSlug,
        value: Number.isFinite(entry?.value) ? Number(entry.value) : null,
      };
      payload.consequences.push(consequence);
    }
  }

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
  return payload;
}

/**
 * Map degree → display consequences using definition + optional known values.
 * @param {object} definition
 * @param {string|null} degree
 * @param {{ knownValues?: Record<string, number|null> }} [opts]
 */
export function resolveDisplayConsequences(definition, degree, opts = {}) {
  if (!definition || !degree) return [];
  const templates = definition.consequencesByDegree?.[degree] ?? [];
  const known = opts.knownValues && typeof opts.knownValues === "object" ? opts.knownValues : {};
  const out = [];
  for (const template of templates) {
    const knownValue = known[template.slug];
    if (template.requiresValue && !Number.isFinite(knownValue)) continue;
    out.push({
      slug: template.slug,
      label: template.label,
      value: Number.isFinite(knownValue) ? Number(knownValue) : null,
    });
  }
  return out;
}

/**
 * Templates used for correlation claims (may include requiresValue entries).
 */
export function resolveCorrelationConsequenceTemplates(definition, degree) {
  if (!definition || !degree) return [];
  return [...(definition.consequencesByDegree?.[degree] ?? [])];
}

function resolveActorTokenDisplay(actorUuid, tokenUuid) {
  let name = null;
  let img = null;
  try {
    if (tokenUuid && typeof fromUuidSync === "function") {
      const token = fromUuidSync(tokenUuid);
      name = safeString(token?.name);
      img = safeString(token?.texture?.src) ?? safeString(token?.actor?.img);
    }
  } catch {
    /* optional */
  }
  try {
    if (!name && actorUuid && typeof fromUuidSync === "function") {
      const actor = fromUuidSync(actorUuid);
      name = safeString(actor?.name);
      img = img ?? safeString(actor?.img);
    }
  } catch {
    /* optional */
  }
  return { name, img };
}

/**
 * Register correlation claims and cancel pending matching condition presentations.
 */
function applyActionConsequenceCorrelation(transactionId, target, templates, knownValues = {}) {
  for (const template of templates) {
    const value = Number.isFinite(knownValues[template.slug])
      ? Number(knownValues[template.slug])
      : null;
    registerRepresentedConsequence({
      transactionId,
      targetActorUuid: target?.actorUuid ?? null,
      targetTokenUuid: target?.tokenUuid ?? null,
      conditionSlug: template.slug,
      conditionValue: value,
    });
    cancelMatchingPendingConditionPresentations({
      conditionSlug: template.slug,
      targetActorUuid: target?.actorUuid ?? null,
      targetTokenUuid: target?.tokenUuid ?? null,
      conditionValue: value,
    });
  }
}

/**
 * @param {ChatMessage} message
 * @param {{ knownValues?: Record<string, number|null> }} [opts]
 */
export async function presentActionResultFromMessage(message, opts = {}) {
  const inspected = inspectPf2eActionCheckMessage(message);
  if (!inspected) return { emitted: false, reason: "not-check-message" };
  if (!inspected.supported) {
    rememberRecent({
      transactionId: safeString(message?.id),
      actionSlug: null,
      sourceName: null,
      targetName: null,
      degree: null,
      consequenceLabels: [],
      outcome: "unsupported",
      reason: inspected.reason ?? "unsupported",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "unsupported" };
  }

  const definition = inspected.definition;
  if (definition.targetRequired && !inspected.targetActorUuid && !inspected.targetTokenUuid) {
    rememberRecent({
      transactionId: inspected.messageId,
      actionSlug: inspected.slug,
      sourceName: null,
      targetName: null,
      degree: inspected.degree,
      consequenceLabels: [],
      outcome: "suppressed",
      reason: "missing-target",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "missing-target" };
  }

  const enabled = readActionSettingEnabled();
  const runtime = detectNelcineActionRuntime();
  if (game.ready !== true) return { emitted: false, reason: "game-not-ready" };
  if (!enabled) {
    rememberRecent({
      transactionId: inspected.messageId,
      actionSlug: inspected.slug,
      sourceName: null,
      targetName: null,
      degree: inspected.degree,
      consequenceLabels: [],
      outcome: "suppressed",
      reason: "setting-disabled",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "setting-disabled" };
  }
  if (game.user?.isGM !== true) return { emitted: false, reason: "not-gm" };
  if (!isAuthoritativeActionEmitter()) return { emitted: false, reason: "not-authoritative-emitter" };
  if (!runtime.active) return { emitted: false, reason: "nelcine-inactive" };
  if (!runtime.hasBroadcastApi) return { emitted: false, reason: "missing-broadcast-api" };

  const transactionId = `action:${inspected.messageId}`;
  const knownValues = opts.knownValues ?? {};
  // Pull pending condition values for demoralize-style requiresValue mapping.
  const correlation = inspectActionConditionCorrelation();
  for (const pending of correlation.pendingConditionPresentations) {
    if (
      pending.targetActorUuid &&
      inspected.targetActorUuid &&
      pending.targetActorUuid === inspected.targetActorUuid &&
      Number.isFinite(pending.conditionValue)
    ) {
      knownValues[pending.conditionSlug] = pending.conditionValue;
    }
  }

  const templates = resolveCorrelationConsequenceTemplates(definition, inspected.degree);
  const consequences = resolveDisplayConsequences(definition, inspected.degree, { knownValues });

  const sourceDisplay = resolveActorTokenDisplay(inspected.sourceActorUuid, inspected.sourceTokenUuid);
  const targetDisplay = resolveActorTokenDisplay(inspected.targetActorUuid, inspected.targetTokenUuid);

  const payload = buildActionResultPayload({
    transactionId,
    slug: inspected.slug,
    category: definition.category,
    action: {
      slug: inspected.slug,
      name: definition.name,
      img: null,
    },
    check: {
      statistic: inspected.statistic,
      natural: inspected.natural,
      modifier: inspected.modifier,
      total: inspected.total,
      dc: inspected.dc,
      dcPublic: inspected.dcPublic,
      degree: inspected.degree,
    },
    source: {
      actorUuid: inspected.sourceActorUuid,
      tokenUuid: inspected.sourceTokenUuid,
      name: sourceDisplay.name,
      img: sourceDisplay.img,
    },
    target: definition.targetRequired
      ? {
          actorUuid: inspected.targetActorUuid,
          tokenUuid: inspected.targetTokenUuid,
          name: targetDisplay.name,
          img: targetDisplay.img,
        }
      : inspected.targetActorUuid || inspected.targetTokenUuid
        ? {
            actorUuid: inspected.targetActorUuid,
            tokenUuid: inspected.targetTokenUuid,
            name: targetDisplay.name,
            img: targetDisplay.img,
          }
        : null,
    consequences,
    sceneId: safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };

  if (!claimActionPresentationKey(transactionId)) {
    rememberRecent({
      transactionId,
      actionSlug: inspected.slug,
      sourceName: payload.source?.name ?? null,
      targetName: payload.target?.name ?? null,
      degree: inspected.degree,
      consequenceLabels: consequences.map((c) => c.label),
      outcome: "duplicate",
      reason: "duplicate",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "duplicate" };
  }

  // Claim BEFORE broadcast. Failures still suppress matching child conditions once.
  if (templates.length && (inspected.targetActorUuid || inspected.targetTokenUuid)) {
    applyActionConsequenceCorrelation(
      transactionId,
      {
        actorUuid: inspected.targetActorUuid,
        tokenUuid: inspected.targetTokenUuid,
      },
      templates,
      knownValues,
    );
  }

  try {
    if (typeof runtime.normalize === "function") {
      try {
        runtime.normalize(payload);
      } catch {
        /* optional */
      }
    }
    await runtime.broadcast(payload);
    rememberRecent({
      transactionId,
      actionSlug: inspected.slug,
      sourceName: payload.source?.name ?? null,
      targetName: payload.target?.name ?? null,
      degree: inspected.degree,
      consequenceLabels: consequences.map((c) => c.label),
      outcome: "emitted",
      reason: null,
      emittedAt: Date.now(),
    });
    return { emitted: true, payload };
  } catch (error) {
    logger.warn("NelCine actionResult presentation failed", {
      stage: "nelcine-action",
      reason: error instanceof Error ? error.message : String(error),
    });
    rememberRecent({
      transactionId,
      actionSlug: inspected.slug,
      sourceName: payload.source?.name ?? null,
      targetName: payload.target?.name ?? null,
      degree: inspected.degree,
      consequenceLabels: consequences.map((c) => c.label),
      outcome: "suppressed",
      reason: "broadcast-failed",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "broadcast-failed" };
  }
}

function onCreateChatMessage(message) {
  if (game.ready !== true) return;
  void presentActionResultFromMessage(message).catch((error) => {
    logger.warn("Action presentation failed open", {
      stage: "nelcine-action",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

export function registerNelcineActionHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  if (typeof Hooks === "undefined") return;
  Hooks.on("createChatMessage", onCreateChatMessage);
}

export function getActionIntegrationStatus() {
  const runtime = detectNelcineActionRuntime();
  return {
    available: runtime.active === true,
    active: runtime.active === true,
    enabled: readActionSettingEnabled(),
    supportedActions: [...SUPPORTED_ACTION_SLUGS],
    nelcineVersion: runtime.version,
    hasBroadcastApi: runtime.hasBroadcastApi,
    isAuthoritativeEmitter: isAuthoritativeActionEmitter(),
    definitions: Object.keys(ACTION_DEFINITIONS).length,
  };
}

export function getRecentActionEvents() {
  if (game.user?.isGM !== true) return [];
  return recentEvents.map((entry) => ({ ...entry }));
}

export function watchActionCinematics() {
  if (game.user?.isGM !== true) return false;
  if (watcher) return true;
  watcher = (entry) => {
    if (entry.outcome === "unsupported") {
      console.debug("NelFlow | Action | UNSUPPORTED", entry.reason);
      return;
    }
    if (entry.outcome !== "emitted") {
      console.debug("NelFlow | Action | SUPPRESSED", entry.reason, entry.actionSlug);
      return;
    }
    console.debug(
      "NelFlow | Action | ACTION",
      entry.actionSlug,
      entry.degree,
      entry.consequenceLabels?.length ? `→ ${entry.consequenceLabels.join(", ")}` : null,
      entry.targetName ? `→ ${entry.targetName}` : null,
    );
  };
  return true;
}

export function stopWatchingActionCinematics() {
  const had = Boolean(watcher);
  watcher = null;
  return had;
}

async function previewResolvedAction(slug, event = {}) {
  if (game.user?.isGM !== true) return { emitted: false, reason: "not-gm" };
  const definition = getActionDefinition(slug);
  if (!definition) return { emitted: false, reason: "unsupported" };
  const degree = DEGREES.has(event.degree) ? event.degree : "success";
  const knownValues = event.knownValues ?? {};
  if (Number.isFinite(event.conditionValue) && event.conditionSlug) {
    knownValues[event.conditionSlug] = Number(event.conditionValue);
  }
  const consequences = resolveDisplayConsequences(definition, degree, { knownValues });
  const transactionId =
    safeString(event.transactionId) ?? `action:preview:${slug}:${Date.now()}`;
  const payload = buildActionResultPayload({
    transactionId,
    slug,
    category: definition.category,
    action: { slug, name: definition.name, img: safeString(event.img) },
    check: {
      statistic: safeString(event.statistic) ?? definition.statistics[0] ?? null,
      natural: safeNumber(event.natural),
      modifier: safeNumber(event.modifier),
      total: safeNumber(event.total),
      dc: event.dcPublic === true ? safeNumber(event.dc) : null,
      dcPublic: event.dcPublic === true,
      degree,
    },
    source: {
      actorUuid: safeString(event.sourceActorUuid),
      tokenUuid: safeString(event.sourceTokenUuid),
      name: safeString(event.sourceName),
      img: safeString(event.sourceImg),
    },
    target: definition.targetRequired
      ? {
          actorUuid: safeString(event.targetActorUuid),
          tokenUuid: safeString(event.targetTokenUuid),
          name: safeString(event.targetName),
          img: safeString(event.targetImg),
        }
      : event.targetActorUuid
        ? {
            actorUuid: safeString(event.targetActorUuid),
            tokenUuid: safeString(event.targetTokenUuid),
            name: safeString(event.targetName),
            img: safeString(event.targetImg),
          }
        : null,
    consequences,
    sceneId: safeString(event.sceneId) ?? safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };

  const runtime = detectNelcineActionRuntime();
  if (!readActionSettingEnabled()) return { emitted: false, reason: "setting-disabled" };
  if (!runtime.active || !runtime.hasBroadcastApi) {
    return { emitted: false, reason: runtime.active ? "missing-broadcast-api" : "nelcine-inactive" };
  }
  if (!isAuthoritativeActionEmitter()) return { emitted: false, reason: "not-authoritative-emitter" };
  if (!claimActionPresentationKey(transactionId)) return { emitted: false, reason: "duplicate" };

  const templates = resolveCorrelationConsequenceTemplates(definition, degree);
  if (templates.length && (payload.target?.actorUuid || payload.target?.tokenUuid)) {
    applyActionConsequenceCorrelation(transactionId, payload.target, templates, knownValues);
  }

  try {
    await runtime.broadcast(payload);
    rememberRecent({
      transactionId,
      actionSlug: slug,
      sourceName: payload.source?.name ?? null,
      targetName: payload.target?.name ?? null,
      degree,
      consequenceLabels: consequences.map((c) => c.label),
      outcome: "emitted",
      reason: null,
      emittedAt: Date.now(),
    });
    return { emitted: true, payload };
  } catch (error) {
    return {
      emitted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function previewResolvedTrip(event) {
  return previewResolvedAction("trip", event);
}
export function previewResolvedGrapple(event) {
  return previewResolvedAction("grapple", event);
}
export function previewResolvedDemoralize(event) {
  return previewResolvedAction("demoralize", event);
}

export function installActionPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.integrations.nelcineActions = Object.freeze({
    getStatus: () => getActionIntegrationStatus(),
    getRecent: () => getRecentActionEvents(),
    inspectCorrelation: () => {
      if (game.user?.isGM !== true) return null;
      return inspectActionConditionCorrelation();
    },
  });
  root.dev = root.dev ?? {};
  root.dev.watchActionCinematics = () => watchActionCinematics();
  root.dev.stopWatchingActionCinematics = () => stopWatchingActionCinematics();
  root.dev.previewResolvedTrip = (event) => previewResolvedTrip(event);
  root.dev.previewResolvedGrapple = (event) => previewResolvedGrapple(event);
  root.dev.previewResolvedDemoralize = (event) => previewResolvedDemoralize(event);
}

export function clearActionBridgeState() {
  emittedKeys.clear();
  recentEvents.length = 0;
  watcher = null;
  clearActionConditionCorrelation();
}
