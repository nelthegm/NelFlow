import { TRANSACTION_STATES } from "./constants.js";

/**
 * The exact native damage card is the preferred augmentation host. The native
 * application record is a privacy-safe fallback when the viewer cannot access
 * that damage card. The attack card is deliberately never an ordinary Nelflow
 * host: PF2e alone owns character attack presentation and continuation controls.
 */
export function playerStrikePresentationCandidates(transaction) {
  const ordered = [
    transaction?.damageMessageId,
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

export function shouldRenderPlayerStrikeApplication(transaction) {
  return ["applying", "applied", "undone", "undo-blocked"].includes(
    playerStrikePresentationState(transaction),
  );
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
