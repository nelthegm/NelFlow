import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { DAMAGE_CORRELATION_REASONS } from "./damage-correlation.js";
import { logger } from "./logger.js";
import { guardedHealthRestore } from "./guarded-health-restore.js";
import {
  COMMIT_TRIGGERS,
  armPendingImpactCommit,
  buildNelcineStrikeRawPayload,
  canUseNelcineImpactSync,
  claimPendingImpactCommit,
  registerNelcineImpactHook,
  transactionIdFromImpact,
} from "./nelcine-impact-bridge.js";
import {
  tryDeliverStrikeImpactSync,
  tryDeliverStrikePresentation,
} from "./nelcine-strike-delivery.js";
import {
  tryEmitStrikeAttackPresentationFeed,
  tryEmitStrikeDamageRolledPresentationFeed,
  tryEmitStrikePresentationFeed,
} from "./strike-presentation-feed.js";
import { noteLethalApplicationIfZeroHp } from "./nelcine-defeated-bridge.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getSetting } from "./settings.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import { MULTI_TARGET_CAPTURE_FLAG, validCapture } from "./multi-target-strike-model.js";

const inFlight = new Set();

function localize(key) {
  return game.i18n.localize(key);
}

function notify(key) {
  ui.notifications.warn(key, { localize: true });
}

function logContext(attackMessage, transaction, stage, reason) {
  const snapshot = transaction?.snapshot;
  return {
    attackMessageId: attackMessage?.id,
    transactionId: transaction?.id,
    sourceActorUuid: snapshot?.sourceActorUuid,
    targetActorUuid: snapshot?.targetActorUuid,
    stage,
    reason,
  };
}

function makeSnapshot(attackMessage, strike, targetToken) {
  return {
    sourceActorUuid: strike.actor.uuid,
    sourceTokenUuid: strike.sourceTokenUuid,
    sourceItemUuid: strike.item.uuid,
    strikeIdentifier: strike.identifier,
    strikeName: strike.item.name,
    strikeIcon: strike.item.img,
    sourceName: attackMessage.token?.name ?? strike.actor.name,
    sourceIcon: attackMessage.token?.texture?.src ?? strike.actor.img,
    attackMessageId: attackMessage.id,
    attackCreatedAt: attackMessage._stats?.createdTime ?? Date.now(),
    targetActorUuid: targetToken.actor.uuid,
    targetTokenUuid: targetToken.document.uuid,
    targetName: targetToken.name,
    sceneId: targetToken.document.parent?.id ?? null,
    outcome: strike.outcome,
    mapIncreases: strike.mapIncreases,
    mapPenalty: strike.mapPenalty,
    supplementalActions: SupplementalActionAwareness.fromStrike(strike),
    autoApplyRequested: getSetting(SETTINGS.AUTO_APPLY),
    processingUserId: game.user.id,
    timestamp: Date.now(),
  };
}

function appliedAmount(before, after) {
  return Math.max(0, before.hp + before.tempHp - after.hp - after.tempHp);
}

function presentationArgsFromStrike({
  transaction,
  strike,
  message,
  targetToken,
  damageMessage = null,
  damageSummary = null,
  includeDamage = false,
  impactSyncSelected = false,
}) {
  return {
    transactionId: transaction.id,
    transactionType: "npc-strike",
    strike,
    attackMessage: message,
    targetToken,
    damageMessage,
    damageSummary,
    includeDamage,
    impactSyncSelected,
    multiTarget: false,
    outcome: strike.outcome,
    critical: strike.outcome === "criticalSuccess",
    sceneId: transaction.snapshot?.sceneId ?? targetToken?.document?.parent?.id ?? null,
    attackerTokenUuid: strike.sourceTokenUuid ?? message.token?.document?.uuid ?? null,
    attackerActorUuid: strike.actor?.uuid ?? null,
    targetTokenUuid: targetToken?.document?.uuid ?? null,
    targetActorUuid: targetToken?.actor?.uuid ?? null,
    itemUuid: strike.item?.uuid ?? null,
    actionName: strike.item?.name ?? null,
    mapPenalty: strike.mapPenalty ?? null,
  };
}

/**
 * Always emit the presentation-neutral feed, then optionally deliver to NelCine.
 * Feed is independent of NelCine gates; NelCine path is unchanged.
 * @param {object} args
 * @returns {{ feed: object, nelcine: object }}
 */
function deliverResolvedStrikePresentation(args) {
  const feed = tryEmitStrikePresentationFeed(args);
  const nelcine = tryDeliverStrikePresentation(args);
  return { feed, nelcine };
}

async function syncStack(attackMessage, transaction, stage) {
  try {
    await TurnStackService.syncTransaction(attackMessage, transaction);
  } catch (error) {
    const reason = "internal-exception";
    logger.error(
      "Compact stack projection failed",
      logContext(attackMessage, transaction, `stack-${stage}`, reason),
      error,
    );
    try {
      await TransactionStore.update(attackMessage, { presentationError: reason });
    } catch (stateError) {
      logger.error(
        "Unable to persist compact stack error",
        logContext(attackMessage, transaction, "persist-stack-error", reason),
        stateError,
      );
    }
  }
}

/**
 * Existing damage application + Undo metadata path. Used for immediate and delayed commits.
 */
async function commitStrikeApplication({
  message,
  transaction,
  strike,
  targetToken,
  damageMessage,
  preApplication,
  triggerSource = COMMIT_TRIGGERS.IMMEDIATE,
}) {
  const applied = await PF2eAdapter.applyDamageToRecordedTarget({
    attackMessage: message,
    damageMessage,
    strike,
    targetToken,
    transactionId: transaction.id,
  });
  if (!applied) {
    throw new Error(localize("Nelflow.Reason.NativeApplyUnavailable"));
  }

  const postApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
  if (!postApplication) {
    throw new Error(localize("Nelflow.Reason.NativeApplyUnavailable"));
  }

  noteLethalApplicationIfZeroHp({
    actor: targetToken.actor,
    token: targetToken.document ?? targetToken,
    transactionId: transaction.id,
    causeType: "strike",
    postApplication,
    sourceActor: strike?.actor ?? message?.actor,
    sourceToken: strike?.token ?? message?.token,
  });

  let next = transaction;
  if (applied.applicationMessage) {
    next = await TransactionStore.linkMessage(message, applied.applicationMessage, "application");
  }
  next = await TransactionStore.update(message, {
    state: TRANSACTION_STATES.APPLIED,
    preApplication,
    postApplication,
    appliedAmount: appliedAmount(preApplication, postApplication),
    targetName: targetToken.name,
    impactCommit: {
      triggerSource,
      committedAt: Date.now(),
    },
  });
  await syncStack(message, next, "applied");
  logger.debug("Damage applied", {
    transactionId: next.id,
    preApplication,
    postApplication,
    appliedAmount: next.appliedAmount,
    triggerSource,
  });
  return next;
}

async function commitArmedImpact(transactionId, triggerSource) {
  const pending = claimPendingImpactCommit(transactionId, triggerSource);
  if (!pending) return { committed: false, reason: "already-committed-or-missing" };

  const message = game.messages.get(pending.attackMessageId);
  if (!message) {
    logger.warn("Impact commit missing attack message", { transactionId, triggerSource });
    return { committed: false, reason: "missing-attack-message" };
  }

  let transaction = TransactionStore.get(message);
  if (!transaction || transaction.id !== transactionId) {
    logger.warn("Impact commit missing transaction", { transactionId, triggerSource });
    return { committed: false, reason: "missing-transaction" };
  }

  if (
    transaction.state !== TRANSACTION_STATES.AWAITING_IMPACT &&
    transaction.state !== TRANSACTION_STATES.DAMAGE_ROLLED
  ) {
    return { committed: false, reason: "unexpected-state" };
  }

  const strike = PF2eAdapter.inspectStrikeMessage(message);
  const targetToken = await PF2eAdapter.resolveToken(pending.targetTokenUuid);
  const damageMessage = game.messages.get(pending.damageMessageId);

  if (!strike || !targetToken || !damageMessage) {
    transaction = await TransactionStore.update(message, {
      state: TRANSACTION_STATES.FAILED,
      reasonKey: "Nelflow.Reason.ProcessingError",
      errorStage: "impact-commit",
    });
    await syncStack(message, transaction, "impact-commit-failed");
    notify("Nelflow.Notification.ApplyFailed");
    return { committed: false, reason: "resolve-failed" };
  }

  try {
    const preApplication = pending.preApplication ?? PF2eAdapter.healthSnapshot(targetToken.actor);
    if (!preApplication) {
      throw new Error(localize("Nelflow.Reason.NativeApplyUnavailable"));
    }
    await commitStrikeApplication({
      message,
      transaction,
      strike,
      targetToken,
      damageMessage,
      preApplication,
      triggerSource,
    });
    return { committed: true, triggerSource };
  } catch (error) {
    logger.error(
      "Impact commit failed",
      logContext(message, transaction, "impact-commit", triggerSource),
      error,
    );
    try {
      transaction = await TransactionStore.update(message, {
        state: TRANSACTION_STATES.FAILED,
        reasonKey: "Nelflow.Reason.ProcessingError",
        errorStage: "impact-commit",
      });
      await syncStack(message, transaction, "impact-commit-failed");
    } catch (stateError) {
      logger.error("Unable to persist impact commit failure", {}, stateError);
    }
    notify("Nelflow.Notification.ApplyFailed");
    return { committed: false, reason: "apply-failed" };
  }
}

export class StrikeResolver {
  static initializeImpactBridge() {
    registerNelcineImpactHook((impact) => {
      // Never trust NelCine damage metadata — transactionId only.
      const transactionId = transactionIdFromImpact(impact);
      if (!transactionId) return;
      return commitArmedImpact(transactionId, COMMIT_TRIGGERS.IMPACT);
    });
  }

  static async handleAttackMessage(message) {
    if (validCapture(message.getFlag?.(MODULE_ID, MULTI_TARGET_CAPTURE_FLAG))) return;
    if (
      !getSetting(SETTINGS.ENABLED) ||
      !PF2eAdapter.isEnvironmentSupported() ||
      !game.user.isGM ||
      message.author?.id !== game.user.id ||
      TransactionStore.get(message) ||
      inFlight.has(message.id)
    ) {
      return;
    }

    const isStrikeCandidate = PF2eAdapter.isNpcStrikeCandidate(message);
    const strike = PF2eAdapter.inspectStrikeMessage(message);
    logger.debug("Chat message inspection", PF2eAdapter.diagnosticSummary(message, strike));
    if (!strike) {
      if (isStrikeCandidate) {
        notify("Nelflow.Notification.UnresolvedStrike");
        logger.warn("Unable to resolve NPC Strike", {
          attackMessageId: message.id,
          sourceActorUuid: message.actor?.uuid,
          stage: "detect",
          reason: localize("Nelflow.Reason.UnresolvedStrike"),
        });
      }
      return;
    }

    inFlight.add(message.id);
    let transaction = null;
    let unpersistedDamageClaimId = null;
    let stage = "detect";
    try {
      const targets = PF2eAdapter.selectedTargets();
      if (targets.length === 0) {
        notify("Nelflow.Notification.NoTarget");
        logger.warn(
          "Strike skipped",
          logContext(message, transaction, stage, localize("Nelflow.Reason.NoTarget")),
        );
        return;
      }
      if (targets.length !== 1) {
        notify("Nelflow.Notification.MultipleTargets");
        logger.warn(
          "Strike skipped",
          logContext(message, transaction, stage, localize("Nelflow.Reason.MultipleTargets")),
        );
        return;
      }

      const targetToken = PF2eAdapter.resolveRecordedTarget(strike, targets[0]);
      if (!targetToken) {
        notify("Nelflow.Notification.TargetMismatch");
        logger.warn(
          "Strike skipped",
          logContext(message, transaction, stage, localize("Nelflow.Reason.TargetMismatch")),
        );
        return;
      }

      if (!strike.outcome || !PF2eAdapter.hasNativeDamageMethod(strike)) {
        notify("Nelflow.Notification.UnresolvedStrike");
        logger.warn(
          "Strike outcome or damage method unavailable",
          logContext(message, transaction, stage, localize("Nelflow.Reason.UnresolvedStrike")),
        );
        return;
      }

      const snapshot = makeSnapshot(message, strike, targetToken);
      transaction = await TransactionStore.claim(message, snapshot);
      if (!transaction) return;
      await syncStack(message, transaction, "claim");
      logger.debug("Transaction claimed", {
        transactionId: transaction.id,
        snapshot,
      });

      // Stage 1: attack check is authoritative here — before damage roll.
      tryEmitStrikeAttackPresentationFeed(
        presentationArgsFromStrike({
          transaction,
          strike,
          message,
          targetToken,
          includeDamage: false,
        }),
      );

      if (["failure", "criticalFailure"].includes(strike.outcome)) {
        transaction = await TransactionStore.update(message, {
          state: TRANSACTION_STATES.SKIPPED,
          reasonKey: "Nelflow.Reason.AttackFailed",
          targetName: targetToken.name,
        });
        await syncStack(message, transaction, "skipped");
        deliverResolvedStrikePresentation(
          presentationArgsFromStrike({
            transaction,
            strike,
            message,
            targetToken,
            includeDamage: false,
          }),
        );
        return;
      }

      stage = "roll-damage";
      const rolled = await PF2eAdapter.rollStrikeDamage({
        attackMessage: message,
        strike,
        targetToken,
        transactionId: transaction.id,
      });
      if (!rolled.ok) {
        if (rolled.nativeRollReturned) {
          transaction = await TransactionStore.update(message, {
            state: TRANSACTION_STATES.FAILED,
            reasonKey: "Nelflow.Reason.DamageUnlinked",
            errorStage: "damage-correlation",
            manualApplicationRequired: true,
            damageSummary: PF2eAdapter.summarizeDamageRoll(rolled.roll),
            damageCorrelation: {
              schemaVersion: 1,
              sequence: rolled.sequence ?? null,
              strategy: rolled.strategy ?? "scoped-roll-option",
              state: "manual-fallback",
              reason: rolled.reason ?? DAMAGE_CORRELATION_REASONS.MISSING,
              candidateCount: rolled.candidateCount ?? 0,
              correlationOption: rolled.correlationOption ?? null,
              elapsedMs: rolled.elapsedMs ?? null,
            },
            targetName: targetToken.name,
          });
          await syncStack(message, transaction, "manual-fallback");
          logger.debug("manual-fallback", {
            transactionId: transaction.id.slice(-10),
            attackMessageId: message.id,
            strategy: rolled.strategy ?? "scoped-roll-option",
            reason: rolled.reason ?? DAMAGE_CORRELATION_REASONS.MISSING,
            sourceActorUuid: transaction.snapshot.sourceActorUuid,
            elapsedMs: rolled.elapsedMs ?? null,
          });
          notify("Nelflow.Notification.ManualApplicationRequired");
          deliverResolvedStrikePresentation(
            presentationArgsFromStrike({
              transaction,
              strike,
              message,
              targetToken,
              damageMessage: rolled.damageMessage,
              damageSummary,
              includeDamage: false,
            }),
          );
          return;
        }
        throw rolled.error ??
          new Error(
            rolled.reason === DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED
              ? localize("Nelflow.Reason.NativeDamageCallFailed")
              : localize("Nelflow.Reason.DamageMessageMissing"),
          );
      }

      unpersistedDamageClaimId = rolled.damageMessage.id;
      const damageSummary = PF2eAdapter.summarizeDamageRoll(rolled.roll);
      transaction = await TransactionStore.update(message, {
        state: TRANSACTION_STATES.DAMAGE_ROLLED,
        damageMessageId: rolled.damageMessage.id,
        damageSummary,
        damageCorrelation: {
          schemaVersion: 1,
          sequence: rolled.sequence,
          strategy: rolled.strategy,
          state: "claimed",
          reason: null,
          candidateCount: rolled.candidateCount,
          correlationOption: rolled.correlationOption,
          elapsedMs: rolled.elapsedMs,
        },
        manualApplicationRequired: false,
        targetName: targetToken.name,
      });
      if (!PF2eAdapter.persistDamageClaim(rolled.damageMessage.id, transaction.id)) {
        throw new Error(localize("Nelflow.Reason.DamageAlreadyClaimed"));
      }
      unpersistedDamageClaimId = null;
      transaction = await TransactionStore.linkMessage(message, rolled.damageMessage, "damage");
      await syncStack(message, transaction, "damage-rolled");

      // Stage 2: authoritative native DamageRoll exists — before application / final.
      tryEmitStrikeDamageRolledPresentationFeed(
        presentationArgsFromStrike({
          transaction,
          strike,
          message,
          targetToken,
          damageMessage: rolled.damageMessage,
          damageSummary,
          includeDamage: true,
        }),
      );

      if (!getSetting(SETTINGS.AUTO_APPLY)) {
        deliverResolvedStrikePresentation(
          presentationArgsFromStrike({
            transaction,
            strike,
            message,
            targetToken,
            damageMessage: rolled.damageMessage,
            damageSummary,
            includeDamage: true,
          }),
        );
        return;
      }

      stage = "apply-damage";
      const applicationGuard = PF2eAdapter.validateDamageForApplication({
        attackMessage: message,
        transaction,
        damageMessage: rolled.damageMessage,
        strike,
        targetToken,
      });
      if (!applicationGuard.ok) {
        transaction = await TransactionStore.update(message, {
          state: TRANSACTION_STATES.FAILED,
          reasonKey: "Nelflow.Reason.DamageUnlinked",
          errorStage: "damage-correlation",
          manualApplicationRequired: true,
          damageCorrelation: {
            ...(transaction.damageCorrelation ?? {}),
            state: "manual-fallback",
            reason: applicationGuard.reason,
          },
        });
        await syncStack(message, transaction, "application-guard");
        logger.debug("manual-fallback", {
          transactionId: transaction.id.slice(-10),
          attackMessageId: message.id,
          candidateMessageId: rolled.damageMessage.id,
          strategy: transaction.damageCorrelation?.strategy ?? "scoped-roll-option",
          reason: applicationGuard.reason,
          sourceActorUuid: transaction.snapshot.sourceActorUuid,
          elapsedMs: transaction.damageCorrelation?.elapsedMs ?? null,
        });
        notify("Nelflow.Notification.ManualApplicationRequired");
        deliverResolvedStrikePresentation(
          presentationArgsFromStrike({
            transaction,
            strike,
            message,
            targetToken,
            damageMessage: rolled.damageMessage,
            damageSummary,
            includeDamage: true,
          }),
        );
        return;
      }
      const preApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
      if (!preApplication) {
        throw new Error(localize("Nelflow.Reason.NativeApplyUnavailable"));
      }

      const presentationRequired = getSetting(SETTINGS.NELCINE_STRIKE_CINEMATICS) === true;
      const syncGate = presentationRequired
        ? canUseNelcineImpactSync({
            targetSceneId: targetToken.document.parent?.id ?? null,
            outcome: strike.outcome,
            hasAuthoritativeDamage: Boolean(damageSummary) && Number.isFinite(damageSummary.total),
            damageTotal: damageSummary?.total,
            supportsDelayedCommit: true,
          })
        : { eligible: false, reason: "strike-cinematics-disabled", runtime: null };

      if (!syncGate.eligible) {
        logger.debug("NelCine impact sync skipped; applying immediately", {
          transactionId: transaction.id,
          reason: syncGate.reason,
        });
        await commitStrikeApplication({
          message,
          transaction,
          strike,
          targetToken,
          damageMessage: rolled.damageMessage,
          preApplication,
          triggerSource: COMMIT_TRIGGERS.IMMEDIATE,
        });
        deliverResolvedStrikePresentation(
          presentationArgsFromStrike({
            transaction,
            strike,
            message,
            targetToken,
            damageMessage: rolled.damageMessage,
            damageSummary,
            includeDamage: true,
            impactSyncSelected: false,
          }),
        );
        return;
      }

      const rawPayload = buildNelcineStrikeRawPayload({
        transactionId: transaction.id,
        strike,
        attackMessage: message,
        targetToken,
        damageMessage: rolled.damageMessage,
        damageSummary,
      });

      // Neutral feed once; impact-sync owns NelCine cinematic delivery separately.
      tryEmitStrikePresentationFeed({
        ...presentationArgsFromStrike({
          transaction,
          strike,
          message,
          targetToken,
          damageMessage: rolled.damageMessage,
          damageSummary,
          includeDamage: true,
          impactSyncSelected: true,
        }),
        payload: rawPayload,
      });

      armPendingImpactCommit(
        {
          transactionId: transaction.id,
          attackMessageId: message.id,
          damageMessageId: rolled.damageMessage.id,
          targetTokenUuid: targetToken.document.uuid,
          preApplication,
          impactTimeoutMs: syncGate.impactTimeoutMs,
        },
        {
          onEmergency: (id) => {
            void commitArmedImpact(id, COMMIT_TRIGGERS.TIMEOUT);
          },
        },
      );

      transaction = await TransactionStore.update(message, {
        state: TRANSACTION_STATES.AWAITING_IMPACT,
        preApplication,
        impactPending: {
          armedAt: Date.now(),
          impactTimeoutMs: syncGate.impactTimeoutMs,
          emergencyTimeoutMs: computeEmergencyMs(syncGate.impactTimeoutMs),
        },
      });
      await syncStack(message, transaction, "awaiting-impact");

      try {
        // Impact-sync owns cinematic delivery — do not also emit nelflow.strikeResolved.
        const delivery = tryDeliverStrikeImpactSync({
          transactionId: transaction.id,
          payload: rawPayload,
          broadcast: syncGate.runtime.broadcast,
          broadcastOptions: {
            authoritativeImpact: true,
            impactTimeoutMs: syncGate.impactTimeoutMs,
            impactFallbackMs: syncGate.impactTimeoutMs,
          },
          onBroadcastPromise: (broadcastPromise) => {
            void Promise.resolve(broadcastPromise).catch((error) => {
              logger.warn(
                "NelCine broadcast failed; committing via NelFlow fallback",
                logContext(message, transaction, "nelcine-broadcast", error?.message ?? String(error)),
              );
              void commitArmedImpact(transaction.id, COMMIT_TRIGGERS.BROADCAST_FAILED);
            });
          },
        });
        if (!delivery.delivered) {
          logger.warn(
            "NelCine impact delivery skipped; committing via NelFlow fallback",
            logContext(message, transaction, "nelcine-broadcast", delivery.reason),
          );
          await commitArmedImpact(transaction.id, COMMIT_TRIGGERS.BROADCAST_FAILED);
        }
      } catch (error) {
        logger.warn(
          "NelCine broadcast threw; committing via NelFlow fallback",
          logContext(message, transaction, "nelcine-broadcast", error?.message ?? String(error)),
        );
        await commitArmedImpact(transaction.id, COMMIT_TRIGGERS.BROADCAST_FAILED);
      }
    } catch (error) {
      const reason = "internal-exception";
      logger.error(
        "Strike automation failed",
        logContext(message, transaction, stage, reason),
        error,
      );
      if (transaction) {
        try {
          transaction = await TransactionStore.update(message, {
            state: TRANSACTION_STATES.FAILED,
            reasonKey: "Nelflow.Reason.ProcessingError",
            errorStage: stage,
          });
          await syncStack(message, transaction, "failed");
        } catch (stateError) {
          logger.error(
            "Unable to persist terminal failure state",
            logContext(message, transaction, "persist-failure", reason),
            stateError,
          );
        }
      }
      if (stage === "apply-damage" || stage === "roll-damage") {
        notify("Nelflow.Notification.ApplyFailed");
      }
    } finally {
      if (unpersistedDamageClaimId && transaction?.id) {
        PF2eAdapter.releaseDamageClaim(unpersistedDamageClaimId, transaction.id);
      }
      inFlight.delete(message.id);
    }
  }

  static async undoFromMessage(message) {
    if (!game.user.isGM || !getSetting(SETTINGS.ENABLE_UNDO)) return;
    const resolved = TransactionStore.resolveCanonical(message);
    if (!resolved) {
      notify("Nelflow.Notification.UndoUnavailable");
      return;
    }

    const { attackMessage, transaction } = resolved;
    const context = logContext(attackMessage, transaction, "undo", null);
    if (
      transaction.state !== TRANSACTION_STATES.APPLIED ||
      !transaction.preApplication ||
      !transaction.postApplication
    ) {
      notify("Nelflow.Notification.UndoUnavailable");
      return;
    }

    try {
      await TransactionStore.update(attackMessage, {
        undoOperation: {
          state: "undoing",
          ownerUserId: game.user.id,
          sessionId: getRuntimeSessionId(),
          enteredRevision: Number(transaction.revision ?? 0) + 1,
        },
      });
      const restored = await guardedHealthRestore({
        resolveToken: (uuid) => PF2eAdapter.resolveToken(uuid),
        healthSnapshot: (actor) => PF2eAdapter.healthSnapshot(actor),
        restoreHealth: (actor, snapshot) => PF2eAdapter.restoreHealth(actor, snapshot),
        targetTokenUuid: transaction.snapshot.targetTokenUuid,
        targetActorUuid: transaction.snapshot.targetActorUuid,
        preApplication: transaction.preApplication,
        postApplication: transaction.postApplication,
      });
      if (restored.reason === "target-unavailable") {
        await TransactionStore.update(attackMessage, {
          undoOperation: { state: "failed", reason: "target-unavailable" },
        });
        notify("Nelflow.Notification.UndoUnavailable");
        logger.warn("Undo target unavailable", {
          ...context,
          reason: "Recorded target no longer resolves",
        });
        return;
      }
      if (restored.reason === "health-changed") {
        notify("Nelflow.Notification.UndoChanged");
        logger.warn("Undo guard blocked restoration", {
          ...context,
          reason: "Target HP or temporary HP changed after application",
        });
        const blocked = await TransactionStore.update(attackMessage, {
          undoBlocked: true,
          undoOperation: { state: "failed", reason: "health-changed" },
        });
        await syncStack(attackMessage, blocked, "undo-blocked");
        return;
      }
      const undone = await TransactionStore.update(attackMessage, {
        state: TRANSACTION_STATES.UNDONE,
        undoBlocked: false,
        undoOperation: { state: "complete" },
      });
      await syncStack(attackMessage, undone, "undone");
      logger.debug("Transaction undone", {
        transactionId: transaction.id,
        restored: transaction.preApplication,
      });
    } catch (error) {
      notify("Nelflow.Notification.UndoFailed");
      logger.error("Guarded Undo failed", context, error);
      try {
        const marked = await TransactionStore.update(attackMessage, {
          presentationError: error instanceof Error ? error.message : String(error),
          undoOperation: { state: "failed", reason: "undo-native-call-failed" },
        });
        await syncStack(attackMessage, marked, "undo-error");
      } catch (stateError) {
        logger.error("Unable to persist Undo error", context, stateError);
      }
    }
  }
}

function computeEmergencyMs(impactTimeoutMs) {
  const n = Number(impactTimeoutMs);
  const padded = (Number.isFinite(n) ? n : 5000) + 1500;
  return Math.min(18000, Math.max(2000, padded));
}
