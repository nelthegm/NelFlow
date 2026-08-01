export const FAILURE_RECORD_SCHEMA_VERSION = 1;
export const AUDIT_RECORD_SCHEMA_VERSION = 1;
export const RECOVERY_RECORD_SCHEMA_VERSION = 1;
export const MAX_AUDIT_ENTRIES = 24;

export const FAILURE_CODES = Object.freeze([
  "source-message-missing", "source-actor-missing", "source-item-missing", "unsupported-source",
  "unsupported-source-version", "source-context-changed", "no-toolbelt-targets", "target-state-missing",
  "target-state-ambiguous", "target-fingerprint-changed", "target-actor-missing", "target-token-missing",
  "save-state-missing", "save-outcome-incomplete", "save-outcome-ambiguous", "unsupported-save-variant",
  "damage-message-missing", "damage-message-ambiguous", "damage-roll-missing", "damage-roll-unsupported",
  "damage-roll-index-mismatch", "damage-origin-mismatch", "external-roll-ambiguous", "autoroll-author-inactive",
  "autoroll-author-unauthorized", "autoroll-claim-failed", "autoroll-native-call-failed", "autoroll-no-message",
  "autoroll-multiple-messages", "autoroll-interrupted", "autoroll-choice-required", "application-authority-missing",
  "application-target-missing", "application-native-call-failed", "application-record-missing",
  "application-result-ambiguous", "application-interrupted", "undo-record-missing", "undo-target-changed",
  "undo-hp-changed", "undo-state-mismatch", "undo-native-call-failed", "guard-source-control-missing",
  "guard-target-control-missing", "guard-markup-unsupported", "guard-state-inconsistent", "transaction-stale",
  "transaction-interrupted", "transaction-conflict", "transaction-schema-unsupported", "internal-exception",
  "manual-review-required",
]);

const CODE_SET = new Set(FAILURE_CODES);
const REASON_MAP = new Map([
  ["toolbelt-targets-missing", "no-toolbelt-targets"],
  ["basic-save-variant-ambiguous", "unsupported-save-variant"],
  ["shared-damage-ambiguous", "damage-message-ambiguous"],
  ["damage-message-already-claimed", "transaction-conflict"],
  ["external-correlation-ambiguous", "external-roll-ambiguous"],
  ["native-damage-correlation-ambiguous", "autoroll-multiple-messages"],
  ["native-api-returned-no-roll", "autoroll-no-message"],
  ["native-api-threw", "autoroll-native-call-failed"],
  ["reload-interrupted-autoroll", "autoroll-interrupted"],
  ["damage-choice-dialog-enabled", "autoroll-choice-required"],
  ["rolling-user-unavailable", "autoroll-author-inactive"],
  ["source-permission-denied", "autoroll-author-unauthorized"],
  ["source-or-target-changed-after-claim", "target-fingerprint-changed"],
  ["source-identity-changed", "source-context-changed"],
  ["source-item-unavailable", "source-item-missing"],
  ["source-document-unavailable", "source-item-missing"],
  ["exact-document-unavailable", "application-target-missing"],
  ["native-application-failed", "application-native-call-failed"],
  ["reload-during-application", "application-interrupted"],
  ["reload-or-unobserved-application", "application-interrupted"],
  ["processing-gm-inactive", "application-authority-missing"],
  ["health-changed", "undo-hp-changed"],
  ["target-unavailable", "undo-target-changed"],
  ["unsupported-nelflow-transaction-schema", "transaction-schema-unsupported"],
  ["manual-review-required", "manual-review-required"],
]);

export const RECOVERY_STATUSES = Object.freeze({
  NONE: "none",
  AVAILABLE: "available",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  MANUAL: "manual",
  ABANDONED: "abandoned",
});

function slug(value, fallback = "unspecified") {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 80);
}

export function shortId(value, length = 10) {
  const text = String(value ?? "");
  return text ? text.slice(-length) : null;
}

export function failureCodeFor(reason, fallback = "internal-exception") {
  const safeReason = slug(reason);
  if (CODE_SET.has(safeReason)) return safeReason;
  if (REASON_MAP.has(safeReason)) return REASON_MAP.get(safeReason);
  if (safeReason.includes("target") && safeReason.includes("missing")) return "target-state-missing";
  if (safeReason.includes("target") && safeReason.includes("ambiguous")) return "target-state-ambiguous";
  if (safeReason.includes("damage") && safeReason.includes("missing")) return "damage-message-missing";
  if (safeReason.includes("damage") && safeReason.includes("ambiguous")) return "damage-message-ambiguous";
  if (safeReason.includes("interrupted")) return "transaction-interrupted";
  return CODE_SET.has(fallback) ? fallback : "internal-exception";
}

function safeContext(context = {}) {
  return {
    messageIdShort: shortId(context.messageId),
    transactionIdShort: shortId(context.transactionId),
    sourceKind: slug(context.sourceKind, "unknown"),
    rollIndex: Number.isInteger(context.rollIndex) ? context.rollIndex : null,
    userRole: ["gm", "player", "unknown"].includes(context.userRole) ? context.userRole : "unknown",
    count: Number.isInteger(context.count) ? Math.max(0, context.count) : null,
  };
}

export function createFailureRecord({
  code,
  reason,
  subsystem = "unknown",
  operation = "unknown",
  state = "unknown",
  recoverable = true,
  revision = 0,
  context = {},
  occurredAt = Date.now(),
} = {}) {
  const normalizedCode = failureCodeFor(code ?? reason);
  return {
    schemaVersion: FAILURE_RECORD_SCHEMA_VERSION,
    code: normalizedCode,
    subsystem: slug(subsystem, "unknown"),
    operation: slug(operation, "unknown"),
    state: slug(state, "unknown"),
    recoverable: recoverable === true,
    occurredAt,
    safeMessage: normalizedCode,
    safeContext: safeContext(context),
    revision: Number(revision) || 0,
  };
}

export function appendAudit(transaction, {
  event,
  state,
  subsystem,
  userRole = "unknown",
  safeReason = null,
  occurredAt = Date.now(),
  revision = null,
} = {}) {
  if (!transaction || !event) return transaction;
  const entry = {
    schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
    revision: Number(revision ?? transaction.revision ?? 0),
    event: slug(event),
    state: slug(state ?? transaction.state ?? transaction.phase ?? "unknown"),
    subsystem: slug(subsystem, "unknown"),
    occurredAt,
    userRole: ["gm", "player", "unknown"].includes(userRole) ? userRole : "unknown",
    safeReason: safeReason ? slug(safeReason) : null,
  };
  const audit = Array.isArray(transaction.audit) ? [...transaction.audit] : [];
  const last = audit.at(-1);
  if (
    last?.event === entry.event &&
    last.state === entry.state &&
    last.subsystem === entry.subsystem &&
    last.safeReason === entry.safeReason
  ) return transaction;
  audit.push(entry);
  transaction.audit = audit.slice(-MAX_AUDIT_ENTRIES);
  return transaction;
}

export function recordFailure(transaction, details = {}) {
  if (!transaction) return transaction;
  transaction.failure = createFailureRecord({
    ...details,
    state: details.state ?? transaction.state ?? transaction.phase,
    revision: details.revision ?? transaction.revision,
  });
  return appendAudit(transaction, {
    event: details.event ?? "application-failed",
    state: transaction.failure.state,
    subsystem: transaction.failure.subsystem,
    userRole: details.userRole,
    safeReason: transaction.failure.code,
    revision: transaction.failure.revision,
  });
}

export function ensureRecovery(transaction) {
  transaction.recovery ??= {
    schemaVersion: RECOVERY_RECORD_SCHEMA_VERSION,
    status: RECOVERY_STATUSES.NONE,
    lastAction: null,
    requestedByRole: null,
    requestedAt: null,
    completedAt: null,
    failureCode: null,
    revision: 0,
  };
  return transaction.recovery;
}

export function updateRecovery(transaction, { status, action, userRole = "gm", failureCode = null } = {}) {
  const recovery = ensureRecovery(transaction);
  recovery.status = status ?? recovery.status;
  recovery.lastAction = action ? slug(action) : recovery.lastAction;
  recovery.requestedByRole = userRole;
  recovery.requestedAt ??= Date.now();
  recovery.completedAt = [RECOVERY_STATUSES.COMPLETED, RECOVERY_STATUSES.MANUAL, RECOVERY_STATUSES.ABANDONED].includes(recovery.status)
    ? Date.now()
    : null;
  recovery.failureCode = failureCode ? failureCodeFor(failureCode) : null;
  recovery.revision = Number(recovery.revision ?? 0) + 1;
  return transaction;
}
