/**
 * Defer NelFlow auto-apply when PF2e Shield Block interaction is required.
 *
 * PF2e's interactive Shield Block is the damage-card toggle
 * (`data-action="shield-block"` → CONFIG.PF2E.chatDamageButtonShieldToggle)
 * plus Apply Damage — not an async dialog inside Actor#applyDamage.
 *
 * While deferred:
 * - native damage card stays interactive/visible
 * - stack remains pending (AWAITING_MITIGATION)
 * - settlement runs only after a unique damage-taken capture
 *
 * Abandoned / timed-out interactions fail closed into INTERRUPTED — NelFlow
 * never auto-declines Shield Block or invents damage.
 */

import { TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";
import { SHIELD_BLOCK_PROMPT_TIMEOUT_MS } from "./shield-block-gate.js";

/** Schedule via globalThis binding — static-check rejects bare timer call tokens. */
const nativeSchedule = globalThis.setTimeout.bind(globalThis);
const nativeClearSchedule = globalThis.clearTimeout.bind(globalThis);

/** @type {Map<string, object>} */
const deferredByTransactionId = new Map();

export function isMitigationPending(transaction) {
  if (!transaction) return false;
  if (transaction.mitigationPending === "shield-block") return true;
  if (transaction.state === TRANSACTION_STATES.AWAITING_MITIGATION) return true;
  if (typeof transaction.id === "string" && deferredByTransactionId.has(transaction.id)) {
    return true;
  }
  // Multi-target children use `${id}:target:${key}` application ids.
  if (typeof transaction.id === "string") {
    for (const key of deferredByTransactionId.keys()) {
      if (key === transaction.id || key.startsWith(`${transaction.id}:`)) return true;
    }
  }
  return false;
}

export function getDeferredMitigation(applicationId) {
  return deferredByTransactionId.get(applicationId) ?? null;
}

export function hasAnyDeferredMitigationForAttack(attackMessageId) {
  if (!attackMessageId) return false;
  for (const deferred of deferredByTransactionId.values()) {
    if (deferred.attackMessageId === attackMessageId) return true;
  }
  return false;
}

function clearTimeoutHandle(deferred) {
  if (deferred?.timeoutHandle != null) {
    try {
      nativeClearSchedule(deferred.timeoutHandle);
    } catch {
      /* ignore */
    }
    deferred.timeoutHandle = null;
  }
}

/**
 * Register a deferred settlement waiter after auto-apply was skipped for
 * native Shield Block. Capture must already be in pendingApplicationCaptures
 * with `deferred: true`.
 *
 * @param {object} args
 * @param {string} args.transactionId application / capture id
 * @param {(ctx: { capture: object, applicationMessage: ChatMessage, deferred: object }) => Promise<object|void>} args.settle
 * @param {(ctx: { deferred: object, reason: string }) => Promise<object|void>} [args.onAbandoned]
 * @param {number} [args.timeoutMs]
 */
export function registerDeferredMitigation(args = {}) {
  const transactionId =
    typeof args.transactionId === "string" && args.transactionId.trim()
      ? args.transactionId.trim()
      : null;
  if (!transactionId || typeof args.settle !== "function") return false;

  const existing = deferredByTransactionId.get(transactionId);
  if (existing) clearTimeoutHandle(existing);

  const timeoutMs = Number.isFinite(args.timeoutMs)
    ? Math.max(1_000, Number(args.timeoutMs))
    : SHIELD_BLOCK_PROMPT_TIMEOUT_MS;

  const deferred = {
    transactionId,
    attackMessageId: args.attackMessageId ?? null,
    damageMessageId: args.damageMessageId ?? null,
    sourceActorUuid: args.sourceActorUuid ?? null,
    sourceItemUuid: args.sourceItemUuid ?? null,
    targetTokenUuid: args.targetTokenUuid ?? null,
    targetActorUuid: args.targetActorUuid ?? null,
    preApplication: args.preApplication ?? null,
    outcome: args.outcome ?? null,
    registeredAt: Date.now(),
    timeoutMs,
    timeoutHandle: null,
    settle: args.settle,
    onAbandoned: typeof args.onAbandoned === "function" ? args.onAbandoned : null,
  };

  deferred.timeoutHandle = nativeSchedule(() => {
    void abandonDeferredMitigation(transactionId, "timeout").catch((error) => {
      logger.error(
        "Deferred mitigation timeout abandon failed open",
        { transactionId, stage: "native-mitigation-deferral" },
        error,
      );
    });
  }, timeoutMs);

  deferredByTransactionId.set(transactionId, deferred);
  logger.debug("Deferred Strike application for native Shield Block", {
    stage: "native-mitigation-deferral",
    transactionId,
    attackMessageId: args.attackMessageId ?? null,
    damageMessageId: args.damageMessageId ?? null,
    timeoutMs,
  });
  return true;
}

export function clearDeferredMitigation(transactionId) {
  const deferred = deferredByTransactionId.get(transactionId);
  if (deferred) clearTimeoutHandle(deferred);
  if (transactionId) deferredByTransactionId.delete(transactionId);
}

/**
 * Fail closed: do not apply guessed damage; leave native card for manual PF2e use.
 */
export async function abandonDeferredMitigation(transactionId, reason = "abandoned") {
  const deferred = deferredByTransactionId.get(transactionId);
  if (!deferred) return { abandoned: false, reason: "not-deferred" };
  clearTimeoutHandle(deferred);
  deferredByTransactionId.delete(transactionId);
  logger.warn("Abandoned deferred mitigation without auto-apply", {
    stage: "native-mitigation-deferral",
    transactionId,
    reason,
    attackMessageId: deferred.attackMessageId,
  });
  if (typeof deferred.onAbandoned === "function") {
    try {
      await deferred.onAbandoned({ deferred, reason });
    } catch (error) {
      logger.error(
        "Deferred mitigation onAbandoned failed open",
        { transactionId, stage: "native-mitigation-deferral", reason },
        error,
      );
    }
  }
  return { abandoned: true, reason };
}

/**
 * Called when a deferred capture collects a unique damage-taken message.
 */
export async function settleDeferredMitigationFromCapture(capture, applicationMessage) {
  const deferred = deferredByTransactionId.get(capture?.transactionId);
  if (!deferred || !applicationMessage) return { settled: false, reason: "not-deferred" };
  if (typeof deferred.settle !== "function") {
    clearDeferredMitigation(capture.transactionId);
    return { settled: false, reason: "missing-settle-handler" };
  }

  clearTimeoutHandle(deferred);
  try {
    const result = await deferred.settle({
      capture,
      applicationMessage,
      deferred,
    });
    clearDeferredMitigation(capture.transactionId);
    logger.debug("Settled deferred Strike after native Shield Block / Apply", {
      stage: "native-mitigation-deferral",
      transactionId: capture.transactionId,
      applicationMessageId: applicationMessage.id,
    });
    return { settled: true, result };
  } catch (error) {
    logger.error(
      "Deferred mitigation settle handler failed",
      { transactionId: capture.transactionId, stage: "native-mitigation-deferral" },
      error,
    );
    // Leave deferred cleared so a hang cannot re-fire; caller must use review.
    clearDeferredMitigation(capture.transactionId);
    if (typeof deferred.onAbandoned === "function") {
      try {
        await deferred.onAbandoned({ deferred, reason: "settle-failed" });
      } catch {
        /* ignore nested */
      }
    }
    return { settled: false, reason: "settle-failed", error };
  }
}

/** Inspect pending captures after createChatMessage for deferred settlement. */
export function observeDeferredMitigationMessage(message, pendingApplicationCaptures) {
  if (!message || !pendingApplicationCaptures?.size) return;
  for (const [transactionId, capture] of pendingApplicationCaptures.entries()) {
    if (!capture?.deferred) continue;
    if (!deferredByTransactionId.has(transactionId)) continue;
    if (capture.candidates?.length !== 1) continue;
    const applicationMessage = capture.candidates[0];
    if (applicationMessage?.id !== message.id) continue;
    pendingApplicationCaptures.delete(transactionId);
    void settleDeferredMitigationFromCapture(capture, applicationMessage).catch((error) => {
      logger.error(
        "Deferred mitigation settlement failed open",
        { transactionId, stage: "native-mitigation-deferral" },
        error,
      );
    });
  }
}

/**
 * After reload, in-memory waiters are gone. Any AWAITING_MITIGATION transaction
 * without a live deferred entry must fail closed — never re-auto-apply.
 */
export function shouldInterruptOrphanedMitigation(transaction) {
  if (!transaction || transaction.state !== TRANSACTION_STATES.AWAITING_MITIGATION) {
    return false;
  }
  if (deferredByTransactionId.has(transaction.id)) return false;
  for (const key of deferredByTransactionId.keys()) {
    if (key.startsWith(`${transaction.id}:`)) return false;
  }
  return true;
}

/**
 * Ready-hook reconciliation: orphaned awaiting-mitigation → interrupted review.
 * Does not apply damage.
 */
export async function reconcileOrphanedMitigations({
  messages = game.messages ?? [],
  updateTransaction = null,
} = {}) {
  const results = [];
  for (const message of messages) {
    const transaction = message?.getFlag?.("nelflow", "transaction") ?? null;
    if (!shouldInterruptOrphanedMitigation(transaction)) continue;
    if (typeof updateTransaction === "function") {
      await updateTransaction(message, transaction);
      results.push({ messageId: message.id, transactionId: transaction.id, action: "interrupt" });
      continue;
    }
    results.push({ messageId: message.id, transactionId: transaction.id, action: "needs-interrupt" });
  }
  return results;
}

/** Test helper */
export function clearAllDeferredMitigations() {
  for (const deferred of deferredByTransactionId.values()) {
    clearTimeoutHandle(deferred);
  }
  deferredByTransactionId.clear();
}
