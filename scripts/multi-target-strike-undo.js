import { MODULE_ID, SETTINGS } from "./constants.js";
import { guardedHealthRestore } from "./guarded-health-restore.js";
import {
  batchState,
  canUndoBatchChild,
  MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
} from "./multi-target-strike-model.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";

const queues = new Map();

function enqueue(id, operation) {
  const prior = queues.get(id) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  queues.set(id, current);
  return current.finally(() => {
    if (queues.get(id) === current) queues.delete(id);
  });
}

function exactHealth(left, right) {
  return left?.hp === right?.hp && left?.tempHp === right?.tempHp;
}

function authoritativeUndoChild(attackMessage, transaction, child) {
  if (
    transaction.id !== TransactionStore.deterministicId(attackMessage) ||
    transaction.snapshot?.sourceActorUuid !== attackMessage.actor?.uuid
  ) return null;
  if (transaction.snapshot.actorType === "npc") {
    return attackMessage.author?.isGM ? child : null;
  }
  if (transaction.snapshot.actorType !== "character" || !child.applicationMessageId) return null;
  const applicationMessage = game.messages?.get(child.applicationMessageId);
  const proof = applicationMessage?.getFlag?.(MODULE_ID, "multiTargetApplicationProof");
  const marker = applicationMessage?.getFlag?.(MODULE_ID, "transaction");
  const exact =
    applicationMessage?.author?.isGM &&
    applicationMessage.author.id === proof?.processingUserId &&
    proof?.processingUserId === transaction.snapshot.processingUserId &&
    proof?.transactionId === transaction.id &&
    proof?.attackMessageId === attackMessage.id &&
    proof?.targetKey === child.key &&
    proof?.targetTokenUuid === child.tokenUuid &&
    proof?.targetActorUuid === child.actorUuid &&
    marker?.id === transaction.id &&
    marker?.attackMessageId === attackMessage.id &&
    marker?.role === "application" &&
    marker?.targetKey === child.key &&
    exactHealth(proof.preApplication, child.preApplication) &&
    exactHealth(proof.postApplication, child.postApplication);
  return exact ? { ...child, preApplication: proof.preApplication, postApplication: proof.postApplication } : null;
}

function restoreChild(child) {
  return guardedHealthRestore({
    resolveToken: (uuid) => PF2eAdapter.resolveToken(uuid),
    healthSnapshot: (actor) => PF2eAdapter.healthSnapshot(actor),
    restoreHealth: (actor, health) => PF2eAdapter.restoreHealth(actor, health),
    targetTokenUuid: child.tokenUuid,
    targetActorUuid: child.actorUuid,
    preApplication: child.preApplication,
    postApplication: child.postApplication,
  });
}

export function undoMultiTarget(message, targetKey, update) {
  return enqueue(message.id, async () => {
    if (!game.user?.isGM || !getSetting(SETTINGS.ENABLE_UNDO)) return { ok: false, reason: "unauthorized" };
    const resolved = TransactionStore.resolveCanonical(message);
    const attackMessage = resolved?.attackMessage ?? message;
    let transaction = TransactionStore.get(attackMessage);
    if (transaction?.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE) return { ok: false, reason: "unavailable" };
    if (transaction.snapshot?.processingUserId !== game.user.id) return { ok: false, reason: "unauthorized" };
    const child = transaction.targets.find((candidate) => candidate.key === String(targetKey));
    if (!canUndoBatchChild(child)) return { ok: false, reason: "unavailable" };
    const verifiedChild = authoritativeUndoChild(attackMessage, transaction, child);
    if (!verifiedChild) return { ok: false, reason: "unavailable" };
    const restored = await restoreChild(verifiedChild);
    const targets = transaction.targets.map((candidate) => candidate.key !== child.key
      ? candidate
      : restored.ok
        ? { ...candidate, state: "undone", undoBlocked: false }
        : { ...candidate, state: "undo-blocked", undoBlocked: true, reviewReason: restored.reason });
    transaction = await update(attackMessage, { targets, state: batchState(targets) });
    return restored;
  });
}

export function undoAllMultiTarget(message, update) {
  return enqueue(message.id, async () => {
    if (!game.user?.isGM || !getSetting(SETTINGS.ENABLE_UNDO)) return [];
    const resolved = TransactionStore.resolveCanonical(message);
    const attackMessage = resolved?.attackMessage ?? message;
    const transaction = TransactionStore.get(attackMessage);
    if (transaction?.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE) return [];
    if (transaction.snapshot?.processingUserId !== game.user.id) return [];
    const candidates = transaction.targets
      .filter(canUndoBatchChild)
      // Reverse application order preserves chained snapshots when two tokens share an actor.
      .sort((left, right) => (right.appliedSequence ?? right.order) - (left.appliedSequence ?? left.order));
    const results = [];
    for (const child of candidates) {
      const verifiedChild = authoritativeUndoChild(attackMessage, transaction, child);
      if (!verifiedChild) {
        results.push({ key: child.key, ok: false, reason: "unavailable" });
        continue;
      }
      results.push({ key: child.key, ...await restoreChild(verifiedChild) });
    }
    const current = TransactionStore.get(attackMessage);
    const targets = current.targets.map((child) => {
      const result = results.find((candidate) => candidate.key === child.key);
      if (!result) return child;
      return result.ok
        ? { ...child, state: "undone", undoBlocked: false }
        : { ...child, state: "undo-blocked", undoBlocked: true, reviewReason: result.reason };
    });
    await update(attackMessage, { targets, state: batchState(targets) });
    return results;
  });
}
