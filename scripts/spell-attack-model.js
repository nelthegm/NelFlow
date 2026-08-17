/**
 * Single-target spell-attack auto-apply model (0.14.13).
 * Fail-open when correlation is ambiguous. No DOM / HTML interception.
 */

import { TRANSACTION_STATES } from "./constants.js";

export const SPELL_ATTACK_TRANSACTION_TYPE = "spell-attack";
export const SPELL_ATTACK_CAPTURE_SCHEMA_VERSION = 1;
export const SPELL_ATTACK_TRANSACTION_SCHEMA_VERSION = 1;
export const SPELL_ATTACK_SOCKET_ACTION = "spell-attack-damage-observed";

export const SPELL_ATTACK_FAILURES = Object.freeze({
  DISABLED: "spell-attack-disabled",
  SOURCE_UNSUPPORTED: "spell-attack-source-unsupported",
  TARGET_MISSING: "spell-attack-target-missing",
  MULTIPLE_TARGETS: "spell-attack-multiple-targets",
  OUTCOME_MISSING: "spell-attack-outcome-missing",
  NOT_A_HIT: "spell-attack-not-a-hit",
  DAMAGE_MISSING: "spell-attack-damage-missing",
  DAMAGE_AMBIGUOUS: "spell-attack-damage-ambiguous",
  AUTHORITY_MISSING: "spell-attack-authority-missing",
  APPLICATION_FAILED: "spell-attack-application-failed",
  TARGET_INVALID: "spell-attack-target-invalid",
  SOURCE_INVALID: "spell-attack-source-invalid",
});

const HIT_OUTCOMES = new Set(["success", "criticalSuccess"]);
const ATTACK_OUTCOMES = new Set(["criticalFailure", "failure", "success", "criticalSuccess"]);

export function spellAttackTargetCountFailure(targetCount) {
  if (targetCount === 0) return SPELL_ATTACK_FAILURES.TARGET_MISSING;
  if (targetCount !== 1) return SPELL_ATTACK_FAILURES.MULTIPLE_TARGETS;
  return null;
}

export function validateSpellAttack(evidence) {
  if (
    !evidence ||
    evidence.contextType !== "attack-roll" ||
    evidence.isStrike === true ||
    evidence.isSpell !== true ||
    evidence.isSpellAttack !== true
  ) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.SOURCE_UNSUPPORTED };
  }
  if (!evidence.sourceActorUuid || !evidence.sourceItemUuid || !evidence.attackMessageId) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.SOURCE_UNSUPPORTED };
  }
  if (!evidence.authorActive || !evidence.authorOwnsSource) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.SOURCE_UNSUPPORTED };
  }
  const targetFailure = spellAttackTargetCountFailure(evidence.targetCount);
  if (targetFailure) return { ok: false, reason: targetFailure };
  if (!evidence.targetActorUuid || !evidence.targetTokenUuid) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.TARGET_MISSING };
  }
  if (!ATTACK_OUTCOMES.has(evidence.outcome)) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.OUTCOME_MISSING };
  }
  if (!HIT_OUTCOMES.has(evidence.outcome)) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.NOT_A_HIT, terminal: true };
  }
  return { ok: true, reason: null };
}

export function buildSpellAttackSnapshot(evidence, { processingUserId, sessionId }) {
  return {
    schemaVersion: SPELL_ATTACK_TRANSACTION_SCHEMA_VERSION,
    kind: SPELL_ATTACK_TRANSACTION_TYPE,
    sourceActorUuid: evidence.sourceActorUuid,
    sourceTokenUuid: evidence.sourceTokenUuid ?? null,
    sourceItemUuid: evidence.sourceItemUuid,
    actionName: evidence.actionName ?? null,
    attackMessageId: evidence.attackMessageId,
    attackRollId: evidence.attackRollId ?? null,
    targetActorUuid: evidence.targetActorUuid,
    targetTokenUuid: evidence.targetTokenUuid,
    sceneId: evidence.sceneId ?? null,
    targetCount: evidence.targetCount,
    outcome: evidence.outcome,
    authoringUserId: evidence.authorUserId,
    authorRole: evidence.authorRole ?? null,
    authorIsGm: evidence.authorIsGm === true,
    processingUserId,
    sessionId,
  };
}

export function validateSpellAttackDamage(snapshot, evidence) {
  if (
    !snapshot ||
    !evidence?.isNativeDamageRoll ||
    evidence.contextType !== "damage-roll" ||
    evidence.sourceType !== "attack"
  ) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.DAMAGE_MISSING };
  }
  if (evidence.isStrikeDamage === true) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.DAMAGE_MISSING };
  }
  if (evidence.isHealing === true) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.DAMAGE_MISSING };
  }
  const exact =
    evidence.sourceActorUuid === snapshot.sourceActorUuid &&
    evidence.sourceItemUuid === snapshot.sourceItemUuid &&
    evidence.authorUserId === snapshot.authoringUserId;
  if (!exact) return { ok: false, reason: SPELL_ATTACK_FAILURES.DAMAGE_MISSING };
  if (
    snapshot.sourceTokenUuid &&
    evidence.sourceTokenUuid &&
    snapshot.sourceTokenUuid !== evidence.sourceTokenUuid
  ) {
    return { ok: false, reason: SPELL_ATTACK_FAILURES.DAMAGE_MISSING };
  }
  return { ok: true, reason: null };
}

export function correlateSpellAttackDamage(transactions, evidence) {
  const eligible = [...(transactions ?? [])].filter(
    (transaction) =>
      transaction?.transactionType === SPELL_ATTACK_TRANSACTION_TYPE &&
      transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE &&
      validateSpellAttackDamage(transaction.snapshot, evidence).ok,
  );
  if (eligible.length === 1) {
    return {
      ok: true,
      transaction: eligible[0],
      candidates: eligible,
      method: "pf2e-structured-spell-attack-unique",
    };
  }
  return {
    ok: false,
    reason:
      eligible.length > 1
        ? SPELL_ATTACK_FAILURES.DAMAGE_AMBIGUOUS
        : SPELL_ATTACK_FAILURES.DAMAGE_MISSING,
    candidates: eligible,
    method: eligible.length > 1 ? "ambiguous" : "none",
  };
}

export function buildSpellAttackTransactionId(attackMessageId) {
  if (typeof attackMessageId !== "string" || !attackMessageId.trim()) return null;
  return `nelflow-spell-attack-${attackMessageId.trim()}`;
}

export function buildSpellAttackDamageResultId(transactionId) {
  if (typeof transactionId !== "string" || !transactionId.trim()) return null;
  return `${transactionId.trim()}:damage-applied`;
}

/** Alias used by presentation feed Stage 2. */
export function buildSpellAttackDamageAppliedResultId(transactionId) {
  return buildSpellAttackDamageResultId(transactionId);
}

export function buildSpellAttackDamageRolledResultId(transactionId) {
  if (typeof transactionId !== "string" || !transactionId.trim()) return null;
  return `${transactionId.trim()}:damage-rolled`;
}
