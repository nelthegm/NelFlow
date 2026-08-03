import { MODULE_ID, PLAYER_STRIKE_AUTO_APPLY_MODES, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";
import {
  buildPlayerStrikeSnapshot,
  correlatePlayerStrikeDamage,
  expectedDamageVariant,
  PLAYER_STRIKE_FAILURES,
  PLAYER_STRIKE_SOCKET_ACTION,
  PLAYER_STRIKE_TRANSACTION_TYPE,
  reconcilePlayerStrikeReload,
  validatePlayerStrikeAttack,
  validatePlayerStrikeDamage,
  validatePlayerStrikeSnapshot,
  validatePlayerStrikeSocketPayload,
  playerStrikeModeAllows,
} from "./player-strike-model.js";
import {
  capturePlayerStrikeObservation,
  isPlayerStrikeCandidate,
  normalizePlayerStrikeAttack as normalizeAttack,
  normalizePlayerStrikeDamage as normalizeDamage,
  playerStrikeAuthorId as authorId,
} from "./player-strike-adapter.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";
import { TransactionStore } from "./transaction-store.js";

const SOCKET_NAMESPACE = `module.${MODULE_ID}`;
const queues = new Map();
const observedDamage = new Set();
let initialized = false;


function currentAuthority(sourceUserId) {
  return electProcessingGm(game.users ?? [], sourceUserId);
}

function currentUserIsAuthority(sourceUserId) {
  return game.user?.isGM === true && currentAuthority(sourceUserId) === game.user.id;
}

function enqueue(id, operation) {
  const prior = queues.get(id) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  queues.set(id, current);
  return current.finally(() => {
    if (queues.get(id) === current) queues.delete(id);
  });
}

function appliedAmount(before, after) {
  return before.hp + before.tempHp - after.hp - after.tempHp;
}

async function markManual(
  attackMessage,
  transaction,
  failureCode,
  state = TRANSACTION_STATES.MANUAL,
  details = {},
) {
  const reason = failureCode ?? "manual-review-required";
  return TransactionStore.update(attackMessage, {
    ...details,
    state,
    failureCode: reason,
    errorStage: reason,
    manualReason: reason,
    eligibilityResult: "manual-review",
    manualApplicationRequired: true,
    activeOperation: null,
  });
}

function waitingTransactions() {
  const results = [];
  for (const message of game.messages ?? []) {
    const transaction = TransactionStore.get(message);
    if (
      transaction?.role === "attack" &&
      transaction.transactionType === PLAYER_STRIKE_TRANSACTION_TYPE &&
      transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE
    ) results.push({ message, transaction });
  }
  return results;
}

async function processDamage(message) {
  const normalized = normalizeDamage(message);
  if (!normalized) return false;
  const waiting = waitingTransactions();
  const correlation = correlatePlayerStrikeDamage(waiting.map((entry) => entry.transaction), normalized.evidence);
  if (!correlation.ok) {
    if (correlation.reason === PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS) {
      for (const candidate of correlation.candidates) {
        const owner = waiting.find((entry) => entry.transaction.id === candidate.id);
        if (owner && currentUserIsAuthority(candidate.sourceUserId)) {
          await enqueue(owner.message.id, () => markManual(
            owner.message,
            TransactionStore.get(owner.message),
            PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS,
            TRANSACTION_STATES.AMBIGUOUS,
            {
              damageCorrelation: { state: "ambiguous", candidateCount: correlation.candidates.length },
              correlationMethod: "pf2e-structured-strike-context",
            },
          ));
        }
      }
    }
    return false;
  }

  const owner = waiting.find((entry) => entry.transaction.id === correlation.transaction.id);
  if (!owner || !currentUserIsAuthority(owner.transaction.sourceUserId)) return false;
  return enqueue(owner.message.id, async () => {
    const attackMessage = game.messages.get(owner.message.id);
    const damageMessage = game.messages.get(message.id);
    let transaction = TransactionStore.get(attackMessage);
    if (!attackMessage || !damageMessage || transaction?.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE) return false;

    const attack = normalizeAttack(attackMessage);
    const damage = normalizeDamage(damageMessage);
    if (!attack || !damage || !currentUserIsAuthority(transaction.sourceUserId)) {
      await markManual(attackMessage, transaction, PLAYER_STRIKE_FAILURES.AUTHORITY_MISSING);
      return false;
    }
    const attackValidation = validatePlayerStrikeAttack(attack.evidence);
    const snapshotValidation = validatePlayerStrikeSnapshot(transaction.snapshot, attack.evidence);
    const damageValidation = validatePlayerStrikeDamage(transaction.snapshot, damage.evidence);
    if (!attackValidation.ok || !snapshotValidation.ok || !damageValidation.ok) {
      await markManual(
        attackMessage,
        transaction,
        damageValidation.reason ?? snapshotValidation.reason ?? attackValidation.reason ?? PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED,
      );
      return false;
    }

    transaction = await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.DAMAGE_OBSERVED,
      damageMessageId: damageMessage.id,
      damageVariant: damageValidation.variant,
      observedDamageVariant: damageValidation.variant,
      damageCorrelation: { state: "unique", candidateCount: 1 },
      correlationMethod: "pf2e-structured-strike-context",
      requestSenderId: damage.evidence.authorUserId,
      eligibilityResult: "eligible",
      failureCode: null,
      manualReason: null,
      manualApplicationRequired: false,
    });
    if (!PF2eAdapter.persistDamageClaim(damageMessage.id, transaction.id)) {
      await markManual(attackMessage, transaction, PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS);
      return false;
    }
    transaction = await TransactionStore.linkMessage(attackMessage, damageMessage, "damage");
    transaction = await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.VALIDATING,
      activeOperation: {
        ownerUserId: game.user.id,
        sessionId: getRuntimeSessionId(),
        enteredRevision: Number(transaction.revision ?? 0) + 1,
      },
    });

    const targetDocument = await fromUuid(transaction.snapshot.targetTokenUuid);
    const targetToken = targetDocument?.object ?? null;
    const currentMode = getSetting(SETTINGS.PLAYER_STRIKE_AUTO_APPLY);
    const hostile = globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
    if (
      !targetToken?.actor ||
      targetToken.actor.uuid !== transaction.snapshot.targetActorUuid ||
      !playerStrikeModeAllows({
        mode: currentMode,
        snapshotDisposition: transaction.snapshot.targetDisposition,
        currentDisposition: targetDocument.disposition,
        hostileValue: hostile,
      })
    ) {
      await markManual(
        attackMessage,
        transaction,
        targetToken?.actor
          ? PLAYER_STRIKE_FAILURES.DISPOSITION_BLOCKED
          : PLAYER_STRIKE_FAILURES.TARGET_CHANGED,
      );
      return false;
    }

    const sourceActor = attack.actor;
    const sourceItem = attack.item;
    if (
      sourceActor?.uuid !== transaction.snapshot.sourceActorUuid ||
      sourceItem?.uuid !== transaction.snapshot.sourceItemUuid
    ) {
      await markManual(attackMessage, transaction, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED);
      return false;
    }

    transaction = await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.CLAIMED,
      processingUserId: game.user.id,
    });
    const preApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
    if (!preApplication) {
      await markManual(attackMessage, transaction, PLAYER_STRIKE_FAILURES.APPLICATION_FAILED);
      return false;
    }
    transaction = await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.APPLYING,
      preApplication,
      applicationAttemptCount: Number(transaction.applicationAttemptCount ?? 0) + 1,
    });
    try {
      const applied = await PF2eAdapter.applyDamageRollToRecordedTarget({
        damageMessage,
        damageRoll: damage.roll,
        sourceActor,
        sourceItem,
        targetToken,
        expectedTargetActorUuid: transaction.snapshot.targetActorUuid,
        multiplier: 1,
        outcome: damage.evidence.outcome,
        applicationId: transaction.id,
        attackMessageId: attackMessage.id,
      });
      if (!applied) throw new Error(PLAYER_STRIKE_FAILURES.APPLICATION_FAILED);
      const postApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
      if (!postApplication) throw new Error(PLAYER_STRIKE_FAILURES.APPLICATION_FAILED);
      if (applied.applicationMessage) {
        transaction = await TransactionStore.linkMessage(attackMessage, applied.applicationMessage, "application");
      }
      await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.APPLIED,
        preApplication,
        postApplication,
        appliedAmount: appliedAmount(preApplication, postApplication),
        eligibilityResult: "applied",
        failureCode: null,
        manualReason: null,
        manualApplicationRequired: false,
        activeOperation: null,
      });
      logger.debug("player-strike-applied", {
        transactionId: transaction.id,
        stage: "player-strike-application",
        reason: null,
      });
      return true;
    } catch (error) {
      await TransactionStore.update(attackMessage, {
        // The native call may have changed HP before an exception or missing
        // application record became observable. Never label that state safe to retry.
        state: TRANSACTION_STATES.INTERRUPTED,
        failureCode: PLAYER_STRIKE_FAILURES.APPLICATION_FAILED,
        errorStage: PLAYER_STRIKE_FAILURES.APPLICATION_FAILED,
        manualReason: PLAYER_STRIKE_FAILURES.APPLICATION_FAILED,
        eligibilityResult: "manual-review",
        manualApplicationRequired: true,
        activeOperation: null,
      });
      logger.error("Player Strike application failed", {
        attackMessageId: attackMessage.id,
        transactionId: transaction.id,
        stage: "player-strike-application",
        reason: PLAYER_STRIKE_FAILURES.APPLICATION_FAILED,
      }, error);
      return false;
    }
  });
}

async function observeAttack(message) {
  const normalized = normalizeAttack(message);
  if (!normalized) return false;
  // This early partition is what keeps Slice 1 NPC transactions completely
  // outside the player observer even though both share the central hook.
  if (normalized.evidence.actorType !== "character") return false;
  const mode = getSetting(SETTINGS.PLAYER_STRIKE_AUTO_APPLY);
  if (mode === PLAYER_STRIKE_AUTO_APPLY_MODES.OFF) return false;
  const authority = currentAuthority(normalized.evidence.authorUserId);
  if (!authority || game.user.id !== authority || !game.user.isGM) return false;
  const existing = TransactionStore.get(message);
  if (existing && !(existing.transactionType === PLAYER_STRIKE_TRANSACTION_TYPE && existing.role === "observation")) return false;

  const validation = validatePlayerStrikeAttack(normalized.evidence);
  let failureCode = validation.reason;
  let state = validation.terminal ? TRANSACTION_STATES.SKIPPED : TRANSACTION_STATES.MANUAL;
  const hostile = globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
  if (validation.ok && !playerStrikeModeAllows({
    mode,
    snapshotDisposition: normalized.evidence.targetDisposition,
    currentDisposition: normalized.evidence.targetDisposition,
    hostileValue: hostile,
  })) {
    failureCode = PLAYER_STRIKE_FAILURES.DISPOSITION_BLOCKED;
  } else if (validation.ok) {
    state = TRANSACTION_STATES.WAITING_FOR_DAMAGE;
    failureCode = null;
  }
  const snapshot = buildPlayerStrikeSnapshot(normalized.evidence, {
    processingUserId: authority,
    settingMode: mode,
    sessionId: getRuntimeSessionId(),
  });
  await TransactionStore.claimPlayerStrike(message, snapshot, { state, failureCode });
  return state === TRANSACTION_STATES.WAITING_FOR_DAMAGE;
}

async function reconcileExisting() {
  if (!game.user?.isGM) return 0;
  const sessionId = getRuntimeSessionId();
  let count = 0;
  for (const message of game.messages ?? []) {
    const transaction = TransactionStore.get(message);
    if (!currentUserIsAuthority(transaction?.sourceUserId)) continue;
    const action = reconcilePlayerStrikeReload(transaction, sessionId);
    if (action !== "interrupt") continue;
    await TransactionStore.update(message, {
      state: TRANSACTION_STATES.INTERRUPTED,
      failureCode: PLAYER_STRIKE_FAILURES.INTERRUPTED,
      errorStage: PLAYER_STRIKE_FAILURES.INTERRUPTED,
      manualApplicationRequired: true,
      manualReason: PLAYER_STRIKE_FAILURES.INTERRUPTED,
      eligibilityResult: "manual-review",
      activeOperation: null,
    });
    count += 1;
  }
  return count;
}

export class PlayerStrikeService {
  static async initialize() {
    if (initialized) return;
    initialized = true;
    Hooks.on("preCreateChatMessage", (document, _data, _options, userId) => {
      try {
        capturePlayerStrikeObservation(document, userId);
      } catch (error) {
        logger.error("Player Strike snapshot failed open", {
          stage: "player-strike-snapshot",
          reason: PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED,
        }, error);
      }
    });
    game.socket?.on?.(SOCKET_NAMESPACE, (raw) => {
      const payload = validatePlayerStrikeSocketPayload(raw);
      if (!payload || !game.user?.isGM) return;
      const damageMessage = game.messages?.get(payload.damageMessageId);
      if (damageMessage) {
        void processDamage(damageMessage).catch((error) => {
          logger.error("Player Strike socket processing failed open", {
            attackMessageId: null,
            stage: "player-strike-socket",
            reason: "internal-exception",
          }, error);
        });
      }
    });
    await reconcileExisting();
  }

  static async handleCreatedMessage(message) {
    if (!getSetting(SETTINGS.ENABLED)) return false;
    if (isPlayerStrikeCandidate(message)) return observeAttack(message);
    const damage = normalizeDamage(message);
    if (!damage || observedDamage.has(message.id)) return false;
    observedDamage.add(message.id);
    if (authorId(message) === game.user?.id && !game.user?.isGM) {
      await game.socket?.emit?.(SOCKET_NAMESPACE, {
        action: PLAYER_STRIKE_SOCKET_ACTION,
        damageMessageId: message.id,
      });
    }
    return processDamage(message);
  }

  static expectedDamageVariant(outcome) {
    return expectedDamageVariant(outcome);
  }

  static compatibleDamageMessages(attackMessageId) {
    if (!game.user?.isGM) return [];
    const attackMessage = game.messages?.get(attackMessageId);
    const transaction = TransactionStore.get(attackMessage);
    if (transaction?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE) return [];
    const candidates = [];
    for (const message of game.messages ?? []) {
      const normalized = normalizeDamage(message);
      if (!normalized || !validatePlayerStrikeDamage(transaction.snapshot, normalized.evidence).ok) continue;
      const owner = PF2eAdapter.damageClaimOwner(message.id);
      if (owner && owner !== transaction.id) continue;
      candidates.push({
        messageId: message.id,
        messageIdShort: message.id.slice(-10),
        authorRole: game.users?.get(authorId(message))?.isGM ? "gm" : "player",
        targetCount: 1,
        createdAt: message._stats?.createdTime ?? null,
      });
    }
    return candidates;
  }

  static rescan(attackMessageId) {
    const candidates = this.compatibleDamageMessages(attackMessageId);
    return {
      ok: candidates.length === 1,
      result: candidates.length === 1 ? "ready-for-application" : candidates.length > 1 ? "ambiguous" : "missing",
      candidates,
    };
  }

  static async useExistingDamage(attackMessageId, damageMessageId) {
    if (!game.user?.isGM) return false;
    const attackMessage = game.messages?.get(attackMessageId);
    const transaction = TransactionStore.get(attackMessage);
    if (
      transaction?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE ||
      ![TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.AMBIGUOUS].includes(transaction.state) ||
      !this.compatibleDamageMessages(attackMessageId).some((candidate) => candidate.messageId === damageMessageId) ||
      !currentUserIsAuthority(transaction.sourceUserId)
    ) return false;
    await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
      manualApplicationRequired: false,
      failure: null,
      failureCode: null,
      errorStage: null,
      manualReason: null,
      eligibilityResult: "eligible",
    });
    const damageMessage = game.messages.get(damageMessageId);
    return damageMessage ? processDamage(damageMessage) : false;
  }
}
