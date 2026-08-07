/**
 * Presentation-only action ↔ condition correlation (0.13.0).
 * Never delays or mutates condition mechanics — only presentation.
 */

const MAX_CLAIMS = 64;
const MAX_PENDING = 64;

/** Claim lifetime for action-first suppression (ms). */
export const ACTION_CONDITION_CLAIM_MS = 1500;
/** Brief delay for condition-first presentation wait (ms). */
export const CONDITION_PRESENTATION_DEFER_MS = 300;

/**
 * @typedef {object} RepresentedConsequenceClaim
 * @property {string} transactionId
 * @property {string|null} targetActorUuid
 * @property {string|null} targetTokenUuid
 * @property {string} conditionSlug
 * @property {number|null} conditionValue null = any value
 * @property {number} expiresAt
 */

/**
 * @typedef {object} PendingConditionPresentation
 * @property {string} id
 * @property {string|null} targetActorUuid
 * @property {string|null} targetTokenUuid
 * @property {string} conditionSlug
 * @property {number|null} conditionValue
 * @property {number} createdAt
 * @property {number} flushAt
 * @property {() => Promise<unknown>} flush
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

/** @type {Map<string, RepresentedConsequenceClaim>} */
const claims = new Map();
/** @type {Map<string, PendingConditionPresentation>} */
const pending = new Map();

const nativeSchedule = globalThis.setTimeout.bind(globalThis);
/** @type {(handler: () => void, ms?: number) => unknown} */
let schedule = nativeSchedule;

/**
 * Test/runtime injection for presentation deferral timers.
 * @param {(handler: () => void, ms?: number) => unknown} [fn]
 */
export function setConditionDeferScheduler(fn) {
  schedule = typeof fn === "function" ? fn : nativeSchedule;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function claimKey(claim) {
  const valuePart =
    claim.conditionValue == null || !Number.isFinite(claim.conditionValue)
      ? "*"
      : String(claim.conditionValue);
  return [
    claim.transactionId,
    claim.targetActorUuid ?? "",
    claim.targetTokenUuid ?? "",
    claim.conditionSlug,
    valuePart,
  ].join("|");
}

function pruneClaims(now = Date.now()) {
  for (const [key, claim] of claims) {
    if (claim.expiresAt <= now) claims.delete(key);
  }
  while (claims.size > MAX_CLAIMS) {
    const oldest = claims.keys().next().value;
    claims.delete(oldest);
  }
}

/**
 * @param {object} input
 */
export function registerRepresentedConsequence(input = {}) {
  const transactionId = safeString(input.transactionId);
  const conditionSlug = safeString(input.conditionSlug);
  if (!transactionId || !conditionSlug) return false;
  const claim = {
    transactionId,
    targetActorUuid: safeString(input.targetActorUuid),
    targetTokenUuid: safeString(input.targetTokenUuid),
    conditionSlug,
    conditionValue: Number.isFinite(input.conditionValue) ? Number(input.conditionValue) : null,
    expiresAt: Date.now() + (Number.isFinite(input.ttlMs) ? Number(input.ttlMs) : ACTION_CONDITION_CLAIM_MS),
  };
  pruneClaims();
  claims.set(claimKey(claim), claim);
  return true;
}

/**
 * @param {object} candidate
 * @returns {RepresentedConsequenceClaim|null}
 */
export function findMatchingRepresentedConsequence(candidate = {}) {
  pruneClaims();
  const slug = safeString(candidate.conditionSlug);
  if (!slug) return null;
  const actorUuid = safeString(candidate.targetActorUuid);
  const tokenUuid = safeString(candidate.targetTokenUuid);
  const value = Number.isFinite(candidate.conditionValue) ? Number(candidate.conditionValue) : null;
  const now = Date.now();
  if (!actorUuid && !tokenUuid) return null;

  for (const claim of claims.values()) {
    if (claim.expiresAt <= now) continue;
    if (claim.conditionSlug !== slug) continue;

    let targetOk = false;
    if (actorUuid && claim.targetActorUuid && actorUuid === claim.targetActorUuid) targetOk = true;
    if (tokenUuid && claim.targetTokenUuid && tokenUuid === claim.targetTokenUuid) targetOk = true;
    if (!targetOk) continue;

    if (claim.conditionValue != null) {
      if (value == null || claim.conditionValue !== value) continue;
    }
    return claim;
  }
  return null;
}

/**
 * Cancel pending condition presentations that match an action claim.
 * @param {object} input
 * @returns {number} cancelled count
 */
export function cancelMatchingPendingConditionPresentations(input = {}) {
  const slug = safeString(input.conditionSlug);
  const actorUuid = safeString(input.targetActorUuid);
  const tokenUuid = safeString(input.targetTokenUuid);
  const value = Number.isFinite(input.conditionValue) ? Number(input.conditionValue) : null;
  let cancelled = 0;
  for (const [id, entry] of pending) {
    if (slug && entry.conditionSlug !== slug) continue;
    if (actorUuid && entry.targetActorUuid && entry.targetActorUuid !== actorUuid) continue;
    if (tokenUuid && entry.targetTokenUuid && entry.targetTokenUuid !== tokenUuid) continue;
    if (value != null && entry.conditionValue != null && entry.conditionValue !== value) continue;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(id);
    cancelled += 1;
  }
  return cancelled;
}

/**
 * Defer a condition presentation briefly awaiting a matching actionResult.
 * @param {object} input
 * @param {() => Promise<unknown>} flush
 * @returns {{ deferred: boolean, id?: string }}
 */
export function deferConditionPresentation(input, flush) {
  const id =
    safeString(input.id) ??
    `pending:${safeString(input.targetActorUuid)}:${safeString(input.conditionSlug)}:${Date.now()}`;
  while (pending.size >= MAX_PENDING) {
    const oldestId = pending.keys().next().value;
    const oldest = pending.get(oldestId);
    if (oldest?.timer) clearTimeout(oldest.timer);
    pending.delete(oldestId);
  }
  const deferMs = Number.isFinite(input.deferMs) ? Number(input.deferMs) : CONDITION_PRESENTATION_DEFER_MS;
  const entry = {
    id,
    targetActorUuid: safeString(input.targetActorUuid),
    targetTokenUuid: safeString(input.targetTokenUuid),
    conditionSlug: safeString(input.conditionSlug) ?? "unknown",
    conditionValue: Number.isFinite(input.conditionValue) ? Number(input.conditionValue) : null,
    createdAt: Date.now(),
    flushAt: Date.now() + deferMs,
    flush,
    timer: null,
  };
  entry.timer = schedule(() => {
    pending.delete(id);
    void Promise.resolve()
      .then(() => flush())
      .catch(() => {
        /* fail open */
      });
  }, deferMs);
  pending.set(id, entry);
  return { deferred: true, id };
}

/**
 * Decision for a condition-gain presentation attempting to emit.
 * @param {object} candidate
 * @param {{ flush: () => Promise<unknown>, deferMs?: number }} handlers
 * @returns {{ action: "emit"|"suppress"|"defer", reason?: string, claim?: object }}
 */
export function evaluateConditionPresentationCorrelation(candidate, handlers = {}) {
  const match = findMatchingRepresentedConsequence(candidate);
  if (match) {
    return { action: "suppress", reason: "action-represented-consequence", claim: match };
  }
  if (typeof handlers.flush === "function") {
    deferConditionPresentation(
      {
        targetActorUuid: candidate.targetActorUuid,
        targetTokenUuid: candidate.targetTokenUuid,
        conditionSlug: candidate.conditionSlug,
        conditionValue: candidate.conditionValue,
        deferMs: handlers.deferMs,
      },
      handlers.flush,
    );
    return { action: "defer", reason: "awaiting-action-correlation" };
  }
  return { action: "emit" };
}

/**
 * Safe diagnostic snapshot (no timers/documents).
 */
export function inspectActionConditionCorrelation() {
  pruneClaims();
  const now = Date.now();
  return {
    representedConsequences: [...claims.values()]
      .filter((c) => c.expiresAt > now)
      .map((c) => ({
        transactionId: c.transactionId,
        targetActorUuid: c.targetActorUuid,
        targetTokenUuid: c.targetTokenUuid,
        conditionSlug: c.conditionSlug,
        conditionValue: c.conditionValue,
        expiresAt: c.expiresAt,
      })),
    pendingConditionPresentations: [...pending.values()].map((p) => ({
      id: p.id,
      targetActorUuid: p.targetActorUuid,
      targetTokenUuid: p.targetTokenUuid,
      conditionSlug: p.conditionSlug,
      conditionValue: p.conditionValue,
      createdAt: p.createdAt,
      flushAt: p.flushAt,
    })),
  };
}

export function clearActionConditionCorrelation() {
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pending.clear();
  claims.clear();
}

/** Test helper */
export function seedRepresentedConsequence(claim) {
  return registerRepresentedConsequence(claim);
}
