import { MODULE_ID, TRANSACTION_STATES } from "./constants.js";

const ALLOWED_TRANSITIONS = Object.freeze({
  [TRANSACTION_STATES.PROCESSING]: new Set([
    TRANSACTION_STATES.SKIPPED,
    TRANSACTION_STATES.DAMAGE_ROLLED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.DAMAGE_ROLLED]: new Set([
    TRANSACTION_STATES.APPLIED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.APPLIED]: new Set([
    TRANSACTION_STATES.UNDONE,
    TRANSACTION_STATES.FAILED,
  ]),
});

function now() {
  return Date.now();
}

function marker(transaction, role) {
  return {
    id: transaction.id,
    attackMessageId: transaction.attackMessageId,
    role,
    state: transaction.state,
  };
}

async function updateLinkedMarker(messageId, transaction, role) {
  if (!messageId || messageId === transaction.attackMessageId) return;
  const message = game.messages.get(messageId);
  if (!message) return;
  await message.setFlag(MODULE_ID, "transaction", marker(transaction, role));
}

export class TransactionStore {
  static get(message) {
    return message?.getFlag?.(MODULE_ID, "transaction") ?? null;
  }

  static deterministicId(attackMessage) {
    return `${MODULE_ID}-${attackMessage.id}`;
  }

  /**
   * Claim an attack message by persisting its immutable target snapshot before
   * any damage roll begins. Existing claims are never replaced.
   */
  static async claim(attackMessage, snapshot) {
    if (this.get(attackMessage)) return null;
    const timestamp = now();
    const transaction = {
      id: this.deterministicId(attackMessage),
      role: "attack",
      state: TRANSACTION_STATES.PROCESSING,
      attackMessageId: attackMessage.id,
      damageMessageId: null,
      applicationMessageId: null,
      stackRef: null,
      snapshot,
      preApplication: null,
      postApplication: null,
      appliedAmount: null,
      targetName: null,
      damageSummary: null,
      autoApplyRequested: Boolean(snapshot.autoApplyRequested),
      undoBlocked: false,
      presentationError: null,
      reasonKey: null,
      errorStage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);
    return this.get(attackMessage);
  }

  /** Move a transaction forward and synchronize compact markers on linked messages. */
  static async update(attackMessage, changes) {
    const current = this.get(attackMessage);
    if (!current?.id) throw new Error("Missing Nelflow transaction");

    const nextState = changes.state ?? current.state;
    if (nextState !== current.state && !ALLOWED_TRANSITIONS[current.state]?.has(nextState)) {
      throw new Error(`Invalid transaction transition: ${current.state} -> ${nextState}`);
    }

    const transaction = {
      ...current,
      ...changes,
      role: "attack",
      id: current.id,
      attackMessageId: current.attackMessageId,
      updatedAt: now(),
    };
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);

    await updateLinkedMarker(transaction.damageMessageId, transaction, "damage");
    await updateLinkedMarker(transaction.applicationMessageId, transaction, "application");
    return this.get(attackMessage);
  }

  /** Attach a native PF2e message to the canonical attack transaction. */
  static async linkMessage(attackMessage, linkedMessage, role) {
    if (!linkedMessage || !["damage", "application"].includes(role)) return this.get(attackMessage);
    const field = role === "damage" ? "damageMessageId" : "applicationMessageId";
    const transaction = await this.update(attackMessage, { [field]: linkedMessage.id });
    await linkedMessage.setFlag(MODULE_ID, "transaction", marker(transaction, role));
    return transaction;
  }

  /** Resolve the full canonical transaction represented by any linked message. */
  static resolveCanonical(message) {
    const local = this.get(message);
    if (!local?.attackMessageId) return null;
    const attackMessage = game.messages.get(local.attackMessageId);
    const transaction = this.get(attackMessage);
    return transaction?.id === local.id ? { attackMessage, transaction } : null;
  }
}
