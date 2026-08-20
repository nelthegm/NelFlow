/**
 * Durable in-memory record of the most recent hook-boundary failure.
 * Survives Foundry console Object collapsing; no Documents or Rolls.
 */

/** @type {object|null} */
let lastBoundaryFailure = null;

function safeString(value, max = 256) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function safeStack(stack) {
  if (typeof stack !== "string" || !stack.trim()) return null;
  return stack.split("\n").slice(0, 24).join(" | ").slice(0, 2000);
}

/**
 * @param {object} record
 */
export function recordLastBoundaryFailure(record = {}) {
  lastBoundaryFailure = {
    occurredAt: Number.isFinite(record.occurredAt) ? record.occurredAt : Date.now(),
    hook: safeString(record.hook, 80),
    subsystem: safeString(record.subsystem ?? record.hook, 80),
    operation: safeString(record.operation, 80),
    messageId: safeString(record.messageId, 128),
    messageType: safeString(record.messageType, 64),
    transactionId: safeString(record.transactionId, 128),
    transactionKind: safeString(record.transactionKind ?? record.messageType, 64),
    transactionState: safeString(record.transactionState, 64),
    step: safeString(record.step, 80),
    errorName: safeString(record.errorName, 80),
    errorMessage: safeString(record.errorMessage, 500),
    stack: safeStack(record.stack),
    context: sanitizeContext(record.context),
  };
  try {
    JSON.parse(JSON.stringify(lastBoundaryFailure));
  } catch {
    lastBoundaryFailure = {
      occurredAt: lastBoundaryFailure.occurredAt,
      errorName: "serialization-failure",
      errorMessage: safeString(record.errorMessage, 200),
    };
  }
  return lastBoundaryFailure;
}

function sanitizeContext(context) {
  if (!context || typeof context !== "object") return {};
  const out = {};
  for (const key of [
    "sourceActorUuid",
    "sourceTokenUuid",
    "targetTokenUuid",
    "itemUuid",
    "attackMessageId",
    "damageMessageId",
  ]) {
    const value = safeString(context[key], 128);
    if (value) out[key] = value;
  }
  return out;
}

export function getLastBoundaryFailure() {
  if (!lastBoundaryFailure) return null;
  return JSON.parse(JSON.stringify(lastBoundaryFailure));
}

export function clearLastBoundaryFailure() {
  lastBoundaryFailure = null;
  return { cleared: true };
}

/** Test-only */
export function resetBoundaryFailureStoreForTests() {
  lastBoundaryFailure = null;
}
