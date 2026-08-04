import { TRANSACTION_DIAGNOSTIC_MODES } from "./constants.js";

const CLEAN_TERMINAL_STATES = new Set([
  "applied",
  "complete",
  "completed",
  "skipped",
  "undone",
  "no-damage",
  "external",
  "cancelled",
]);

const EXCEPTIONAL_STATES = new Set([
  "abandoned",
  "ambiguous",
  "error",
  "failed",
  "interrupted",
  "manual",
  "orphaned",
  "partial",
  "result-changed-after-application",
  "undo-blocked",
]);

const ATTENTION_RECOVERY_STATES = new Set([
  "available",
  "running",
  "failed",
  "manual",
  "abandoned",
]);

const RECOVERY_PRESENTATION_STATES = new Set([
  "abandoned",
  "ambiguous",
  "error",
  "failed",
  "interrupted",
  "manual",
  "orphaned",
  "partial",
  "result-changed-after-application",
  "undo-blocked",
]);

/** Pure viewer policy. Transaction flags and recovery data remain untouched. */
export function transactionNeedsDiagnosticAttention(descriptor) {
  const transaction = descriptor?.transaction ?? {};
  const state = String(transaction.state ?? transaction.phase ?? "unknown").toLowerCase();
  const recoveryState = String(transaction.recovery?.status ?? "none").toLowerCase();
  if (
    transaction.presentationError ||
    transaction.undoBlocked ||
    transaction.orphaned ||
    ["failed", "interrupted"].includes(transaction.undoOperation?.state) ||
    ATTENTION_RECOVERY_STATES.has(recoveryState) ||
    EXCEPTIONAL_STATES.has(state)
  ) return true;
  if (
    state === "skipped" &&
    transaction.failure?.code === "player-strike-not-a-hit"
  ) return false;
  if (transaction.failure) return true;
  return !CLEAN_TERMINAL_STATES.has(state);
}

export function visibleDiagnosticDescriptors(descriptors, mode) {
  const available = Array.isArray(descriptors) ? descriptors : [];
  if (mode === TRANSACTION_DIAGNOSTIC_MODES.OFF) return [];
  if (mode === TRANSACTION_DIAGNOSTIC_MODES.ALWAYS) return available;
  if (mode === TRANSACTION_DIAGNOSTIC_MODES.ERRORS_ONLY) {
    return available.filter(transactionNeedsDiagnosticAttention);
  }
  // Unknown stored values fail closed to exception-only presentation.
  return available.filter(transactionNeedsDiagnosticAttention);
}

/**
 * Ordinary chat never renders diagnostics. This narrower policy selects only
 * transactions that need a concise recovery/review affordance; transient
 * waiting and applying states remain represented by their existing workflow
 * summaries and cannot create a diagnostic flash.
 */
export function transactionNeedsRecoveryPresentation(descriptor) {
  const transaction = descriptor?.transaction ?? {};
  const state = String(transaction.state ?? transaction.phase ?? "unknown").toLowerCase();
  const recoveryState = String(transaction.recovery?.status ?? "none").toLowerCase();
  if (state === "skipped" && transaction.failure?.code === "player-strike-not-a-hit") {
    return false;
  }
  return Boolean(
    transaction.presentationError ||
      transaction.undoBlocked ||
      transaction.orphaned ||
      ["failed", "interrupted"].includes(transaction.undoOperation?.state) ||
      ATTENTION_RECOVERY_STATES.has(recoveryState) ||
      RECOVERY_PRESENTATION_STATES.has(state) ||
      transaction.failure,
  );
}

export function recoveryStatusKey(descriptor) {
  const transaction = descriptor?.transaction ?? {};
  const state = String(transaction.state ?? transaction.phase ?? "unknown").toLowerCase();
  if (transaction.undoBlocked || state === "undo-blocked") {
    return "Nelflow.Recovery.Status.UndoUnsafe";
  }
  if (["failed", "interrupted"].includes(transaction.undoOperation?.state)) {
    return "Nelflow.Recovery.Status.UndoReview";
  }
  if (transaction.presentationError) return "Nelflow.Recovery.Status.DisplayIssue";
  if (state === "interrupted") return "Nelflow.Recovery.Status.Interrupted";
  if (["ambiguous", "orphaned", "result-changed-after-application"].includes(state)) {
    return "Nelflow.Recovery.Status.Unverified";
  }
  if (state === "partial") return "Nelflow.Recovery.Status.Partial";
  return "Nelflow.Recovery.Status.NotApplied";
}
