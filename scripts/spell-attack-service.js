/**
 * Single-target spell-attack damage auto-apply (0.14.13).
 * Reuses PF2eAdapter.applyDamageRollToRecordedTarget + TransactionStore.
 * Correlation: unique open transaction by actor+item+author (fail open if ambiguous).
 * Application target: attack-time snapshot only (never live user targets at damage time).
 * No DOM / HTML interception.
 */

import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { noteLethalApplicationIfZeroHp } from "./nelcine-defeated-bridge.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";
import { TransactionStore } from "./transaction-store.js";
import { deriveActualStrikeHpLoss } from "./strike-presentation-feed.js";
import {
  buildSpellAttackDamageAppliedResultId,
  buildSpellAttackDamageRolledResultId,
  buildSpellAttackSnapshot,
  buildSpellAttackTransactionId,
  correlateSpellAttackDamage,
  SPELL_ATTACK_FAILURES,
  SPELL_ATTACK_SOCKET_ACTION,
  SPELL_ATTACK_TRANSACTION_TYPE,
  validateSpellAttack,
  validateSpellAttackDamage,
} from "./spell-attack-model.js";
import {
  captureSpellAttackObservation,
  isSpellAttackCandidate,
  normalizeSpellAttack,
  normalizeSpellAttackDamage,
} from "./spell-attack-adapter.js";
import {
  tryEmitSpellAttackDamageAppliedPresentation,
  tryEmitSpellAttackDamageRolledPresentation,
} from "./spell-attack-presentation-feed.js";

const SOCKET_NAMESPACE = `module.${MODULE_ID}`;
const queues = new Map();
const observedDamage = new Set();
let initialized = false;

const stats = {
  attacksObserved: 0,
  eligibleTransactions: 0,
  damageCorrelated: 0,
  damageApplied: 0,
  ambiguousDamage: 0,
  noTarget: 0,
  multiTarget: 0,
  failedValidation: 0,
  skippedMiss: 0,
};

/** @type {((event: object) => void)|null} */
let flowWatcher = null;

function emitWatch(event) {
  if (typeof flowWatcher !== "function") return;
  try {
    flowWatcher(event);
  } catch {
    /* ignore */
  }
}

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

function authorId(message) {
  return message?.author?.id ?? message?.user?.id ?? message?._source?.user ?? null;
}

function spellAttackTransactions() {
  const results = [];
  for (const message of game.messages ?? []) {
    const transaction = TransactionStore.get(message);
    if (
      transaction?.transactionType === SPELL_ATTACK_TRANSACTION_TYPE &&
      transaction.role === "attack"
    ) {
      results.push({ message, transaction });
    }
  }
  return results;
}

async function markManual(attackMessage, transaction, failureCode, state = TRANSACTION_STATES.MANUAL, details = {}) {
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

async function safeFromUuid(uuid) {
  if (!uuid || typeof fromUuid !== "function") return null;
  try {
    return await fromUuid(uuid);
  } catch {
    return null;
  }
}

/** Resolve Token placeable from attack-time UUID only — never live selection targets. */
async function resolveRecordedTargetToken(targetTokenUuid) {
  const targetDocument = await safeFromUuid(targetTokenUuid);
  if (!targetDocument) return { targetDocument: null, targetToken: null };
  if (targetDocument.object) {
    return { targetDocument, targetToken: targetDocument.object };
  }
  try {
    const byId = canvas?.tokens?.get?.(targetDocument.id);
    if (byId?.document?.uuid === targetDocument.uuid || byId?.id === targetDocument.id) {
      return { targetDocument, targetToken: byId };
    }
  } catch {
    /* canvas unavailable */
  }
  // TokenDocument is acceptable to the hardened apply adapter when placeable is absent.
  return { targetDocument, targetToken: targetDocument };
}

function attachBoundaryContext(error, context = {}) {
  if (!error || typeof error !== "object") return error;
  error.nelflowContext = {
    ...(error.nelflowContext ?? {}),
    transactionId: context.transactionId ?? null,
    messageId: context.messageId ?? null,
    messageType: "spell-attack",
    state: context.state ?? null,
  };
  return error;
}

async function failOpenApplication(attackMessage, transaction, failureCode, error = null) {
  try {
    const current = TransactionStore.get(attackMessage) ?? transaction;
    const state = current?.state;
    const next =
      state === TRANSACTION_STATES.APPLYING ||
      state === TRANSACTION_STATES.CLAIMED ||
      state === TRANSACTION_STATES.VALIDATING ||
      state === TRANSACTION_STATES.DAMAGE_OBSERVED
        ? TRANSACTION_STATES.INTERRUPTED
        : TRANSACTION_STATES.MANUAL;
    await TransactionStore.update(attackMessage, {
      state: next,
      applicationState: "failed",
      failureCode,
      errorStage: failureCode,
      manualReason: failureCode,
      eligibilityResult: "manual-review",
      manualApplicationRequired: true,
      activeOperation: null,
    });
  } catch (updateError) {
    logger.error(
      "Spell attack fail-open state update failed",
      {
        attackMessageId: attackMessage?.id,
        transactionId: transaction?.id,
        stage: "spell-attack-fail-open",
        reason: failureCode,
      },
      updateError,
    );
  }
  if (error) {
    logger.error(
      "Spell attack application failed open",
      {
        attackMessageId: attackMessage?.id,
        transactionId: transaction?.id,
        stage: "spell-attack-application",
        reason: failureCode,
        errorName: error instanceof Error ? error.name : "unknown-error",
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      error,
    );
  }
  return false;
}

async function observeAttack(message) {
  const normalized = normalizeSpellAttack(message);
  if (!normalized) return false;
  stats.attacksObserved += 1;

  if (!getSetting(SETTINGS.ENABLED)) return false;
  if (!getSetting(SETTINGS.SPELL_ATTACK_AUTO_APPLY)) return false;

  const authority = currentAuthority(normalized.evidence.authorUserId);
  if (!authority || game.user.id !== authority || !game.user.isGM) return false;

  const existing = TransactionStore.get(message);
  if (
    existing &&
    !(existing.transactionType === SPELL_ATTACK_TRANSACTION_TYPE && existing.role === "observation")
  ) {
    return false;
  }

  const validation = validateSpellAttack(normalized.evidence);
  let failureCode = validation.reason;
  let state = TRANSACTION_STATES.WAITING_FOR_DAMAGE;

  if (!validation.ok) {
    stats.failedValidation += 1;
    if (failureCode === SPELL_ATTACK_FAILURES.TARGET_MISSING) stats.noTarget += 1;
    if (failureCode === SPELL_ATTACK_FAILURES.MULTIPLE_TARGETS) stats.multiTarget += 1;
    if (failureCode === SPELL_ATTACK_FAILURES.NOT_A_HIT) {
      stats.skippedMiss += 1;
      state = TRANSACTION_STATES.SKIPPED;
    } else {
      state = TRANSACTION_STATES.SKIPPED;
    }
  }

  const snapshot = buildSpellAttackSnapshot(normalized.evidence, {
    processingUserId: game.user.id,
    sessionId: getRuntimeSessionId(),
  });

  emitWatch({
    event: "spell-attack-observed",
    spell: normalized.evidence.actionName,
    attackMessage: message.id,
    transaction: buildSpellAttackTransactionId(message.id),
    target: normalized.evidence.targetTokenUuid,
    degree: normalized.evidence.outcome,
    eligible: validation.ok,
    reason: failureCode,
  });

  await TransactionStore.claimSpellAttack(message, snapshot, {
    state,
    failureCode: validation.ok ? null : failureCode,
  });

  if (validation.ok) stats.eligibleTransactions += 1;
  return true;
}

async function processDamage(message) {
  const normalized = normalizeSpellAttackDamage(message);
  if (!normalized) return false;
  if (!getSetting(SETTINGS.ENABLED) || !getSetting(SETTINGS.SPELL_ATTACK_AUTO_APPLY)) return false;

  const waiting = spellAttackTransactions().filter(
    (entry) => entry.transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  );
  const correlated = correlateSpellAttackDamage(
    waiting.map((entry) => entry.transaction),
    normalized.evidence,
  );

  if (!correlated.ok) {
    if (correlated.reason === SPELL_ATTACK_FAILURES.DAMAGE_AMBIGUOUS) {
      stats.ambiguousDamage += 1;
      emitWatch({
        event: "spell-attack-damage-skipped",
        reason: "ambiguous-correlation",
        damageMessage: message.id,
        candidateCount: correlated.candidates?.length ?? 0,
      });
      for (const candidate of correlated.candidates ?? []) {
        const owner = waiting.find((entry) => entry.transaction.id === candidate.id);
        if (owner && currentUserIsAuthority(candidate.sourceUserId ?? candidate.snapshot?.authoringUserId)) {
          await enqueue(owner.message.id, () =>
            markManual(
              owner.message,
              TransactionStore.get(owner.message),
              SPELL_ATTACK_FAILURES.DAMAGE_AMBIGUOUS,
              TRANSACTION_STATES.AMBIGUOUS,
              {
                observedDamageMessageId: message.id,
                correlationMethod: "ambiguous",
                structuredFallbackCandidateCount: correlated.candidates.length,
              },
            ),
          );
        }
      }
    }
    return false;
  }

  const owner = waiting.find((entry) => entry.transaction.id === correlated.transaction.id);
  if (!owner || !currentUserIsAuthority(owner.transaction.sourceUserId ?? owner.transaction.snapshot?.authoringUserId)) {
    return false;
  }

  return enqueue(owner.message.id, async () => {
    const attackMessage = game.messages.get(owner.message.id);
    const damageMessage = game.messages.get(message.id);
    let transaction = TransactionStore.get(attackMessage);
    if (!attackMessage || !damageMessage || transaction?.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE) {
      return false;
    }

    const attack = normalizeSpellAttack(attackMessage);
    const damage = normalizeSpellAttackDamage(damageMessage);
    if (!attack || !damage || !currentUserIsAuthority(transaction.sourceUserId)) {
      await markManual(attackMessage, transaction, SPELL_ATTACK_FAILURES.AUTHORITY_MISSING);
      return false;
    }

    const attackValidation = validateSpellAttack(attack.evidence);
    const damageValidation = validateSpellAttackDamage(transaction.snapshot, damage.evidence);
    if (!attackValidation.ok || !damageValidation.ok) {
      await markManual(
        attackMessage,
        transaction,
        damageValidation.reason ?? attackValidation.reason,
      );
      return false;
    }

    const damageClaim = PF2eAdapter.claimDamageMessage(damageMessage.id, transaction.id);
    if (!damageClaim.ok) {
      await markManual(
        attackMessage,
        transaction,
        SPELL_ATTACK_FAILURES.DAMAGE_AMBIGUOUS,
        TRANSACTION_STATES.AMBIGUOUS,
        { observedDamageMessageId: damageMessage.id, authorityClaimState: "claimed-by-other-gm" },
      );
      return false;
    }

    stats.damageCorrelated += 1;
    emitWatch({
      event: "spell-attack-damage-correlated",
      damageMessage: damageMessage.id,
      rolled: damage.evidence.rolledTotal,
      transaction: transaction.id,
    });

    try {
      transaction = await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.DAMAGE_OBSERVED,
        damageMessageId: damageMessage.id,
        observedDamageMessageId: damageMessage.id,
        correlationMethod: correlated.method,
        damageCorrelation: { state: "unique", candidateCount: 1 },
        authorityClaimState: "claimed-by-this-gm",
        applicationState: "pending",
        claimedAt: Date.now(),
      });
      transaction = await TransactionStore.linkMessage(attackMessage, damageMessage, "damage");
      // Match player-strike: DAMAGE_OBSERVED → VALIDATING → CLAIMED (never skip VALIDATING).
      transaction = await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.VALIDATING,
        activeOperation: {
          ownerUserId: game.user.id,
          sessionId: getRuntimeSessionId(),
          enteredRevision: Number(transaction.revision ?? 0) + 1,
        },
      });

      const sourceActor = await safeFromUuid(transaction.snapshot?.sourceActorUuid);
      const sourceItem = await safeFromUuid(transaction.snapshot?.sourceItemUuid);
      const { targetDocument, targetToken } = await resolveRecordedTargetToken(
        transaction.snapshot?.targetTokenUuid,
      );

      if (!sourceActor || !sourceItem) {
        await markManual(attackMessage, transaction, SPELL_ATTACK_FAILURES.SOURCE_INVALID);
        return false;
      }
      if (
        !targetToken?.actor ||
        targetToken.actor.uuid !== transaction.snapshot.targetActorUuid ||
        (transaction.snapshot.sceneId && targetDocument?.parent?.id !== transaction.snapshot.sceneId)
      ) {
        await markManual(attackMessage, transaction, SPELL_ATTACK_FAILURES.TARGET_INVALID);
        return false;
      }

      transaction = await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.CLAIMED,
        processingUserId: game.user.id,
        authorityClaimState: "claimed-by-this-gm",
        claimedAt: transaction.claimedAt ?? Date.now(),
      });

      const presentationArgs = {
        transactionId: transaction.id,
        sceneId: transaction.snapshot.sceneId ?? null,
        sourceTokenUuid: transaction.snapshot.sourceTokenUuid ?? null,
        sourceActorUuid: transaction.snapshot.sourceActorUuid ?? null,
        targetTokenUuid: transaction.snapshot.targetTokenUuid ?? null,
        targetActorUuid: transaction.snapshot.targetActorUuid ?? null,
        itemUuid: transaction.snapshot.sourceItemUuid ?? null,
        actionName: transaction.snapshot.actionName ?? null,
        outcome: transaction.snapshot.outcome ?? null,
        critical: transaction.snapshot.outcome === "criticalSuccess",
        rolledTotal: damage.evidence.rolledTotal,
        formula: damage.evidence.formula,
      };

      // Emit APPLYING before optional presentation so live watchers see progress.
      emitWatch({
        event: "spell-attack-applying",
        target: transaction.snapshot.targetTokenUuid,
        transaction: transaction.id,
      });

      try {
        tryEmitSpellAttackDamageRolledPresentation({
          ...presentationArgs,
          damageResultId: buildSpellAttackDamageRolledResultId(transaction.id),
        });
      } catch (presentationError) {
        logger.error(
          "Spell attack damageRolled presentation failed open",
          {
            attackMessageId: attackMessage.id,
            transactionId: transaction.id,
            stage: "spell-attack-damage-rolled-presentation",
            reason: "presentation-failed-open",
          },
          presentationError,
        );
      }

      const preApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
      if (!preApplication) {
        await markManual(attackMessage, transaction, SPELL_ATTACK_FAILURES.APPLICATION_FAILED);
        return false;
      }

      transaction = await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.APPLYING,
        preApplication,
        applicationState: "applying",
        applicationAttemptCount: Number(transaction.applicationAttemptCount ?? 0) + 1,
      });

      const applied = await PF2eAdapter.applyDamageRollToRecordedTarget({
        damageMessage,
        damageRoll: damage.roll,
        sourceActor,
        sourceItem,
        targetToken,
        expectedTargetActorUuid: transaction.snapshot.targetActorUuid,
        multiplier: 1,
        outcome: damage.evidence.outcome ?? transaction.snapshot.outcome,
        applicationId: transaction.id,
        attackMessageId: attackMessage.id,
      });
      if (!applied) {
        return failOpenApplication(
          attackMessage,
          transaction,
          SPELL_ATTACK_FAILURES.APPLICATION_FAILED,
          new Error(SPELL_ATTACK_FAILURES.APPLICATION_FAILED),
        );
      }

      const postApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
      if (!postApplication) {
        return failOpenApplication(
          attackMessage,
          transaction,
          SPELL_ATTACK_FAILURES.APPLICATION_FAILED,
          new Error("post-application-snapshot-missing"),
        );
      }

      try {
        noteLethalApplicationIfZeroHp({
          actor: targetToken.actor,
          token: targetToken.document ?? targetToken,
          transactionId: transaction.id,
          causeType: "damage",
          postApplication,
          sourceActor,
          sourceToken: attackMessage.token ?? null,
        });
      } catch {
        /* lethal notes never block application */
      }

      if (applied.applicationMessage) {
        transaction = await TransactionStore.linkMessage(attackMessage, applied.applicationMessage, "application");
      }

      const appliedHpLoss =
        deriveActualStrikeHpLoss({ preApplication, postApplication }) ??
        Math.max(0, preApplication.hp + preApplication.tempHp - postApplication.hp - postApplication.tempHp);

      await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.APPLIED,
        preApplication,
        postApplication,
        appliedAmount: appliedHpLoss,
        applicationState: "applied",
        authorityClaimState: "completed",
        appliedAt: Date.now(),
        eligibilityResult: "applied",
        failureCode: null,
        manualReason: null,
        manualApplicationRequired: false,
        activeOperation: null,
      });

      stats.damageApplied += 1;
      try {
        tryEmitSpellAttackDamageAppliedPresentation({
          ...presentationArgs,
          damageResultId: buildSpellAttackDamageAppliedResultId(transaction.id),
          applied: appliedHpLoss,
          preApplication,
          postApplication,
        });
      } catch (presentationError) {
        logger.error(
          "Spell attack damageApplied presentation failed open",
          {
            attackMessageId: attackMessage.id,
            transactionId: transaction.id,
            stage: "spell-attack-damage-applied-presentation",
            reason: "presentation-failed-open",
          },
          presentationError,
        );
      }

      emitWatch({
        event: "spell-attack-damage-applied",
        rolled: damage.evidence.rolledTotal,
        applied: appliedHpLoss,
        transaction: transaction.id,
      });
      emitWatch({
        event: "spell-attack-resolved",
        transaction: transaction.id,
      });
      return true;
    } catch (error) {
      const current = TransactionStore.get(attackMessage) ?? transaction;
      await failOpenApplication(
        attackMessage,
        current,
        SPELL_ATTACK_FAILURES.APPLICATION_FAILED,
        error,
      );
      throw attachBoundaryContext(error, {
        transactionId: current?.id ?? transaction?.id ?? null,
        messageId: damageMessage?.id ?? attackMessage?.id ?? null,
        state: TransactionStore.get(attackMessage)?.state ?? current?.state ?? null,
      });
    }
  });
}

export class SpellAttackService {
  static async initialize() {
    if (initialized) return;
    initialized = true;
    Hooks.on("preCreateChatMessage", (document, _data, _options, userId) => {
      try {
        captureSpellAttackObservation(document, userId);
      } catch (error) {
        logger.error("Spell attack pre-create capture failed open", {
          stage: "spell-attack-pre-create",
          reason: "internal-exception",
        }, error);
      }
    });
    game.socket?.on?.(SOCKET_NAMESPACE, (raw) => {
      if (raw?.action !== SPELL_ATTACK_SOCKET_ACTION || !game.user?.isGM) return;
      const damageMessage = game.messages?.get(raw.damageMessageId);
      if (damageMessage) {
        void processDamage(damageMessage).catch((error) => {
          logger.error("Spell attack socket processing failed open", {
            stage: "spell-attack-socket",
            reason: "internal-exception",
          }, error);
        });
      }
    });
  }

  static async handleCreatedMessage(message) {
    if (!getSetting(SETTINGS.ENABLED)) return false;
    if (isSpellAttackCandidate(message)) return observeAttack(message);
    const damage = normalizeSpellAttackDamage(message);
    if (!damage || observedDamage.has(message.id)) return false;
    observedDamage.add(message.id);
    if (authorId(message) === game.user?.id && !game.user?.isGM) {
      await game.socket?.emit?.(SOCKET_NAMESPACE, {
        action: SPELL_ATTACK_SOCKET_ACTION,
        damageMessageId: message.id,
      });
    }
    return processDamage(message);
  }

  static getStatus() {
    return {
      enabled: getSetting(SETTINGS.ENABLED) === true && getSetting(SETTINGS.SPELL_ATTACK_AUTO_APPLY) === true,
      producerAvailable: true,
      supportedTargetCount: 1,
      correlationMethod: "pf2e-structured-spell-attack-unique",
      autoApply: getSetting(SETTINGS.SPELL_ATTACK_AUTO_APPLY) === true,
      presentation: {
        protocol: 1,
        damageRolledHook: "nelflow.spellAttackDamageRolledPresentation",
        damageAppliedHook: "nelflow.spellAttackDamageAppliedPresentation",
      },
      repair: {
        id: "spell-attack-application-v2",
        validatingTransition: true,
        serializedBoundaryDiagnostics: true,
        applicationItemFallback: true,
        tokenDocumentFallback: true,
      },
      counters: { ...stats },
    };
  }

  static watchFlow(fn) {
    flowWatcher = typeof fn === "function" ? fn : null;
    return { watching: typeof flowWatcher === "function" };
  }

  static stopWatchingFlow() {
    flowWatcher = null;
    return { watching: false };
  }

  static resetStatsForTests() {
    for (const key of Object.keys(stats)) stats[key] = 0;
    observedDamage.clear();
    flowWatcher = null;
    initialized = false;
  }
}