import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { DAMAGE_CORRELATION_REASONS } from "./damage-correlation.js";
import { logger } from "./logger.js";
import { guardedHealthRestore } from "./guarded-health-restore.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getSetting } from "./settings.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";
import { getRuntimeSessionId } from "./runtime-session.js";

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

export class StrikeResolver {
  static async handleAttackMessage(message) {
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

      if (["failure", "criticalFailure"].includes(strike.outcome)) {
        transaction = await TransactionStore.update(message, {
          state: TRANSACTION_STATES.SKIPPED,
          reasonKey: "Nelflow.Reason.AttackFailed",
          targetName: targetToken.name,
        });
        await syncStack(message, transaction, "skipped");
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
      transaction = await TransactionStore.update(message, {
        state: TRANSACTION_STATES.DAMAGE_ROLLED,
        damageMessageId: rolled.damageMessage.id,
        damageSummary: PF2eAdapter.summarizeDamageRoll(rolled.roll),
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

      if (!getSetting(SETTINGS.AUTO_APPLY)) return;

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
        return;
      }
      const preApplication = PF2eAdapter.healthSnapshot(targetToken.actor);
      if (!preApplication) {
        throw new Error(localize("Nelflow.Reason.NativeApplyUnavailable"));
      }

      const applied = await PF2eAdapter.applyDamageToRecordedTarget({
        attackMessage: message,
        damageMessage: rolled.damageMessage,
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

      if (applied.applicationMessage) {
        transaction = await TransactionStore.linkMessage(
          message,
          applied.applicationMessage,
          "application",
        );
      }
      transaction = await TransactionStore.update(message, {
        state: TRANSACTION_STATES.APPLIED,
        preApplication,
        postApplication,
        appliedAmount: appliedAmount(preApplication, postApplication),
        targetName: targetToken.name,
      });
      await syncStack(message, transaction, "applied");
      logger.debug("Damage applied", {
        transactionId: transaction.id,
        preApplication,
        postApplication,
        appliedAmount: transaction.appliedAmount,
      });
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
