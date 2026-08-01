import { logger } from "./logger.js";
import { createFailureRecord, shortId } from "./transaction-failure.js";

const notified = new Set();

function notifyOnce(failure) {
  if (!game.user?.isGM) return;
  const key = `${failure.subsystem}:${failure.operation}:${failure.safeContext.messageIdShort}`;
  if (notified.has(key)) return;
  notified.add(key);
  ui.notifications?.warn?.("Nelflow.Notification.TransactionNeedsReview", { localize: true });
}

function boundaryFailure(options, reason = "internal-exception") {
  return createFailureRecord({
    code: "internal-exception",
    reason,
    subsystem: options.subsystem,
    operation: options.operation,
    state: options.state,
    recoverable: true,
    context: {
      messageId: options.messageId,
      transactionId: options.transactionId,
      sourceKind: options.transactionType,
      userRole: game.user?.isGM ? "gm" : "player",
    },
  });
}

function report(options, failure) {
  logger.debug("transaction-failure-recorded", {
    transactionId: shortId(options.transactionId),
    attackMessageId: shortId(options.messageId),
    stage: `${failure.subsystem}:${failure.operation}`,
    reason: failure.code,
  });
  logger.warn("hook-boundary-failed", {
    transactionId: shortId(options.transactionId),
    attackMessageId: shortId(options.messageId),
    stage: `${failure.subsystem}:${failure.operation}`,
    reason: failure.code,
  });
  notifyOnce(failure);
}

export async function runNelflowBoundary(options) {
  try {
    return { ok: true, value: await options.task(), failure: null };
  } catch (error) {
    const failure = boundaryFailure(options, error instanceof Error ? error.name : "unknown-error");
    try {
      await options.onFailure?.(failure);
    } catch {
      // Boundary reporting must never replace the original safe failure.
    }
    report(options, failure);
    return { ok: false, value: null, failure };
  }
}

export function runNelflowSyncBoundary(options) {
  try {
    return { ok: true, value: options.task(), failure: null };
  } catch (error) {
    const failure = boundaryFailure(options, error instanceof Error ? error.name : "unknown-error");
    try {
      options.onFailure?.(failure);
    } catch {
      // Rendering and hook registration still fail open.
    }
    report(options, failure);
    return { ok: false, value: null, failure };
  }
}
