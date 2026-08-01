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
    attackMessageId: short(context.attackMessageId),
    transactionId: short(context.transactionId),
    stage: context.stage ?? "unknown",
    reason: safeScalar(context.reason),
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

function sanitize(value, key = "", depth = 0) {
  if (depth > 4) return "[depth-capped]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/uuid|messageid|transactionid|integrationid|applicationid|resolverid|userid/i.test(key)) return short(value);
    return safeScalar(value);
  }
  if (Array.isArray(value)) {
    if (/target|option|flag|roll/i.test(key)) return `[${value.length} entries redacted]`;
    return value.slice(0, 12).map((entry) => sanitize(entry, key, depth + 1));
  }
  if (typeof value !== "object") return safeScalar(value);
  const result = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (/name|formula|total|snapshot|flags?|rolloptions?|content|flavor|cookie|url|socket|credential/i.test(entryKey)) {
      result[entryKey] = "[redacted]";
      continue;
    }
    if (/uuid/i.test(entryKey)) {
      result[entryKey] = short(entryValue);
      continue;
    }
    result[entryKey] = sanitize(entryValue, entryKey, depth + 1);
  }
  return result;
}

export const logger = Object.freeze({
  debug(message, data) {
    if (debugEnabled()) console.debug(LOG_PREFIX, message, sanitize(data ?? ""));
  },

  warn(message, context, error) {
    console.warn(LOG_PREFIX, message, withContext(context));
  },

  error(message, context, error) {
    console.error(LOG_PREFIX, message, withContext(context));
  },
});
