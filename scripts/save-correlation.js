import { SAVE_OUTCOMES } from "./save-resolver-model.js";

export const SAVE_CORRELATION_REASONS = Object.freeze({
  MISSING: "save-message-missing",
  ALREADY_CLAIMED: "save-message-already-claimed",
  CONTEXT_MISMATCH: "save-message-context-mismatch",
  INVALID_ROLL: "save-message-invalid-roll",
  STALE_ATTEMPT: "save-attempt-stale",
});

function safePart(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function buildSaveCorrelationOption({
  resolverId,
  targetEntryId,
  attemptId,
  sourceMessageId,
  rollingUserId,
}) {
  return [
    "nelflow:save-correlation",
    safePart(resolverId),
    safePart(targetEntryId),
    safePart(attemptId),
    safePart(sourceMessageId),
    safePart(rollingUserId),
  ].join(":");
}

export function validateSaveCandidate(scope, candidate) {
  if (
    !candidate?.isChatMessage ||
    !candidate.messageId ||
    candidate.visible !== true ||
    candidate.correlationOption !== scope.correlationOption ||
    candidate.authorUserId !== scope.rollingUserId ||
    candidate.contextType !== "saving-throw" ||
    candidate.statistic !== scope.saveType ||
    candidate.dc !== scope.saveDC
  ) {
    return { ok: false, reason: SAVE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  if (!candidate.isCheckRoll || !SAVE_OUTCOMES.includes(candidate.outcome)) {
    return { ok: false, reason: SAVE_CORRELATION_REASONS.INVALID_ROLL };
  }
  if (
    candidate.targetActorUuid !== scope.targetActorUuid ||
    (scope.targetTokenUuid &&
      candidate.targetTokenUuid &&
      candidate.targetTokenUuid !== scope.targetTokenUuid) ||
    candidate.sourceActorUuid !== scope.sourceActorUuid ||
    candidate.itemUuid !== scope.spellItemUuid
  ) {
    return { ok: false, reason: SAVE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  if (
    Number.isInteger(candidate.degreeOfSuccess) &&
    SAVE_OUTCOMES[candidate.degreeOfSuccess] !== candidate.outcome
  ) {
    return { ok: false, reason: SAVE_CORRELATION_REASONS.INVALID_ROLL };
  }
  if (candidate.existingClaim && candidate.existingClaim !== scope.attemptId) {
    return { ok: false, reason: SAVE_CORRELATION_REASONS.ALREADY_CLAIMED };
  }
  return { ok: true, reason: null };
}

export class SaveMessageClaimRegistry {
  constructor({ persistedOwner = () => null } = {}) {
    this.claims = new Map();
    this.persistedOwner = persistedOwner;
  }

  owner(messageId) {
    return this.claims.get(messageId) ?? this.persistedOwner(messageId) ?? null;
  }

  claim(messageId, attemptId) {
    const owner = this.owner(messageId);
    if (owner && owner !== attemptId) {
      return { ok: false, reason: SAVE_CORRELATION_REASONS.ALREADY_CLAIMED };
    }
    this.claims.set(messageId, attemptId);
    return { ok: true, reason: null };
  }

  restore(messageId, attemptId) {
    if (messageId && attemptId && !this.owner(messageId)) this.claims.set(messageId, attemptId);
  }
}
