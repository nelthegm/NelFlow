import { TRANSACTION_STATES } from "./constants.js";

const HIT_OUTCOMES = new Set(["success", "criticalSuccess"]);

/**
 * The native damage card is the stable compact host once it exists. Fallbacks
 * keep the projection available when a linked message is hidden or deleted,
 * without exposing any document the current viewer cannot normally see.
 */
export function playerStrikePresentationCandidates(transaction) {
  const ordered = [
    transaction?.damageMessageId,
    transaction?.attackMessageId,
    transaction?.applicationMessageId,
  ];
  return [...new Set(ordered.filter((id) => typeof id === "string" && id.length > 0))];
}

export function selectPlayerStrikePresentationHost(transaction, canViewMessage) {
  if (typeof canViewMessage !== "function") return null;
  return playerStrikePresentationCandidates(transaction).find((id) => canViewMessage(id)) ?? null;
}

export function isPlayerStrikePresentationHost(messageId, transaction, canViewMessage) {
  return selectPlayerStrikePresentationHost(transaction, canViewMessage) === messageId;
}

export function playerStrikePresentationState(transaction) {
  if (transaction?.state === TRANSACTION_STATES.APPLIED && transaction.undoBlocked) {
    return "undo-blocked";
  }
  return {
    [TRANSACTION_STATES.WAITING_FOR_DAMAGE]: "waiting",
    [TRANSACTION_STATES.DAMAGE_OBSERVED]: "applying",
    [TRANSACTION_STATES.VALIDATING]: "applying",
    [TRANSACTION_STATES.CLAIMED]: "applying",
    [TRANSACTION_STATES.APPLYING]: "applying",
    [TRANSACTION_STATES.APPLIED]: "applied",
    [TRANSACTION_STATES.UNDONE]: "undone",
    [TRANSACTION_STATES.SKIPPED]: "not-a-hit",
    [TRANSACTION_STATES.INTERRUPTED]: "interrupted",
  }[transaction?.state] ?? "manual-review";
}

/**
 * Whether this attack still requires a user-facing Damage / Critical Damage action.
 * @param {string|null|undefined} outcome
 * @returns {"damage"|"critical"|null}
 */
export function playerStrikeDamageActionKind(outcome) {
  if (outcome === "success") return "damage";
  if (outcome === "criticalSuccess") return "critical";
  return null;
}

export function playerStrikeIsHit(outcome) {
  return HIT_OUTCOMES.has(outcome);
}

/**
 * Invariant: never hide a native attack card while damage is still required
 * unless the canonical presentation already exposes an equivalent action and
 * the native continuation button remains present for delegation.
 */
export function canSuppressPlayerStrikeNativeAttack({
  transactionState,
  outcome,
  hasCanonicalDamageAction,
  hasNativeDamageControl,
  hasCanonicalPresentation,
} = {}) {
  if (!hasCanonicalPresentation) return false;
  if (transactionState !== TRANSACTION_STATES.WAITING_FOR_DAMAGE) return true;
  if (!playerStrikeIsHit(outcome)) return true;
  return hasCanonicalDamageAction === true && hasNativeDamageControl === true;
}

export function canShowPlayerStrikeUndo(transaction, { isGM, undoEnabled } = {}) {
  return Boolean(
    isGM &&
    undoEnabled &&
    transaction?.state === TRANSACTION_STATES.APPLIED &&
    !transaction.undoBlocked,
  );
}

export function canShowPlayerStrikeAppliedAmount(transaction, { isGM, canViewMessage } = {}) {
  if (isGM) return true;
  return Boolean(
    transaction?.applicationMessageId &&
    typeof canViewMessage === "function" &&
    canViewMessage(transaction.applicationMessageId),
  );
}
