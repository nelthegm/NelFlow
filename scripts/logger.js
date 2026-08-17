import { LOG_PREFIX, SETTINGS } from "./constants.js";
import { getSetting } from "./settings.js";

function debugEnabled() {
  try {
    return Boolean(game?.settings && getSetting(SETTINGS.DEBUG));
  } catch {
    return false;
  }
}

function withContext(context = {}) {
  return {
    hook: context.hook == null ? null : safeScalar(context.hook),
    operation: context.operation == null ? null : safeScalar(context.operation),
    messageId: short(context.messageId ?? context.attackMessageId),
    messageType: context.messageType == null ? null : safeScalar(context.messageType),
    attackMessageId: short(context.attackMessageId ?? context.messageId),
    transactionId: short(context.transactionId),
    stage: context.stage ?? "unknown",
    reason: safeScalar(context.reason),
    errorName: context.errorName == null ? null : safeScalar(context.errorName),
    errorMessage: context.errorMessage == null ? null : safeScalar(context.errorMessage),
    stack: serializeStack(context.stack),
  };
}

function short(value) {
  const text = String(value ?? "");
  return text ? text.slice(-10) : null;
}

function safeScalar(value) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  return String(value).replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 100);
}

function serializeStack(stack) {
  if (typeof stack !== "string" || !stack.trim()) return null;
  return stack
    .split("\n")
    .slice(0, 16)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1200);
}

function errorFields(error) {
  if (error == null) return {};
  if (error instanceof Error) {
    return {
      errorName: safeScalar(error.name),
      errorMessage: safeScalar(error.message),
      stack: serializeStack(error.stack),
    };
  }
  return {
    errorName: "unknown-error",
    errorMessage: safeScalar(error),
    stack: null,
  };
}

/** Flat JSON string so exported browser logs include fields without expanding Objects. */
function formatDiagnostic(context = {}, error) {
  const payload = {
    ...withContext(context),
    ...errorFields(error),
  };
  if (context.errorName != null && payload.errorName == null) payload.errorName = safeScalar(context.errorName);
  if (context.errorMessage != null && payload.errorMessage == null) {
    payload.errorMessage = safeScalar(context.errorMessage);
  }
  if (context.stack != null && payload.stack == null) payload.stack = serializeStack(context.stack);
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      stage: safeScalar(context.stage) ?? "unknown",
      reason: safeScalar(context.reason),
      errorName: "serialization-failure",
    });
  }
}

export const logger = Object.freeze({
  debug(message, data, error) {
    if (debugEnabled()) console.debug(LOG_PREFIX, message, formatDiagnostic(data ?? {}, error));
  },

  warn(message, context, error) {
    console.warn(LOG_PREFIX, message, formatDiagnostic(context ?? {}, error));
  },

  error(message, context, error) {
    console.error(LOG_PREFIX, message, formatDiagnostic(context ?? {}, error));
  },
});
