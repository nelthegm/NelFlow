import {
  MODULE_ID,
  SETTINGS,
} from "./constants.js";
import { logger } from "./logger.js";
import {
  batchState,
  groupTargetOutcomes,
  MULTI_TARGET_CAPTURE_FLAG,
  MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
  targetIsHit,
  validCapture,
  multiTargetModeAllows,
} from "./multi-target-strike-model.js";
import { deriveResourceLossFromSnapshots } from "./damage-resource-loss.js";
import { emitDamageAppliedFromApplication } from "./damage-applied-bridge.js";
import { registerDeferredMitigation } from "./native-mitigation-deferral.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { noteLethalApplicationIfZeroHp } from "./nelcine-defeated-bridge.js";
import { playerStrikeModeAllows } from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";
import {
  authorTargetSetMatches,
  makeMultiTargetSnapshot,
  resolveMultiTargetChildren,
} from "./multi-target-strike-resolution.js";
import { undoAllMultiTarget, undoMultiTarget } from "./multi-target-strike-undo.js";

const inFlight = new Set();

function authorId(message) {
  return message.author?.id ?? message.user?.id ?? message._source?.user ?? null;
}

function authorityFor(message) {
  return electProcessingGm(game.users ?? [], authorId(message));
}


function resourceLossFromSnapshots(before, after) {
  return (
    deriveResourceLossFromSnapshots(before, after) ?? {
      hpLoss: 0,
      tempHpLoss: 0,
      staminaLoss: 0,
      totalApplied: 0,
    }
  );
}

function canApplyChild(transaction, child, currentToken) {
  if (transaction.snapshot.actorType === "npc") return getSetting(SETTINGS.AUTO_APPLY);
  const mode = getSetting(SETTINGS.PLAYER_STRIKE_AUTO_APPLY);
  return playerStrikeModeAllows({
    mode,
    snapshotDisposition: child.disposition,
    currentDisposition: currentToken.document.disposition,
  });
}

async function syncPresentation(message, transaction) {
  if (transaction.snapshot.actorType === "npc") {
    try {
      await TurnStackService.syncTransaction(message, transaction);
    } catch (error) {
      logger.error("Multi-target stack projection failed open", {
        attackMessageId: message.id,
        stage: "batch-stack-projection",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
      await TransactionStore.updateMultiTargetStrike(message, {
        presentationError: "stack-projection-failed",
      }).catch(() => undefined);
    }
  }
  try {
    await ui.chat?.render?.({ force: true });
  } catch {
    // Durable flags remain authoritative; presentation failures are fail-open.
  }
}

async function update(message, changes) {
  const transaction = await TransactionStore.updateMultiTargetStrike(message, changes);
  await syncPresentation(message, transaction);
  return transaction;
}

async function processDamageGroup(message, strike, transaction, groupName, groupChildren) {
  if (!groupChildren.length) {
    const damageGroups = foundry.utils.deepClone(transaction.damageGroups);
    damageGroups[groupName].state = "unused";
    return update(message, { damageGroups });
  }
  const liveChildren = [];
  const unavailableKeys = new Set();
  const liveTokens = new Map();
  for (const child of groupChildren) {
    const token = await PF2eAdapter.resolveToken(child.tokenUuid);
    if (token?.actor?.uuid === child.actorUuid) {
      liveChildren.push(child);
      liveTokens.set(child.key, token);
    } else unavailableKeys.add(child.key);
  }
  if (unavailableKeys.size) {
    const targets = transaction.targets.map((child) => unavailableKeys.has(child.key)
      ? { ...child, state: "review", reviewReason: "target-unavailable" }
      : child);
    transaction = await update(message, { targets, state: batchState(targets) });
  }
  groupChildren = liveChildren;
  const representative = liveTokens.get(groupChildren[0]?.key);
  if (!representative) {
    const damageGroups = foundry.utils.deepClone(transaction.damageGroups);
    damageGroups[groupName] = { state: "review", damageMessageId: null, damageSummary: null };
    return update(message, { damageGroups, state: batchState(transaction.targets) });
  }
  const outcome = groupName === "critical" ? "criticalSuccess" : "success";
  const groupTransactionId = `${transaction.id}:${groupName}`;
  const rolled = await PF2eAdapter.rollStrikeDamage({
    attackMessage: message,
    strike: {
      ...strike,
      outcome,
      targetActorUuid: representative.actor.uuid,
      targetTokenUuid: representative.document.uuid,
      context: {
        ...strike.context,
        outcome,
        target: { actor: representative.actor.uuid, token: representative.document.uuid },
      },
    },
    targetToken: representative,
    transactionId: groupTransactionId,
    nativeMarker: {
      transactionType: MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
      attackMessageId: message.id,
      damageGroup: groupName,
    },
  });
  if (!rolled.ok) {
    const targets = transaction.targets.map((child) =>
      groupChildren.some((candidate) => candidate.key === child.key)
        ? { ...child, state: "review", reviewReason: rolled.reason ?? "damage-unavailable" }
        : child,
    );
    const damageGroups = foundry.utils.deepClone(transaction.damageGroups);
    damageGroups[groupName] = { state: "review", damageMessageId: null, damageSummary: null };
    return update(message, { targets, damageGroups, state: batchState(targets) });
  }
  if (!PF2eAdapter.persistDamageClaim(rolled.damageMessage.id, groupTransactionId)) {
    const targets = transaction.targets.map((child) =>
      groupChildren.some((candidate) => candidate.key === child.key)
        ? { ...child, state: "review", reviewReason: "damage-claim-conflict" }
        : child,
    );
    const damageGroups = foundry.utils.deepClone(transaction.damageGroups);
    damageGroups[groupName] = { state: "review", damageMessageId: null, damageSummary: null };
    return update(message, { targets, damageGroups, state: batchState(targets) });
  }
  transaction = await TransactionStore.linkMultiTargetMessage(message, rolled.damageMessage, {
    role: "damage",
    damageGroup: groupName,
  });
  const damageSummary = PF2eAdapter.summarizeDamageRoll(rolled.roll);
  const damageGroups = foundry.utils.deepClone(transaction.damageGroups);
  damageGroups[groupName] = { state: "damage-rolled", damageMessageId: rolled.damageMessage.id, damageSummary };
  let targets = transaction.targets.map((child) =>
    groupChildren.some((candidate) => candidate.key === child.key)
      ? { ...child, damageMessageId: rolled.damageMessage.id, damageSummary, state: "damage-rolled" }
      : child,
  );
  transaction = await update(message, { targets, damageGroups, state: batchState(targets) });

  for (const original of groupChildren) {
    let child = transaction.targets.find((candidate) => candidate.key === original.key);
    const trustedChild = original;
    const identityUnchanged =
      child?.tokenUuid === trustedChild.tokenUuid &&
      child?.actorUuid === trustedChild.actorUuid &&
      child?.sceneId === trustedChild.sceneId;
    const token = identityUnchanged
      ? liveTokens.get(trustedChild.key) ?? await PF2eAdapter.resolveToken(trustedChild.tokenUuid)
      : null;
    if (!token || token.actor?.uuid !== trustedChild.actorUuid) {
      targets = transaction.targets.map((candidate) => candidate.key === child.key
        ? { ...candidate, state: "review", reviewReason: "target-unavailable" }
        : candidate);
      transaction = await update(message, { targets, state: batchState(targets) });
      continue;
    }
    if (!canApplyChild(transaction, trustedChild, token)) continue;
    const preApplication = PF2eAdapter.healthSnapshot(token.actor);
    if (!preApplication) {
      targets = transaction.targets.map((candidate) => candidate.key === child.key
        ? { ...candidate, state: "review", reviewReason: "health-unavailable" }
        : candidate);
      transaction = await update(message, { targets, state: batchState(targets) });
      continue;
    }
    const applicationId = `${transaction.id}:target:${child.key}`;
    const targetKey = child.key;
    const applied = await PF2eAdapter.applyDamageRollToRecordedTarget({
      damageMessage: rolled.damageMessage,
      damageRoll: rolled.roll,
      sourceActor: strike.actor,
      sourceItem: strike.item,
      targetToken: token,
      expectedTargetActorUuid: trustedChild.actorUuid,
      multiplier: 1,
      outcome,
      applicationId,
      attackMessageId: message.id,
      shieldBlockPrompt: true,
      nativeMarker: {
        transactionType: MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
        transactionId: transaction.id,
        attackMessageId: message.id,
        role: "application",
        targetKey,
      },
    });
    if (applied?.deferred === true) {
      const snapshot = applied.preApplication ?? preApplication;
      registerDeferredMitigation({
        transactionId: applicationId,
        attackMessageId: message.id,
        damageMessageId: rolled.damageMessage.id,
        sourceActorUuid: strike.actor?.uuid ?? null,
        sourceItemUuid: strike.item?.uuid ?? null,
        targetTokenUuid: trustedChild.tokenUuid,
        targetActorUuid: trustedChild.actorUuid,
        preApplication: snapshot,
        outcome,
        settle: async ({ applicationMessage, deferred }) => {
          const liveMessage = game.messages.get(message.id) ?? message;
          let liveTx = TransactionStore.get(liveMessage);
          if (!liveTx) return { settled: false };
          const liveChild = liveTx.targets?.find((candidate) => candidate.key === targetKey);
          if (liveChild?.state === "applied") return { alreadyApplied: true };
          const liveToken =
            (await PF2eAdapter.resolveToken(deferred.targetTokenUuid)) ?? token;
          const postApplication = PF2eAdapter.healthSnapshot(liveToken?.actor);
          if (!postApplication) {
            const failedTargets = liveTx.targets.map((candidate) =>
              candidate.key === targetKey
                ? { ...candidate, state: "review", reviewReason: "application-unverified" }
                : candidate,
            );
            await update(liveMessage, {
              targets: failedTargets,
              state: batchState(failedTargets),
            });
            return { settled: false };
          }
          noteLethalApplicationIfZeroHp({
            actor: liveToken.actor,
            token: liveToken.document ?? liveToken,
            transactionId: liveTx.id,
            causeType: "strike",
            postApplication,
            sourceActor: strike.actor,
            sourceToken: strike.token ?? null,
          });
          if (applicationMessage) {
            liveTx = await TransactionStore.linkMultiTargetMessage(liveMessage, applicationMessage, {
              role: "application",
              targetKey,
            });
            await applicationMessage.setFlag(MODULE_ID, "multiTargetApplicationProof", {
              transactionId: liveTx.id,
              attackMessageId: liveMessage.id,
              targetKey,
              targetTokenUuid: trustedChild.tokenUuid,
              targetActorUuid: trustedChild.actorUuid,
              preApplication: deferred.preApplication ?? snapshot,
              postApplication,
              processingUserId: liveTx.snapshot.processingUserId,
            });
          }
          try {
            emitDamageAppliedFromApplication({
              transactionId: liveTx.id,
              applicationMessage,
              damageMessage: game.messages.get(deferred.damageMessageId) ?? rolled.damageMessage,
              targetActorUuid: deferred.targetActorUuid,
              targetTokenUuid: deferred.targetTokenUuid,
              sourceActor: strike.actor,
              sourceItem: strike.item,
            });
          } catch (error) {
            logger.error(
              "damageApplied emission after native mitigation failed open",
              { transactionId: liveTx.id, targetKey, stage: "multi-target-mitigation" },
              error,
            );
          }
          const resourceLoss = resourceLossFromSnapshots(
            deferred.preApplication ?? snapshot,
            postApplication,
          );
          const settledTargets = liveTx.targets.map((candidate) =>
            candidate.key === targetKey
              ? {
                  ...candidate,
                  state: "applied",
                  preApplication: deferred.preApplication ?? snapshot,
                  postApplication,
                  appliedAmount: resourceLoss.totalApplied,
                  resourceLoss,
                  appliedSequence: Number(liveTx.revision ?? 0) + 1,
                  applicationMessageId: applicationMessage?.id ?? null,
                  undoEligible:
                    liveTx.snapshot.actorType === "npc" || Boolean(applicationMessage),
                  tokenUuid: trustedChild.tokenUuid,
                  actorUuid: trustedChild.actorUuid,
                  sceneId: trustedChild.sceneId,
                  reviewReason: null,
                  mitigationPending: null,
                }
              : candidate,
          );
          const settled = await update(liveMessage, {
            targets: settledTargets,
            state: batchState(settledTargets),
          });
          if (settled.stackRef?.id) {
            NativeRecordsController.markStackRendered(
              game.messages.get(settled.stackRef.id)?.getFlag?.(MODULE_ID, "stack"),
            );
          }
          return { settled: true };
        },
        onAbandoned: async ({ reason }) => {
          const liveMessage = game.messages.get(message.id) ?? message;
          const liveTx = TransactionStore.get(liveMessage);
          if (!liveTx) return;
          const liveChild = liveTx.targets?.find((candidate) => candidate.key === targetKey);
          if (!liveChild || liveChild.state === "applied") return;
          if (liveChild.state !== "awaiting-mitigation") return;
          const reviewed = liveTx.targets.map((candidate) =>
            candidate.key === targetKey
              ? {
                  ...candidate,
                  state: "review",
                  reviewReason: reason ?? "mitigation-unresolved",
                  mitigationPending: null,
                }
              : candidate,
          );
          const next = await update(liveMessage, {
            targets: reviewed,
            state: batchState(reviewed),
          });
          if (next.stackRef?.id) {
            NativeRecordsController.failOpen(next.stackRef.id);
          }
        },
      });
      targets = transaction.targets.map((candidate) =>
        candidate.key === targetKey
          ? {
              ...candidate,
              state: "awaiting-mitigation",
              preApplication: snapshot,
              mitigationPending: "shield-block",
              reviewReason: null,
            }
          : candidate,
      );
      transaction = await update(message, { targets, state: batchState(targets) });
      if (transaction.stackRef?.id) {
        NativeRecordsController.failOpen(transaction.stackRef.id);
      }
      continue;
    }
    const postApplication = applied ? PF2eAdapter.healthSnapshot(token.actor) : null;
    if (!applied || !postApplication) {
      targets = transaction.targets.map((candidate) => candidate.key === child.key
        ? { ...candidate, state: "review", reviewReason: "application-unverified" }
        : candidate);
      transaction = await update(message, { targets, state: batchState(targets) });
      continue;
    }
    noteLethalApplicationIfZeroHp({
      actor: token.actor,
      token: token.document ?? token,
      transactionId: transaction.id,
      causeType: "strike",
      postApplication,
      sourceActor: strike.actor,
      sourceToken: strike.token ?? null,
    });
    if (applied.applicationMessage) {
      transaction = await TransactionStore.linkMultiTargetMessage(message, applied.applicationMessage, {
        role: "application",
        targetKey: child.key,
      });
      await applied.applicationMessage.setFlag(MODULE_ID, "multiTargetApplicationProof", {
        transactionId: transaction.id,
        attackMessageId: message.id,
        targetKey: child.key,
        targetTokenUuid: trustedChild.tokenUuid,
        targetActorUuid: trustedChild.actorUuid,
        preApplication,
        postApplication,
        processingUserId: transaction.snapshot.processingUserId,
      });
    }
    const resourceLoss = resourceLossFromSnapshots(preApplication, postApplication);
    targets = transaction.targets.map((candidate) => candidate.key === child.key
      ? {
          ...candidate,
          state: "applied",
          preApplication,
          postApplication,
          appliedAmount: resourceLoss.totalApplied,
          resourceLoss,
          appliedSequence: Number(transaction.revision ?? 0) + 1,
          applicationMessageId: applied.applicationMessage?.id ?? null,
          undoEligible: transaction.snapshot.actorType === "npc" || Boolean(applied.applicationMessage),
          tokenUuid: trustedChild.tokenUuid,
          actorUuid: trustedChild.actorUuid,
          sceneId: trustedChild.sceneId,
          reviewReason: null,
        }
      : candidate);
    transaction = await update(message, { targets, state: batchState(targets) });
  }
  return transaction;
}

export class MultiTargetStrikeService {
  static async handleCreatedMessage(message) {
    const capture = message.getFlag?.(MODULE_ID, MULTI_TARGET_CAPTURE_FLAG);
    if (!capture || !validCapture(capture) || !getSetting(SETTINGS.ENABLED)) return false;
    if (!game.user?.isGM || authorityFor(message) !== game.user.id || inFlight.has(message.id)) return false;
    const existing = TransactionStore.get(message);
    if (existing?.transactionType === MULTI_TARGET_STRIKE_TRANSACTION_TYPE && existing.role === "attack") return false;
    const strike = PF2eAdapter.inspectSupportedStrikeMessage(message);
    const author = game.users?.get(authorId(message));
    const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const authorEligible = Boolean(
      author?.active &&
      (strike?.actorType === "npc"
        ? author.isGM
        : strike?.actorType === "character" && strike.actor?.testUserPermission?.(author, ownerLevel)),
    );
    if (
      !strike ||
      !authorEligible ||
      capture.authorUserId !== authorId(message) ||
      !multiTargetModeAllows(getSetting(SETTINGS.SHARED_ROLL_MULTI_TARGET_STRIKES), strike.actorType)
    ) return false;
    const primaryCaptured = capture.targets.some(
      (target) => target.tokenUuid === strike.targetTokenUuid && target.actorUuid === strike.targetActorUuid,
    );
    if (!primaryCaptured) return false;
    inFlight.add(message.id);
    try {
      let transaction = await TransactionStore.claimMultiTargetStrike(
        message,
        makeMultiTargetSnapshot(message, strike, capture, authorId(message)),
        capture.targets,
      );
      if (!transaction) return false;
      await syncPresentation(message, transaction);
      if (!authorTargetSetMatches(author, capture)) {
        const targets = transaction.targets.map((child) => ({
          ...child,
          state: "review",
          reviewReason: "target-set-unverified",
        }));
        await update(message, { targets, state: batchState(targets), activeOperation: null });
        return true;
      }
      const targets = await resolveMultiTargetChildren(capture, strike);
      transaction = await update(message, { targets, state: batchState(targets) });
      const groups = groupTargetOutcomes(targets);
      transaction = await processDamageGroup(message, strike, transaction, "normal", groups.normal);
      const currentCritical = transaction.targets.filter(
        (child) => groups.critical.some((candidate) => candidate.key === child.key) && targetIsHit(child),
      );
      transaction = await processDamageGroup(message, strike, transaction, "critical", currentCritical);
      transaction = await update(message, {
        state: batchState(transaction.targets),
        activeOperation: null,
      });
      return true;
    } catch (error) {
      logger.error("Multi-target Strike failed safely", {
        attackMessageId: message.id,
        stage: "batch-processing",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
      const current = TransactionStore.get(message);
      if (current?.transactionType === MULTI_TARGET_STRIKE_TRANSACTION_TYPE) {
        const targets = current.targets.map((child) => child.state === "applied" || child.state === "miss"
          ? child
          : { ...child, state: "review", reviewReason: "processing-interrupted" });
        await update(message, { targets, state: batchState(targets), activeOperation: null }).catch(() => undefined);
      }
      return false;
    } finally {
      inFlight.delete(message.id);
    }
  }

  static undoTarget(message, targetKey) {
    return undoMultiTarget(message, targetKey, update);
  }

  static undoAll(message) {
    return undoAllMultiTarget(message, update);
  }

  static async reconcileExisting() {
    if (!game.user?.isGM) return;
    for (const message of game.messages ?? []) {
      const transaction = TransactionStore.get(message);
      if (
        transaction?.role !== "attack" ||
        transaction.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE ||
        transaction.activeOperation?.ownerUserId !== game.user.id
      ) continue;
      const targets = transaction.targets.map((child) => ["resolving", "applying"].includes(child.state)
        ? { ...child, state: "review", reviewReason: "processing-interrupted" }
        : child);
      await update(message, { targets, state: batchState(targets), activeOperation: null });
    }
  }
}
