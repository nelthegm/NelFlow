import {
  PLAYER_STRIKE_AUTO_APPLY_MODES,
  PLAYER_STRIKE_TRANSACTION_SCHEMA_VERSION,
  TRANSACTION_STATES,
} from "./constants.js";

export const PLAYER_STRIKE_TRANSACTION_TYPE = "player-strike";
export const PLAYER_STRIKE_CAPTURE_SCHEMA_VERSION = 1;
export const PLAYER_STRIKE_SOCKET_ACTION = "player-strike-damage-observed";

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
  if (evidence.authorIsGm || !evidence.authorActive || !evidence.authorOwnsSource) {
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
    authoringUserId: evidence.authorUserId,
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

export function validatePlayerStrikeDamage(snapshot, evidence) {
  if (!snapshot || !evidence?.isNativeDamageRoll || evidence.contextType !== "damage-roll") {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.DAMAGE_MISSING };
  }
  if (evidence.isHealing || evidence.hasPersistentDamage) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED };
  }
  const exact =
    evidence.sourceActorUuid === snapshot.sourceActorUuid &&
    evidence.sourceTokenUuid === snapshot.sourceTokenUuid &&
    evidence.sourceItemUuid === snapshot.sourceItemUuid &&
    evidence.targetActorUuid === snapshot.targetActorUuid &&
    evidence.targetTokenUuid === snapshot.targetTokenUuid &&
    evidence.authorUserId === snapshot.authoringUserId &&
    evidence.actionIndex === snapshot.actionIndex &&
    (evidence.altUsage ?? null) === (snapshot.altUsage ?? null) &&
    evidence.mapIncreases === snapshot.mapIncreases;
  if (!exact) return { ok: false, reason: PLAYER_STRIKE_FAILURES.TARGET_CHANGED };
  const variant = damageVariantFromOutcome(evidence.outcome);
  if (!variant || variant !== snapshot.damageVariant) {
    return { ok: false, reason: PLAYER_STRIKE_FAILURES.VARIANT_MISMATCH };
  }
  return { ok: true, reason: null, variant };
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
