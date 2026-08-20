import { MODULE_ID, TRANSACTION_STATES } from "./constants.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import { appendAudit, recordFailure, updateRecovery, RECOVERY_STATUSES } from "./transaction-failure.js";
import { makeBatchTransaction, MULTI_TARGET_STRIKE_TRANSACTION_TYPE } from "./multi-target-strike-model.js";

const recoveryQueues = new Map();

const ALLOWED_TRANSITIONS = Object.freeze({
  [TRANSACTION_STATES.DAMAGE_ROLLED]: new Set([
    TRANSACTION_STATES.AWAITING_IMPACT,
    TRANSACTION_STATES.APPLIED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.AWAITING_IMPACT]: new Set([
    TRANSACTION_STATES.APPLIED,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.APPLIED]: new Set([
    TRANSACTION_STATES.UNDONE,
    TRANSACTION_STATES.FAILED,
  ]),
  [TRANSACTION_STATES.INTERRUPTED]: new Set([TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.ABANDONED]),
  [TRANSACTION_STATES.FAILED]: new Set([TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.ABANDONED]),
  [TRANSACTION_STATES.PROCESSING]: new Set([
    TRANSACTION_STATES.SKIPPED,
    TRANSACTION_STATES.DAMAGE_ROLLED,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.INTERRUPTED,
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.ABANDONED,
    TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  ]),
  [TRANSACTION_STATES.WAITING_FOR_DAMAGE]: new Set([
    TRANSACTION_STATES.DAMAGE_OBSERVED,
    TRANSACTION_STATES.AMBIGUOUS,
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.INTERRUPTED,
    TRANSACTION_STATES.ABANDONED,
    TRANSACTION_STATES.SKIPPED,
  ]),
  [TRANSACTION_STATES.DAMAGE_OBSERVED]: new Set([
    TRANSACTION_STATES.VALIDATING,
    TRANSACTION_STATES.AMBIGUOUS,
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.INTERRUPTED,
  ]),
  [TRANSACTION_STATES.VALIDATING]: new Set([
    TRANSACTION_STATES.CLAIMED,
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.INTERRUPTED,
  ]),
  [TRANSACTION_STATES.CLAIMED]: new Set([
    TRANSACTION_STATES.APPLYING,
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.INTERRUPTED,
  ]),
  [TRANSACTION_STATES.APPLYING]: new Set([
    TRANSACTION_STATES.APPLIED,
    TRANSACTION_STATES.FAILED,
    TRANSACTION_STATES.INTERRUPTED,
  ]),
  [TRANSACTION_STATES.AMBIGUOUS]: new Set([
    TRANSACTION_STATES.MANUAL,
    TRANSACTION_STATES.ABANDONED,
    TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  ]),
  [TRANSACTION_STATES.MANUAL]: new Set([
    TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    TRANSACTION_STATES.ABANDONED,
  ]),
});

function transitionEvent(state) {
  return {
    [TRANSACTION_STATES.PROCESSING]: "claimed",
    [TRANSACTION_STATES.SKIPPED]: "application-complete",
    [TRANSACTION_STATES.DAMAGE_ROLLED]: "damage-message-linked",
    [TRANSACTION_STATES.AWAITING_IMPACT]: "awaiting-impact",
    [TRANSACTION_STATES.APPLIED]: "application-complete",
    [TRANSACTION_STATES.FAILED]: "application-failed",
    [TRANSACTION_STATES.UNDONE]: "undo-complete",
    [TRANSACTION_STATES.INTERRUPTED]: "interrupted",
    [TRANSACTION_STATES.MANUAL]: "manual",
    [TRANSACTION_STATES.ABANDONED]: "abandoned",
  }[state] ?? "classified";
}

function now() {
  return Date.now();
}

function marker(transaction, role) {
  return {
    id: transaction.id,
    attackMessageId: transaction.attackMessageId,
    role,
    state: transaction.state,
    transactionType: transaction.transactionType ?? "strike",
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

  /** Claim one immutable shared-roll batch. A pre-create player observation may be replaced, never another claim. */
  static async claimMultiTargetStrike(attackMessage, snapshot, targets) {
    if (!game.user?.isGM || snapshot?.processingUserId !== game.user.id) return null;
    const existing = this.get(attackMessage);
    if (existing?.transactionType === MULTI_TARGET_STRIKE_TRANSACTION_TYPE && existing.role === "attack") {
      return existing;
    }
    if (existing && existing.role !== "observation") return null;
    const transaction = makeBatchTransaction({
      attackMessageId: attackMessage.id,
      snapshot,
      targets,
    });
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);
    return this.get(attackMessage);
  }

  /** Persist a batch projection without routing child states through the singular Strike state machine. */
  static async updateMultiTargetStrike(attackMessage, changes) {
    const current = this.get(attackMessage);
    if (
      !game.user?.isGM ||
      current?.snapshot?.processingUserId !== game.user.id ||
      current?.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE ||
      current.role !== "attack"
    ) {
      throw new Error("Missing Nelflow multi-target Strike transaction");
    }
    const next = {
      ...current,
      ...changes,
      id: current.id,
      role: "attack",
      transactionType: MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
      attackMessageId: current.attackMessageId,
      snapshot: current.snapshot,
      targets: changes.targets ?? current.targets,
      updatedAt: now(),
      revision: Number(current.revision ?? 0) + 1,
    };
    await attackMessage.setFlag(MODULE_ID, "transaction", next);
    return this.get(attackMessage);
  }

  static async linkMultiTargetMessage(attackMessage, linkedMessage, markerData) {
    if (!linkedMessage?.id) return this.get(attackMessage);
    const current = this.get(attackMessage);
    if (current?.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE) return current;
    const linkedMessageIds = Array.from(new Set([...(current.linkedMessageIds ?? []), linkedMessage.id]));
    const next = await this.updateMultiTargetStrike(attackMessage, { linkedMessageIds });
    await linkedMessage.setFlag(MODULE_ID, "transaction", {
      id: next.id,
      attackMessageId: next.attackMessageId,
      transactionType: MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
      role: markerData.role,
      damageGroup: markerData.damageGroup ?? null,
      targetKey: markerData.targetKey ?? null,
      state: next.state,
    });
    return next;
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
      transactionType: "npc-strike",
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
      damageCorrelation: null,
      manualApplicationRequired: false,
      autoApplyRequested: Boolean(snapshot.autoApplyRequested),
      undoBlocked: false,
      presentationError: null,
      reasonKey: null,
      errorStage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      activeOperation: {
        ownerUserId: game.user.id,
        enteredRevision: 1,
        sessionId: getRuntimeSessionId(),
      },
    };
    appendAudit(transaction, {
      event: "claimed",
      state: transaction.state,
      subsystem: "strike",
      userRole: "gm",
      revision: transaction.revision,
    });
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);
    return this.get(attackMessage);
  }

  /**
   * Persist a single-target spell-attack transaction (0.14.13).
   * Uses deterministic id `nelflow-spell-attack-<attackMessageId>`.
   */
  static async claimSpellAttack(attackMessage, snapshot, { state, failureCode = null } = {}) {
    const existing = this.get(attackMessage);
    if (existing?.transactionType === "spell-attack" && existing.role === "attack") return existing;
    if (existing && !(existing.transactionType === "spell-attack" && existing.role === "observation")) {
      return null;
    }
    const timestamp = now();
    const transactionId = `${MODULE_ID}-spell-attack-${attackMessage.id}`;
    const transaction = {
      id: transactionId,
      role: "attack",
      transactionType: "spell-attack",
      sourceKind: "spell-attack",
      schemaVersion: snapshot.schemaVersion,
      state,
      attackMessageId: attackMessage.id,
      damageMessageId: null,
      applicationMessageId: null,
      stackRef: null,
      snapshot,
      sourceUserId: snapshot.authoringUserId,
      processingUserId: snapshot.processingUserId,
      preApplication: null,
      postApplication: null,
      appliedAmount: null,
      damageCorrelation: { state: "waiting", candidateCount: 0 },
      correlationMethod: null,
      observedDamageMessageId: null,
      authorityClaimState: "unclaimed",
      applicationState: "pending",
      claimedAt: null,
      appliedAt: null,
      eligibilityResult:
        state === TRANSACTION_STATES.WAITING_FOR_DAMAGE
          ? "eligible"
          : state === TRANSACTION_STATES.SKIPPED
            ? "ineligible"
            : "manual-review",
      applicationAttemptCount: 0,
      finalState: state,
      failureCode,
      manualReason: failureCode,
      manualApplicationRequired: state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE,
      undoBlocked: false,
      presentationError: null,
      reasonKey: null,
      errorStage: failureCode,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      activeOperation: null,
    };
    appendAudit(transaction, {
      event: state === TRANSACTION_STATES.WAITING_FOR_DAMAGE ? "waiting-for-damage" : "classified",
      state,
      subsystem: "spell-attack",
      userRole: "gm",
      safeReason: failureCode,
      revision: 1,
    });
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);
    return this.get(attackMessage);
  }

  /** Persist the authoritative projection of a character-authored native Strike. */
  static async claimPlayerStrike(attackMessage, snapshot, { state, failureCode = null } = {}) {
    const existing = this.get(attackMessage);
    if (existing?.transactionType === "player-strike" && existing.role === "attack") return existing;
    if (existing && !(existing.transactionType === "player-strike" && existing.role === "observation")) return null;
    const timestamp = now();
    const transaction = {
      id: this.deterministicId(attackMessage),
      role: "attack",
      transactionType: "player-strike",
      sourceKind: "character-strike",
      schemaVersion: snapshot.schemaVersion,
      state,
      attackMessageId: attackMessage.id,
      damageMessageId: null,
      applicationMessageId: null,
      stackRef: null,
      snapshot,
      sourceUserId: snapshot.authoringUserId,
      processingUserId: snapshot.processingUserId,
      settingMode: snapshot.settingMode,
      preApplication: null,
      postApplication: null,
      appliedAmount: null,
      damageVariant: snapshot.damageVariant,
      observedDamageVariant: null,
      damageCorrelation: { state: "waiting", candidateCount: 0 },
      correlationMethod: null,
      observedDamageMessageId: null,
      directIntentPresent: false,
      directIntentNonce: null,
      directIntentSourceMessageId: null,
      directIntentTransactionId: null,
      directIntentRequestedVariant: null,
      directIntentAuthorId: null,
      directIntentCreatedAt: null,
      directIntentConsumedAt: null,
      directIntentFinalizedAt: null,
      directIntentLocalState: "missing",
      persistedBindingState: "none",
      authorityClaimState: "unclaimed",
      applicationState: "pending",
      directCorrelationDecision: "not-present",
      directCorrelationRejectedReason: null,
      boundDamageMessageId: null,
      boundTransactionId: null,
      boundNonce: null,
      boundAt: null,
      claimedAt: null,
      appliedAt: null,
      directCorrelationValidation: "not-present",
      directIntentRejectedReason: null,
      structuredFallbackCandidateCount: 0,
      structuredFallbackCandidateTransactionIds: [],
      ambiguityStage: null,
      actorType: snapshot.actorType,
      messageAuthorId: snapshot.authoringUserId,
      messageAuthorRole: snapshot.authorRole,
      requestSenderId: snapshot.authoringUserId,
      authorIsGm: snapshot.authorIsGm,
      eligibilityResult: state === TRANSACTION_STATES.WAITING_FOR_DAMAGE
        ? "eligible"
        : state === TRANSACTION_STATES.SKIPPED ? "ineligible" : "manual-review",
      applicationAttemptCount: 0,
      finalState: state,
      failureCode,
      manualReason: failureCode,
      manualApplicationRequired: state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE,
      undoBlocked: false,
      presentationError: null,
      reasonKey: null,
      errorStage: failureCode,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      activeOperation: null,
    };
    appendAudit(transaction, {
      event: state === TRANSACTION_STATES.WAITING_FOR_DAMAGE ? "waiting-for-damage" : "classified",
      state,
      subsystem: "player-strike",
      userRole: "gm",
      safeReason: failureCode,
      revision: 1,
    });
    if (failureCode) {
      recordFailure(transaction, {
        reason: failureCode,
        subsystem: "player-strike",
        operation: "attack-observation",
        userRole: "gm",
        context: { messageId: attackMessage.id, transactionId: transaction.id },
      });
    }
    await attackMessage.setFlag(MODULE_ID, "transaction", transaction);
    return this.get(attackMessage);
  }

  /** Move a transaction forward and synchronize compact markers on linked messages. */
  static async update(attackMessage, changes) {
    const current = this.get(attackMessage);
    if (!current?.id) throw new Error("Missing Nelflow transaction");

    const nextState = changes.state ?? current.state;
    const recoveryTerminal = [TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.ABANDONED].includes(nextState);
    if (nextState !== current.state && !recoveryTerminal && !ALLOWED_TRANSITIONS[current.state]?.has(nextState)) {
      throw new Error(`Invalid transaction transition: ${current.state} -> ${nextState}`);
    }

    const transaction = {
      ...current,
      ...changes,
      role: "attack",
      id: current.id,
      attackMessageId: current.attackMessageId,
      updatedAt: now(),
      revision: Number(current.revision ?? 0) + 1,
      finalState: nextState,
    };
    if (nextState !== current.state) {
      appendAudit(transaction, {
        event: transitionEvent(nextState),
        state: nextState,
        subsystem:
          current.transactionType === "player-strike"
            ? "player-strike"
            : current.transactionType === "spell-attack"
              ? "spell-attack"
              : "strike",
        userRole: game.user?.isGM ? "gm" : "player",
        safeReason: changes.errorStage ?? changes.reasonKey ?? null,
        revision: transaction.revision,
      });
    }
    if (
      nextState === TRANSACTION_STATES.FAILED ||
      ((current.transactionType === "player-strike" || current.transactionType === "spell-attack") &&
        [TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.AMBIGUOUS].includes(nextState) &&
        changes.failureCode) ||
      changes.undoBlocked ||
      changes.presentationError ||
      changes.undoOperation?.state === "failed"
    ) {
      recordFailure(transaction, {
        reason: changes.undoBlocked ? "health-changed" : changes.undoOperation?.reason ?? changes.failureCode ?? changes.errorStage ?? "internal-exception",
        subsystem: changes.undoBlocked || changes.undoOperation?.state === "failed"
          ? "undo"
          : current.transactionType === "player-strike"
            ? "player-strike"
            : current.transactionType === "spell-attack"
              ? "spell-attack"
              : "strike",
        operation: changes.undoBlocked || changes.undoOperation?.state === "failed" ? "guarded-undo" : changes.errorStage ?? "processing",
        event: changes.undoBlocked || changes.undoOperation?.state === "failed" ? "undo-failed" : "application-failed",
        userRole: "gm",
        context: { messageId: attackMessage.id, transactionId: current.id },
      });
    }
    if (![TRANSACTION_STATES.PROCESSING, TRANSACTION_STATES.VALIDATING, TRANSACTION_STATES.CLAIMED, TRANSACTION_STATES.APPLYING].includes(nextState)) {
      transaction.activeOperation = null;
    }
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

  static enqueueRecovery(attackMessage, operation) {
    const prior = recoveryQueues.get(attackMessage.id) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(operation);
    recoveryQueues.set(attackMessage.id, current);
    return current.finally(() => {
      if (recoveryQueues.get(attackMessage.id) === current) recoveryQueues.delete(attackMessage.id);
    });
  }

  static recover(attackMessage, action) {
    return this.enqueueRecovery(attackMessage, async () => {
      const current = this.get(attackMessage);
      if (!game.user?.isGM || !current?.id) return null;
      const state = action === "abandon" ? TRANSACTION_STATES.ABANDONED : TRANSACTION_STATES.MANUAL;
      const next = await this.update(attackMessage, {
        state,
        manualApplicationRequired: action !== "abandon",
        activeOperation: null,
      });
      updateRecovery(next, {
        status: action === "abandon" ? RECOVERY_STATUSES.ABANDONED : RECOVERY_STATUSES.MANUAL,
        action,
      });
      appendAudit(next, {
        event: "recovery-complete",
        state,
        subsystem: "strike",
        userRole: "gm",
        safeReason: action,
        revision: next.revision,
      });
      await attackMessage.setFlag(MODULE_ID, "transaction", next);
      return this.get(attackMessage);
    });
  }

  static recordBoundaryFailure(message, failure) {
    const resolved = this.resolveCanonical(message);
    if (!resolved || !game.user?.isGM) return Promise.resolve(false);
    return this.enqueueRecovery(resolved.attackMessage, async () => {
      const current = this.get(resolved.attackMessage);
      if (!current?.id) return false;
      if (current.transactionType === MULTI_TARGET_STRIKE_TRANSACTION_TYPE) {
        const targets = current.targets.map((child) =>
          ["applied", "miss", "undone", "undo-blocked"].includes(child.state)
            ? child
            : { ...child, state: "review", reviewReason: failure.code },
        );
        await this.updateMultiTargetStrike(resolved.attackMessage, {
          state: "manual",
          targets,
          activeOperation: null,
          presentationError: failure.code,
        });
        return true;
      }
      const changes = current.state === TRANSACTION_STATES.PROCESSING
        ? { state: TRANSACTION_STATES.INTERRUPTED, errorStage: failure.code, activeOperation: null }
        : { presentationError: failure.code, errorStage: failure.code };
      await this.update(resolved.attackMessage, changes);
      return true;
    });
  }
}
