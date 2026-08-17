import { LOG_PREFIX, SETTINGS } from "./constants.js";
import { getSetting } from "./settings.js";

function debugEnabled() {
  try {
    return Boolean(game?.settings && getSetting(SETTINGS.DEBUG));
  } catch {
    return false;
  }
}

function short(value) {
  const text = String(value ?? "");
  return text ? text.slice(-10) : null;
}

function safeScalar(value) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  return String(value).replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 100);
}

/** Keep exception text readable in exported logs (do not collapse to "Object"). */
function safeErrorText(value, max = 500) {
  if (value == null) return null;
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]+/g, "?")
    .slice(0, max);
}

function serializeStack(stack) {
  if (typeof stack !== "string" || !stack.trim()) return null;
  return stack
    .split("\n")
    .slice(0, 16)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeErrorText(line, 200))
    .join(" | ")
    .slice(0, 1200);
}

function errorFields(error) {
  if (error == null) return {};
  if (error instanceof Error) {
    return {
      errorName: safeErrorText(error.name, 80),
      errorMessage: safeErrorText(error.message, 500),
      stack: serializeStack(error.stack),
    };
  }
  return {
    errorName: "unknown-error",
    errorMessage: safeErrorText(error, 500),
    stack: null,
  };
}

function withContext(context = {}) {
  return {
    hook: context.hook == null ? null : safeScalar(context.hook),
    operation: context.operation == null ? null : safeScalar(context.operation),
    messageId: context.messageId == null && context.attackMessageId == null
      ? null
      : String(context.messageId ?? context.attackMessageId),
    messageType: context.messageType == null ? null : safeScalar(context.messageType),
    attackMessageId: context.attackMessageId == null && context.messageId == null
      ? null
      : String(context.attackMessageId ?? context.messageId),
    transactionId: context.transactionId == null ? null : String(context.transactionId),
    stage: context.stage == null ? "unknown" : String(context.stage),
    reason: context.reason == null ? null : safeScalar(context.reason),
    errorName: context.errorName == null ? null : safeErrorText(context.errorName, 80),
    errorMessage: context.errorMessage == null ? null : safeErrorText(context.errorMessage, 500),
    stack: serializeStack(context.stack),
  };
}

/**
 * Flat JSON string so exported browser logs include fields without expanding Objects.
 * Foundry/log exporters often display a separate Object argument as "Object".
 */
export function formatDiagnostic(context = {}, error) {
  const payload = {
    ...withContext(context),
    ...errorFields(error),
  };
  if (context.errorName != null && !payload.errorName) payload.errorName = safeErrorText(context.errorName, 80);
  if (context.errorMessage != null && !payload.errorMessage) {
    payload.errorMessage = safeErrorText(context.errorMessage, 500);
  }
  if (context.stack != null && !payload.stack) payload.stack = serializeStack(context.stack);
  // Prefer full ids in boundary diagnostics (shorten only for noisy uuid-like keys elsewhere).
  if (payload.messageId && String(payload.messageId).length > 80) payload.messageId = short(payload.messageId);
  if (payload.attackMessageId && String(payload.attackMessageId).length > 80) {
    payload.attackMessageId = short(payload.attackMessageId);
  }
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

function write(level, message, context, error) {
  const line = `${LOG_PREFIX} ${message} ${formatDiagnostic(context ?? {}, error)}`;
  if (level === "debug") console.debug(line);
  else if (level === "error") console.error(line);
  else console.warn(line);
}

export const logger = Object.freeze({
  debug(message, data, error) {
    if (debugEnabled()) write("debug", message, data ?? {}, error);
  },

  warn(message, context, error) {
    write("warn", message, context ?? {}, error);
  },

  error(message, context, error) {
    write("error", message, context ?? {}, error);
  },
});
