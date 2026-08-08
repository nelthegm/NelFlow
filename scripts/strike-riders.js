/**
 * Presentation-only Strike rider extraction (0.14.1).
 *
 * Authoritative source: PF2e ChatMessage flags.pf2e.context.notes
 * (RollNotePF2e.toObject: selector, title, text, outcome, visibility).
 *
 * Critical specialization appears as a RollNote on strike-damage with title
 * PF2E.Actor.Creature.CriticalSpecialization when PF2e already granted access.
 * Damage-only crit-spec groups (e.g. pick/crossbow bleed dice) leave no note
 * and are already reflected in DamageRoll — they are not invented here.
 *
 * Never derives HP/conditions/damage from chat HTML.
 * Never hard-codes weapon-group → effect tables.
 */

import { MODULE_ID } from "./constants.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";

export const RIDER_KINDS = Object.freeze({
  CRITICAL_SPECIALIZATION: "critical-specialization",
  CONDITION: "condition",
  PERSISTENT_DAMAGE: "persistent-damage",
  SAVE: "save",
  MOVEMENT: "movement",
  EFFECT: "effect",
  NOTE: "note",
  NATIVE_CONTROL: "native-control",
});

const MAX_RECENT = 40;
const DAMAGE_COMPONENT_NOISE =
  /^(deadly|fatal|sneak attack|precision|weapon specialization|greater weapon specialization|basic damage|splash)$/i;

/** @type {object[]} */
const recentInspections = [];
/** @type {((summary: object) => void)|null} */
let watcher = null;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Localize and flatten PF2e note text/title for compact display.
 * Does not enrich UUIDs into documents — labels only.
 * @param {unknown} value
 * @returns {string|null}
 */
export function plainNoteText(value) {
  const raw = safeString(value);
  if (!raw) return null;
  let text = raw;
  try {
    if (typeof game?.i18n?.localize === "function") text = game.i18n.localize(raw);
  } catch {
    text = raw;
  }
  return String(text)
    .replace(/@UUID\[[^\]]*\]\{([^}]+)\}/gi, "$1")
    .replace(/@Check\[[^\]]*\](?:\{([^}]+)\})?/gi, (_, name) => name || "check")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

/**
 * @param {object|null|undefined} note
 * @returns {boolean}
 */
export function noteVisibleToCurrentUser(note) {
  if (!note || typeof note !== "object") return false;
  const visibility = safeString(note.visibility)?.toLowerCase() ?? null;
  if (!visibility || visibility === "all") return true;
  if (visibility === "gm") return game.user?.isGM === true;
  if (visibility === "owner") {
    return game.user?.isGM === true || game.user?.isOwner === true;
  }
  if (visibility === "none") return false;
  return game.user?.isGM === true;
}

/**
 * @param {object} note
 * @returns {boolean}
 */
export function isDamageComponentNoiseNote(note) {
  const title = plainNoteText(note?.title) ?? "";
  const text = plainNoteText(note?.text) ?? "";
  if (DAMAGE_COMPONENT_NOISE.test(title)) return true;
  if (!title && DAMAGE_COMPONENT_NOISE.test(text)) return true;
  // Bare deadly/fatal mentions with no additional consequence wording.
  if (/^(deadly|fatal)\b/i.test(text) && text.length < 24) return true;
  return false;
}

/**
 * Classify from authoritative note fields only — no weapon-group rules table.
 * @param {object} note
 * @returns {string}
 */
export function classifyRiderKind(note) {
  const titleKey = safeString(note?.title) ?? "";
  const textKey = safeString(note?.text) ?? "";
  const title = (plainNoteText(titleKey) ?? "").toLowerCase();
  const text = (plainNoteText(textKey) ?? "").toLowerCase();
  const combined = `${titleKey} ${textKey} ${title} ${text}`.toLowerCase();

  if (
    /criticalspecialization/i.test(titleKey) ||
    /critical specialization/i.test(title) ||
    /item\.weapon\.criticalspecialization/i.test(textKey)
  ) {
    return RIDER_KINDS.CRITICAL_SPECIALIZATION;
  }
  if (/persistent/.test(combined) && /damage|bleed|fire|acid|cold|electric|poison/.test(combined)) {
    return RIDER_KINDS.PERSISTENT_DAMAGE;
  }
  if (/@check|saving throw|\bsave\b|fortitude|reflex|will/.test(combined)) {
    return RIDER_KINDS.SAVE;
  }
  if (/prone|grabbed|restrained|off-guard|frightened|clumsy|enfeebled|sickened|stunned|slowed|blinded|deafened|fleeing|immobilized/.test(combined)) {
    return RIDER_KINDS.CONDITION;
  }
  if (/push|shove|forced movement|knocked back|reposition/.test(combined)) {
    return RIDER_KINDS.MOVEMENT;
  }
  if (/effect|rune|talisman/.test(combined)) {
    return RIDER_KINDS.EFFECT;
  }
  return RIDER_KINDS.NOTE;
}

/**
 * @param {object} note
 * @param {string} source
 * @param {number} index
 * @returns {object|null}
 */
export function normalizeRiderFromNote(note, source, index = 0) {
  if (!note || typeof note !== "object") return null;
  if (!noteVisibleToCurrentUser(note)) return null;
  if (isDamageComponentNoiseNote(note)) return null;

  const title = plainNoteText(note.title);
  const detail = plainNoteText(note.text);
  if (!title && !detail) return null;

  const kind = classifyRiderKind(note);
  const outcomes = Array.isArray(note.outcome) ? note.outcome.map(String) : [];
  const criticalOnly = outcomes.length > 0 && outcomes.every((o) => o === "criticalSuccess");
  const actionable =
    /@Check|data-pf2-action|data-action|Apply|Roll/i.test(String(note.text ?? "")) ||
    kind === RIDER_KINDS.SAVE;

  const idSeed = `${source}:${kind}:${title ?? ""}:${detail ?? ""}:${index}`;
  return {
    id: idSeed.slice(0, 180),
    kind,
    label: title ?? detail,
    detail: title && detail && detail !== title ? detail : title ? detail : null,
    icon: null,
    criticalOnly,
    actionable,
    source,
  };
}

/**
 * @param {ChatMessage|null|undefined} message
 * @returns {object[]}
 */
export function extractContextNotes(message) {
  const notes = message?.flags?.pf2e?.context?.notes;
  return Array.isArray(notes) ? notes.filter((n) => n && typeof n === "object") : [];
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function collectStrikeRiders(input = {}) {
  const riders = [];
  const seen = new Set();

  const push = (rider) => {
    if (!rider?.id || seen.has(rider.id)) return;
    seen.add(rider.id);
    riders.push(rider);
  };

  const attackNotes = extractContextNotes(input.attackMessage);
  attackNotes.forEach((note, index) => {
    push(normalizeRiderFromNote(note, "attack-context-notes", index));
  });

  const damageNotes = extractContextNotes(input.damageMessage);
  damageNotes.forEach((note, index) => {
    push(normalizeRiderFromNote(note, "damage-context-notes", index));
  });

  // Supplemental awareness (structured additionalEffects / DOM controls) as
  // presentation-only native-control rows when not already covered by notes.
  const awareness = input.supplementalActions ?? null;
  if (SupplementalActionAwareness.visibleToCurrentUser(awareness)) {
    const labels = SupplementalActionAwareness.localizedLabels(awareness);
    labels.forEach((label, index) => {
      const plain = plainNoteText(label) ?? label;
      if (!plain || DAMAGE_COMPONENT_NOISE.test(plain)) return;
      if (riders.some((r) => r.label === plain || r.detail === plain)) return;
      push({
        id: `supplemental:${plain}:${index}`,
        kind: RIDER_KINDS.NATIVE_CONTROL,
        label: plain,
        detail: null,
        icon: null,
        criticalOnly: false,
        actionable: true,
        source: awareness.detectionSource ?? "supplemental-actions",
      });
    });
  }

  return riders;
}

/**
 * @param {{ outcome?: string|null, riders?: object[] }} input
 * @returns {boolean}
 */
export function shouldExpandStrikeRiders(input = {}) {
  const riders = Array.isArray(input.riders) ? input.riders : [];
  if (!riders.length) return false;
  if (input.outcome === "criticalSuccess") return true;
  return riders.some((rider) => rider.actionable === true || rider.kind === RIDER_KINDS.NATIVE_CONTROL);
}

/**
 * Safe presentation projection for a stack row / message pair.
 * @param {object} row
 * @returns {object[]}
 */
export function ridersForStackRow(row) {
  if (!row) return [];
  const attackMessage = row.attackMessageId ? game.messages?.get?.(row.attackMessageId) : null;
  const damageMessage = row.damageMessageId ? game.messages?.get?.(row.damageMessageId) : null;
  return collectStrikeRiders({
    attackMessage,
    damageMessage,
    outcome: row.outcome,
    supplementalActions: SupplementalActionAwareness.forRow(row),
  });
}

function rememberInspection(entry) {
  recentInspections.unshift(entry);
  while (recentInspections.length > MAX_RECENT) recentInspections.pop();
  if (typeof watcher === "function") {
    try {
      watcher(entry);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * @param {string} messageId
 * @returns {object|null}
 */
export function inspectStrikeRidersMessage(messageId) {
  const id = safeString(messageId);
  if (!id) return null;
  const message = game.messages?.get?.(id);
  if (!message) return null;

  const marker = message.getFlag?.(MODULE_ID, "transaction");
  let attackMessage = message;
  let damageMessage = null;
  let outcome = message.flags?.pf2e?.context?.outcome ?? null;

  if (marker?.role === "damage") damageMessage = message;
  try {
    const resolved = TransactionStore.resolveCanonical(message);
    if (resolved?.transaction) {
      attackMessage = game.messages.get(resolved.transaction.attackMessageId) ?? attackMessage;
      damageMessage = game.messages.get(resolved.transaction.damageMessageId) ?? damageMessage;
      outcome = resolved.transaction.snapshot?.outcome ?? outcome;
    }
  } catch {
    /* optional */
  }

  if (!damageMessage && message.flags?.pf2e?.context?.type === "damage-roll") {
    damageMessage = message;
  }

  const riders = collectStrikeRiders({
    attackMessage,
    damageMessage,
    outcome,
    supplementalActions: null,
  });

  const result = {
    messageId: id,
    outcome: typeof outcome === "string" ? outcome : null,
    riderCount: riders.length,
    riders: riders.map((r) => ({
      kind: r.kind,
      label: r.label,
      detail: r.detail,
      actionable: r.actionable === true,
      source: r.source,
    })),
    nativeControlsPreserved: riders.some((r) => r.actionable || r.kind === RIDER_KINDS.NATIVE_CONTROL),
  };
  rememberInspection(result);
  return result;
}

export function getRecentStrikeRiderInspections() {
  return recentInspections.map((entry) => ({ ...entry }));
}

export function watchStrikeRiders() {
  if (watcher) return true;
  watcher = (entry) => {
    if (!entry?.riderCount) {
      console.debug("NelFlow | RIDERS | NO RIDERS", entry?.outcome ?? "", entry?.messageId ?? "");
      return;
    }
    for (const rider of entry.riders ?? []) {
      const detail = rider.detail ? ` → ${rider.detail}` : "";
      console.debug(`NelFlow | RIDER ${rider.label}${detail}`);
    }
    if (entry.nativeControlsPreserved) {
      console.debug("NelFlow | RIDER native control preserved");
    }
  };
  return true;
}

export function stopWatchingStrikeRiders() {
  const had = Boolean(watcher);
  watcher = null;
  return had;
}

export function clearStrikeRiderDiagnostics() {
  recentInspections.length = 0;
  watcher = null;
}

export function installStrikeRidersPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};
  root.integrations.strikeRiders = Object.freeze({
    inspectMessage: (messageId) => inspectStrikeRidersMessage(messageId),
    getRecent: () => getRecentStrikeRiderInspections(),
  });
  root.dev.watchStrikeRiders = () => watchStrikeRiders();
  root.dev.stopWatchingStrikeRiders = () => stopWatchingStrikeRiders();
}
