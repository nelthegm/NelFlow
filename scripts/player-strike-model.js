import {
  PLAYER_STRIKE_AUTO_APPLY_MODES,
  PLAYER_STRIKE_TRANSACTION_SCHEMA_VERSION,
  TRANSACTION_STATES,
} from "./constants.js";

export const PLAYER_STRIKE_TRANSACTION_TYPE = "player-strike";
export const PLAYER_STRIKE_CAPTURE_SCHEMA_VERSION = 1;
export const PLAYER_STRIKE_SOCKET_ACTION = "player-strike-damage-observed";
export const CHARACTER_STRIKE_CORRELATION_SCHEMA_VERSION = 1;
export const CHARACTER_STRIKE_INTENT_MAX_AGE_MS = 30_000;

export const PLAYER_STRIKE_FAILURES = Object.freeze({
  DISABLED: "player-strike-disabled",
  SOURCE_UNSUPPORTED: "player-strike-source-unsupported",
  TARGET_MISSING: "player-strike-target-missing",
  MULTIPLE_TARGETS: "player-strike-multiple-targets",
  TARGET_CHANGED: "player-strike-target-changed",
  DISPOSITION_BLOCKED: "player-strike-target-disposition-blocked",
  OUTCOME_MISSING: "player-strike-outcome-missing",
  NOT_A_HIT: "player-strike-not-a-hit",
  DAMAGE_MISSING: "player-strike-damage-missing",
  DAMAGE_AMBIGUOUS: "player-strike-damage-ambiguous",
  DIRECT_INTENT_INVALID: "player-strike-direct-intent-invalid",
  DIRECT_INTENT_EXPIRED: "player-strike-direct-intent-expired",
  DIRECT_INTENT_CONFLICT: "player-strike-direct-intent-conflict",
  VARIANT_MISMATCH: "player-strike-damage-variant-mismatch",
  AUTHORITY_MISSING: "player-strike-authority-missing",
  APPLICATION_FAILED: "player-strike-application-failed",
  REACTION_REVIEW: "player-strike-reaction-review-required",
  INTERRUPTED: "player-strike-interrupted",
});

const HIT_OUTCOMES = new Set(["success", "criticalSuccess"]);
const ATTACK_OUTCOMES = new Set(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** Compact deterministic identity hash; flags retain exact UUIDs separately for revalidation. */
export function playerStrikeFingerprint(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function expectedDamageVariant(outcome) {
  if (outcome === "success") return "ordinary";
  if (outcome === "criticalSuccess") return "critical";
  return null;
}

export function damageVariantFromOutcome(outcome) {
  return expectedDamageVariant(outcome);
}

export function targetCountFailure(targetCount) {
  if (targetCount === 0) return PLAYER_STRIKE_FAILURES.TARGET_MISSING;
  if (targetCount !== 1) return PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS;
  return null;
}

export function playerStrikeModeAllows({ mode, snapshotDisposition, currentDisposition, hostileValue = -1 }) {
  if (mode === PLAYER_STRIKE_AUTO_APPLY_MODES.ALL) return true;
  if (mode !== PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE) return false;
  return snapshotDisposition === hostileValue && currentDisposition === hostileValue;
}

export function validatePlayerStrikeAttack(evidence) {
  if (
    !evidence ||
    evidence.actorType !== "character" ||
    evidence.actionType !== "strike" ||
    evidence.itemType !== "weapon" ||
    evidence.damaging !== true
  ) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  }
  // Character eligibility is document-based. GM status affects authority
  // election, not whether a native character Strike belongs in this workflow.
  if (!evidence.authorActive || !evidence.authorOwnsSource) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  }
  if (
    !evidence.sourceActorUuid ||
    !evidence.sourceItemUuid ||
    !evidence.attackMessageId ||
    !evidence.strikeIdentifier ||
    !Number.isInteger(evidence.actionIndex)
  ) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  }
  const targetFailure = targetCountFailure(evidence.targetCount);
  if (targetFailure) return { ok: false, reason: targetFailure };
  if (!evidence.targetActorUuid || !evidence.targetTokenUuid) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.TARGET_MISSING };
  }
  if (!ATTACK_OUTCOMES.has(evidence.outcome)) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.OUTCOME_MISSING };
  }
  if (!HIT_OUTCOMES.has(evidence.outcome)) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.NOT_A_HIT, terminal: true };
  }
  return { ok: true, reason: null };
}

export function buildPlayerStrikeSnapshot(evidence, { processingUserId, settingMode, sessionId }) {
  const sourceIdentity = {
    actor: evidence.sourceActorUuid,
    token: evidence.sourceTokenUuid ?? null,
    item: evidence.sourceItemUuid,
    identifier: evidence.strikeIdentifier,
    actionIndex: evidence.actionIndex,
    altUsage: evidence.altUsage ?? null,
  };
  const targetIdentity = {
    actor: evidence.targetActorUuid,
    token: evidence.targetTokenUuid,
    scene: evidence.sceneId ?? null,
  };
  return {
    schemaVersion: PLAYER_STRIKE_TRANSACTION_SCHEMA_VERSION,
    sourceActorUuid: evidence.sourceActorUuid,
    sourceTokenUuid: evidence.sourceTokenUuid ?? null,
    sourceItemUuid: evidence.sourceItemUuid,
    strikeIdentifier: evidence.strikeIdentifier,
    actionIndex: evidence.actionIndex,
    altUsage: evidence.altUsage ?? null,
    attackMessageId: evidence.attackMessageId,
    attackRollId: evidence.attackRollId ?? null,
    targetActorUuid: evidence.targetActorUuid,
    targetTokenUuid: evidence.targetTokenUuid,
    sceneId: evidence.sceneId ?? null,
    targetCount: evidence.targetCount,
    targetDisposition: evidence.targetDisposition,
    sourceDisposition: evidence.sourceDisposition ?? null,
    targetFingerprint: playerStrikeFingerprint(targetIdentity),
    sourceFingerprint: playerStrikeFingerprint(sourceIdentity),
    outcome: evidence.outcome,
    damageVariant: expectedDamageVariant(evidence.outcome),
    mapIncreases: evidence.mapIncreases,
    actorType: evidence.actorType,
    authoringUserId: evidence.authorUserId,
    authorRole: evidence.authorRole ?? null,
    authorIsGm: evidence.authorIsGm === true,
    processingUserId,
    settingMode,
    sessionId,
  };
}

export function validatePlayerStrikeSnapshot(snapshot, evidence) {
  if (!snapshot || !evidence) return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  const sourceExact =
    evidence.attackMessageId === snapshot.attackMessageId &&
    evidence.attackRollId === snapshot.attackRollId &&
    evidence.sourceActorUuid === snapshot.sourceActorUuid &&
    evidence.sourceTokenUuid === snapshot.sourceTokenUuid &&
    evidence.sourceItemUuid === snapshot.sourceItemUuid &&
    evidence.strikeIdentifier === snapshot.strikeIdentifier &&
    evidence.actionIndex === snapshot.actionIndex &&
    (evidence.altUsage ?? null) === (snapshot.altUsage ?? null) &&
    evidence.authorUserId === snapshot.authoringUserId &&
    evidence.mapIncreases === snapshot.mapIncreases &&
    evidence.actorType === snapshot.actorType &&
    evidence.outcome === snapshot.outcome;
  if (!sourceExact) return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  const targetExact =
    evidence.targetCount === snapshot.targetCount &&
    evidence.targetActorUuid === snapshot.targetActorUuid &&
    evidence.targetTokenUuid === snapshot.targetTokenUuid;
  return targetExact
    ? { ok: true, reason: null }
    : { ok: false, reason: PLAYER_STRIKE_FAILURES.TARGET_CHANGED };
}

export function validatePlayerStrikeDamage(snapshot, evidence, { authorUserId = snapshot?.authoringUserId } = {}) {
  if (!snapshot || !evidence?.isNativeDamageRoll || evidence.contextType !== "damage-roll") {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.DAMAGE_MISSING };
  }
  const exact =
    evidence.sourceActorUuid === snapshot.sourceActorUuid &&
    evidence.sourceTokenUuid === snapshot.sourceTokenUuid &&
    evidence.sourceItemUuid === snapshot.sourceItemUuid &&
    evidence.targetActorUuid === snapshot.targetActorUuid &&
    evidence.targetTokenUuid === snapshot.targetTokenUuid &&
    evidence.authorUserId === authorUserId &&
    evidence.actionIndex === snapshot.actionIndex &&
    (evidence.altUsage ?? null) === (snapshot.altUsage ?? null) &&
    evidence.mapIncreases === snapshot.mapIncreases;
  if (!exact) return { ok: false, reason: PLAYER_STRIKE_FAILURES.TARGET_CHANGED };
  const variant = damageVariantFromOutcome(evidence.outcome);
  // PF2e records which native button produced the damage message. The user's
  // ordinary/critical selection is authoritative after any successful hit;
  // Nelflow applies that existing roll with multiplier 1 and never transforms it.
  if (!variant) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.VARIANT_MISMATCH };
  }
  return { ok: true, reason: null, variant };
}

function exactNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

export function requestedVariantFromDamageOutcome(outcome) {
  if (outcome === "success") return "damage";
  if (outcome === "criticalSuccess") return "critical";
  return null;
}

/** Validate untrusted direct-link metadata against both durable state and PF2e's native message evidence. */
export function validateCharacterStrikeCorrelation(
  transaction,
  evidence,
  correlation,
  { now = Date.now(), maxAgeMs = CHARACTER_STRIKE_INTENT_MAX_AGE_MS } = {},
) {
  if (
    !transaction ||
    transaction.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE ||
    !correlation ||
    correlation.version !== CHARACTER_STRIKE_CORRELATION_SCHEMA_VERSION ||
    correlation.transactionId !== transaction.id ||
    correlation.sourceMessageId !== transaction.attackMessageId ||
    typeof correlation.intentNonce !== "string" ||
    !/^[A-Za-z0-9_-]{12,64}$/.test(correlation.intentNonce) ||
    !["damage", "critical"].includes(correlation.requestedVariant) ||
    typeof correlation.authorUserId !== "string" ||
    !Number.isFinite(correlation.createdAt)
  ) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID,
      decision: "rejected",
    };
  }
  const damageMessageId = evidence?.damageMessageId ?? null;
  const correlationBoundMessageId = correlation.boundDamageMessageId ?? null;
  const transactionBoundMessageId = transaction.boundDamageMessageId ??
    transaction.damageMessageId ?? transaction.observedDamageMessageId ?? null;
  const nonceConflicts = Boolean(
    transaction.directIntentNonce && transaction.directIntentNonce !== correlation.intentNonce,
  );
  const correlationMessageConflicts = Boolean(
    correlationBoundMessageId && damageMessageId && correlationBoundMessageId !== damageMessageId,
  );
  const transactionMessageConflicts = Boolean(
    transactionBoundMessageId && damageMessageId && transactionBoundMessageId !== damageMessageId,
  );
  if (nonceConflicts || correlationMessageConflicts || transactionMessageConflicts) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_CONFLICT,
      decision: "rejected",
      persistedBindingState: transactionMessageConflicts || nonceConflicts
        ? "consumed-by-other-message"
        : "conflicting",
    };
  }
  const correlationBoundToSameMessage = Boolean(
    damageMessageId && correlationBoundMessageId === damageMessageId,
  );
  const persistedSameMessage = Boolean(
    damageMessageId &&
    transactionBoundMessageId === damageMessageId &&
    (!transaction.directIntentNonce || transaction.directIntentNonce === correlation.intentNonce),
  );
  const sameMessageBinding = correlationBoundToSameMessage || persistedSameMessage;
  if (transaction.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE && !sameMessageBinding) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID,
      decision: "rejected",
    };
  }
  const ageMs = now - correlation.createdAt;
  // Thirty seconds bounds only the pre-message hint. Once either the message
  // metadata or the transaction proves the exact tuple, processing latency and
  // browser lifetime are no longer correlation inputs.
  if (ageMs < -5_000 || (!sameMessageBinding && ageMs > maxAgeMs)) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_EXPIRED,
      decision: "rejected",
      ageMs,
    };
  }
  const snapshot = transaction.snapshot;
  const metadataExact =
    correlation.sourceActorUuid === snapshot.sourceActorUuid &&
    exactNullable(correlation.sourceTokenUuid, snapshot.sourceTokenUuid) &&
    correlation.sourceItemUuid === snapshot.sourceItemUuid &&
    correlation.strikeIdentifier === snapshot.strikeIdentifier &&
    correlation.actionIndex === snapshot.actionIndex &&
    exactNullable(correlation.altUsage, snapshot.altUsage) &&
    correlation.attackOutcome === snapshot.outcome &&
    exactNullable(correlation.sceneId, snapshot.sceneId);
  const damageValidation = validatePlayerStrikeDamage(snapshot, evidence, {
    authorUserId: correlation.authorUserId,
  });
  if (!metadataExact || !damageValidation.ok) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID,
      decision: "rejected",
      ageMs,
    };
  }
  if (requestedVariantFromDamageOutcome(evidence.outcome) !== correlation.requestedVariant) {
    return {
      ok: false,
      reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID,
      decision: "rejected",
      ageMs,
    };
  }
  return {
    ok: true,
    reason: null,
    ageMs,
    variant: damageValidation.variant,
    decision: persistedSameMessage ? "accepted-idempotent" : "accepted",
    persistedBindingState: persistedSameMessage && transaction.directIntentConsumedAt
      ? "consumed-by-same-message"
      : "valid",
    boundDamageMessageId: damageMessageId,
  };
}

export function correlatePlayerStrikeDamage(transactions, evidence) {
  const eligible = [...(transactions ?? [])].filter((transaction) =>
    transaction?.transactionType === PLAYER_STRIKE_TRANSACTION_TYPE &&
    transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE &&
    validatePlayerStrikeDamage(transaction.snapshot, evidence).ok,
  );
  if (eligible.length === 1) return { ok: true, transaction: eligible[0], candidates: eligible };
  return {
    ok: false,
    reason: eligible.length > 1
      ? PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS
      : PLAYER_STRIKE_FAILURES.DAMAGE_MISSING,
    candidates: eligible,
  };
}

/** Prefer a validated causal click-intent before considering structured fallback candidates. */
export function correlatePlayerStrikeDamageWithIntent(
  transactions,
  evidence,
  correlation,
  options = {},
) {
  const playerStrikes = [...(transactions ?? [])].filter((transaction) =>
    transaction?.transactionType === PLAYER_STRIKE_TRANSACTION_TYPE,
  );
  const waiting = playerStrikes.filter((transaction) =>
    transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  );
  if (correlation) {
    const transaction = playerStrikes.find((candidate) =>
      candidate.id === correlation.transactionId &&
      candidate.attackMessageId === correlation.sourceMessageId,
    ) ?? null;
    const validation = transaction
      ? validateCharacterStrikeCorrelation(transaction, evidence, correlation, options)
      : { ok: false, reason: PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID };
    return validation.ok
      ? {
        ok: true,
        transaction,
        candidates: [transaction],
        method: "character-strike-click-intent",
        directValidation: validation,
      }
      : {
        ok: false,
        transaction,
        candidates: transaction ? [transaction] : [],
        method: "character-strike-click-intent-rejected",
        reason: validation.reason,
        directValidation: validation,
      };
  }
  const fallback = correlatePlayerStrikeDamage(waiting, evidence);
  return {
    ...fallback,
    method: "pf2e-structured-strike-context",
    directValidation: null,
  };
}

export function validatePlayerStrikeSocketPayload(payload) {
  if (!payload || payload.action !== PLAYER_STRIKE_SOCKET_ACTION) return null;
  if (Object.keys(payload).some((key) => !["action", "damageMessageId"].includes(key))) return null;
  if (typeof payload.damageMessageId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.damageMessageId)) return null;
  return { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: payload.damageMessageId };
}

export function reconcilePlayerStrikeReload(transaction, currentSessionId) {
  if (!transaction || transaction.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE) return "ignore";
  if (transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE) return "wait";
  if ([TRANSACTION_STATES.CLAIMED, TRANSACTION_STATES.APPLYING, TRANSACTION_STATES.VALIDATING].includes(transaction.state)) {
    return transaction.activeOperation?.sessionId === currentSessionId ? "owned" : "interrupt";
  }
  return "terminal";
}
