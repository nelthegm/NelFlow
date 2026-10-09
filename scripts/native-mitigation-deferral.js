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
 */

import { TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";

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

/**
 * Register a deferred settlement waiter after auto-apply was skipped for
 * native Shield Block. Capture must already be in pendingApplicationCaptures
 * with `deferred: true`.
 *
 * @param {object} args
 * @param {string} args.transactionId application / capture id
 * @param {(ctx: { capture: object, applicationMessage: ChatMessage, deferred: object }) => Promise<object|void>} args.settle
 */
export function registerDeferredMitigation(args = {}) {
  const transactionId =
    typeof args.transactionId === "string" && args.transactionId.trim()
      ? args.transactionId.trim()
      : null;
  if (!transactionId || typeof args.settle !== "function") return false;
  deferredByTransactionId.set(transactionId, {
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
    settle: args.settle,
  });
  logger.debug("Deferred Strike application for native Shield Block", {
    stage: "native-mitigation-deferral",
    transactionId,
    attackMessageId: args.attackMessageId ?? null,
    damageMessageId: args.damageMessageId ?? null,
  });
  return true;
}

export function clearDeferredMitigation(transactionId) {
  if (transactionId) deferredByTransactionId.delete(transactionId);
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

/** Test helper */
export function clearAllDeferredMitigations() {
  deferredByTransactionId.clear();
}
