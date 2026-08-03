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
