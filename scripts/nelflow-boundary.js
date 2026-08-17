import { logger } from "./logger.js";
import { createFailureRecord, shortId } from "./transaction-failure.js";

const notified = new Set();
const reported = new Set();

function readErrorContext(error) {
  const ctx = error?.nelflowContext;
  if (!ctx || typeof ctx !== "object") return {};
  return {
    transactionId: ctx.transactionId ?? null,
    messageId: ctx.messageId ?? null,
    messageType: ctx.messageType ?? null,
    state: ctx.state ?? null,
  };
}

function failureIdentity(options, failure, error) {
  const errorName = error instanceof Error ? error.name : "unknown-error";
  const errorMessage = error instanceof Error ? error.message : String(error ?? failure.code);
  const enriched = readErrorContext(error);
  return [
    failure.subsystem,
    failure.operation,
    failure.safeContext?.messageIdShort ?? shortId(options.messageId ?? enriched.messageId),
    shortId(options.transactionId ?? enriched.transactionId),
    errorName,
    errorMessage,
  ].join(":");
}

function notifyOnce(failure, identity) {
  if (!game.user?.isGM) return;
  const key = identity ?? `${failure.subsystem}:${failure.operation}:${failure.safeContext.messageIdShort}`;
  if (notified.has(key)) return;
  notified.add(key);
  ui.notifications?.warn?.("Nelflow.Notification.TransactionNeedsReview", { localize: true });
}

function boundaryFailure(options, reason = "internal-exception", error = null) {
  const enriched = readErrorContext(error);
  return createFailureRecord({
    code: "internal-exception",
    reason,
    subsystem: options.subsystem,
    operation: options.operation,
    state: options.state ?? enriched.state,
    recoverable: true,
    context: {
      messageId: options.messageId ?? enriched.messageId,
      transactionId: options.transactionId ?? enriched.transactionId,
      sourceKind: options.transactionType ?? enriched.messageType,
      userRole: game.user?.isGM ? "gm" : "player",
    },
  });
}

function report(options, failure, error) {
  const enriched = readErrorContext(error);
  const identity = failureIdentity(options, failure, error);
  const diagnostic = {
    hook: options.hook ?? options.subsystem ?? null,
    operation: options.operation ?? null,
    messageId: options.messageId ?? enriched.messageId ?? null,
    messageType: options.messageType ?? options.transactionType ?? enriched.messageType ?? null,
    transactionId: options.transactionId ?? enriched.transactionId ?? null,
    attackMessageId: options.messageId ?? enriched.messageId ?? null,
    stage: `${failure.subsystem}:${failure.operation}`,
    reason: failure.code,
    errorName: error instanceof Error ? error.name : error == null ? null : "unknown-error",
    errorMessage: error instanceof Error ? error.message : error == null ? failure.code : String(error),
    stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
  };
  logger.debug("transaction-failure-recorded", diagnostic, error);
  if (!reported.has(identity)) {
    reported.add(identity);
    logger.warn("hook-boundary-failed", diagnostic, error);
  }
  notifyOnce(failure, identity);
}

export async function runNelflowBoundary(options) {
  try {
    return { ok: true, value: await options.task(), failure: null };
  } catch (error) {
    const failure = boundaryFailure(options, error instanceof Error ? error.name : "unknown-error", error);
    try {
      await options.onFailure?.(failure);
    } catch {
      // Boundary reporting must never replace the original safe failure.
    }
    report(options, failure, error);
    return { ok: false, value: null, failure };
  }
}

export function runNelflowSyncBoundary(options) {
  try {
    return { ok: true, value: options.task(), failure: null };
  } catch (error) {
    const failure = boundaryFailure(options, error instanceof Error ? error.name : "unknown-error", error);
    try {
      options.onFailure?.(failure);
    } catch {
      // Rendering and hook registration still fail open.
    }
    report(options, failure, error);
    return { ok: false, value: null, failure };
  }
}

/** Test-only: clear once-per-identity boundary report/notification caches. */
export function resetNelflowBoundaryDiagnosticsForTests() {
  notified.clear();
  reported.clear();
}
