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
    attackMessageId: context.attackMessageId ?? null,
    transactionId: context.transactionId ?? null,
    sourceActorUuid: context.sourceActorUuid ?? null,
    targetActorUuid: context.targetActorUuid ?? null,
    stage: context.stage ?? "unknown",
    reason: context.reason ?? null,
  };
}

export const logger = Object.freeze({
  debug(message, data) {
    if (debugEnabled()) console.debug(LOG_PREFIX, message, data ?? "");
  },

  warn(message, context, error) {
    console.warn(LOG_PREFIX, message, withContext(context), error ?? "");
  },

  error(message, context, error) {
    console.error(LOG_PREFIX, message, withContext(context), error ?? "");
  },
});
