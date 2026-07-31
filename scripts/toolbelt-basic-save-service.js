import {
  BASIC_SAVE_WORKFLOW_MODES,
  MODULE_ID,
  SETTINGS,
  TOOLBELT_APPLICATION_MODES,
  TOOLBELT_TRANSACTION_SCHEMA_VERSION,
} from "./constants.js";
import { guardedHealthRestore } from "./guarded-health-restore.js";
import { logger } from "./logger.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getSetting } from "./settings.js";
import {
  allPrimarySavesResolved,
  createTargetRecord,
  eligibleTargetKeys,
  integrationId,
  outcomeMultiplier,
  targetResultChanged,
  TOOLBELT_TARGET_STATES,
} from "./toolbelt-basic-save-model.js";
import {
  electProcessingGm,
  ToolbeltTargetHelperAdapter,
} from "./toolbelt-target-helper-adapter.js";

const FLAG = "toolbeltBasicSave";
const mutationQueues = new Map();
const warned = new Set();

function shortId(value) {
  return typeof value === "string" ? value.slice(-8) : null;
}

function diagnostic(event, data = {}) {
  logger.debug(event, {
    damageMessageId: shortId(data.damageMessageId),
    integrationId: shortId(data.integrationId),
    targetKey: shortId(data.targetKey),
    reason: data.reason ?? null,
  });
}

function warningOnce(key, localization) {
  if (!game.user?.isGM || warned.has(key)) return;
  warned.add(key);
  ui.notifications.warn(localization, { localize: true });
}

function workflowEnabled() {
  return (
    getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT &&
    getSetting(SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION) !== TOOLBELT_APPLICATION_MODES.OFF
  );
}

function messageById(id) {
  return id ? game.messages?.get(id) ?? null : null;
}

function transaction(message) {
  const value = message?.getFlag?.(MODULE_ID, FLAG) ?? null;
  return value?.schemaVersion === TOOLBELT_TRANSACTION_SCHEMA_VERSION &&
    value.damageMessageId === message.id &&
    Array.isArray(value.targetOrder) &&
    value.targets &&
    typeof value.targets === "object"
    ? value
    : null;
}

function mechanicalFingerprint(draft) {
  const clone = foundry.utils.deepClone(draft);
  delete clone.revision;
  delete clone.updatedAt;
  return JSON.stringify(clone);
}

async function persist(message, draft) {
  draft.revision = Number(draft.revision ?? 0) + 1;
  draft.updatedAt = Date.now();
  await message.update({ [`flags.${MODULE_ID}.${FLAG}`]: draft });
  return draft;
}

function queue(messageId, operation) {
  const prior = mutationQueues.get(messageId) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  mutationQueues.set(messageId, current);
  return current.finally(() => {
    if (mutationQueues.get(messageId) === current) mutationQueues.delete(messageId);
  });
}

function createTransaction(message, normalized, processingUserId) {
  const id = integrationId(message.id);
  const base = {
    schemaVersion: TOOLBELT_TRANSACTION_SCHEMA_VERSION,
    integrationId: id,
    damageMessageId: message.id,
    sourceMessageId: null,
    sourceActorUuid: normalized.sourceActorUuid,
    sourceItemUuid: normalized.sourceItemUuid,
    sourceUserId: normalized.sourceUserId,
    processingUserId,
    toolbeltVersion: normalized.status.version,
    toolbeltSchemaFingerprint: normalized.schemaFingerprint,
    phase: "observing",
    targetOrder: normalized.targets.map((target) => target.toolbeltTargetKey),
    targets: {},
    rollIndex: normalized.rollIndex,
    saveType: normalized.saveType,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 0,
  };
  for (const target of normalized.targets) {
    base.targets[target.toolbeltTargetKey] = createTargetRecord(base, target);
    diagnostic("toolbelt-target-normalized", { integrationId: id, targetKey: target.toolbeltTargetKey });
    if (target.saveState !== "resolved") {
      diagnostic("toolbelt-target-pending", { integrationId: id, targetKey: target.toolbeltTargetKey });
    }
  }
  return base;
}

function updateProjection(draft, normalized) {
  draft.toolbeltSchemaFingerprint = normalized.schemaFingerprint;
  for (const target of normalized.targets) {
    const record = draft.targets[target.toolbeltTargetKey];
    if (!record) continue;
    if (
      [TOOLBELT_TARGET_STATES.APPLIED, TOOLBELT_TARGET_STATES.NO_DAMAGE].includes(record.state) &&
      targetResultChanged(record, target)
    ) {
      record.state = TOOLBELT_TARGET_STATES.RESULT_CHANGED;
      record.reason = "toolbelt-result-changed-after-application";
      diagnostic("toolbelt-result-changed", {
        integrationId: draft.integrationId,
        targetKey: record.toolbeltTargetKey,
      });
      continue;
    }
    if (target.toolbeltAppliedState && ![TOOLBELT_TARGET_STATES.APPLIED, TOOLBELT_TARGET_STATES.UNDONE].includes(record.state)) {
      record.state = TOOLBELT_TARGET_STATES.EXTERNAL;
      record.reason = "toolbelt-applied-marker";
      continue;
    }
    if (record.state === TOOLBELT_TARGET_STATES.PENDING_SAVE && target.saveState === "resolved") {
      record.state = TOOLBELT_TARGET_STATES.READY;
      record.nativeOutcome = target.degreeOfSuccess;
      record.effectiveOutcome = target.degreeOfSuccess;
      record.multiplier = outcomeMultiplier(target.degreeOfSuccess);
      record.toolbeltStateFingerprint = target.saveFingerprint;
      diagnostic("toolbelt-target-ready", {
        integrationId: draft.integrationId,
        targetKey: record.toolbeltTargetKey,
      });
    } else if (record.state === TOOLBELT_TARGET_STATES.READY && target.saveState === "resolved") {
      record.nativeOutcome = target.degreeOfSuccess;
      record.effectiveOutcome = target.degreeOfSuccess;
      record.multiplier = outcomeMultiplier(target.degreeOfSuccess);
      record.toolbeltStateFingerprint = target.saveFingerprint;
    }
  }
}

function currentUserOwns(draft) {
  return game.user?.isGM && game.user.id === draft.processingUserId;
}

function processingGmStillActive(draft) {
  return game.users?.get(draft.processingUserId)?.active === true;
}

async function markInterrupted(message, draft, reason) {
  for (const record of Object.values(draft.targets)) {
    if ([TOOLBELT_TARGET_STATES.CLAIMED, TOOLBELT_TARGET_STATES.APPLYING].includes(record.state)) {
      record.state = TOOLBELT_TARGET_STATES.INTERRUPTED;
      record.reason = reason;
    }
  }
  draft.phase = "interrupted";
  await persist(message, draft);
  diagnostic("toolbelt-application-interrupted", {
    damageMessageId: message.id,
    integrationId: draft.integrationId,
    reason,
  });
}

function applicableKeys(draft, normalized, mode, confirmed) {
  const requested = confirmed
    ? normalized.targets.filter((target) => target.saveState === "resolved").map((target) => target.toolbeltTargetKey)
    : eligibleTargetKeys(normalized.targets, mode);
  return requested.filter((key) => draft.targets[key]?.state === TOOLBELT_TARGET_STATES.READY);
}

async function applyOne(message, draft, targetKey) {
  let normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
  if (!normalized.ok) {
    diagnostic("toolbelt-message-ineligible", { damageMessageId: message.id, reason: normalized.reason });
    const record = draft.targets[targetKey];
    record.state = TOOLBELT_TARGET_STATES.MANUAL;
    record.reason = normalized.reason;
    await persist(message, draft);
    return;
  }
  const target = normalized.targets.find((entry) => entry.toolbeltTargetKey === targetKey);
  const record = draft.targets[targetKey];
  if (!target || target.saveState !== "resolved" || target.saveFingerprint !== record.toolbeltStateFingerprint) {
    record.state = TOOLBELT_TARGET_STATES.READY;
    record.reason = "stale-toolbelt-save-state";
    if (target?.saveState === "resolved") {
      record.nativeOutcome = target.degreeOfSuccess;
      record.effectiveOutcome = target.degreeOfSuccess;
      record.multiplier = outcomeMultiplier(target.degreeOfSuccess);
      record.toolbeltStateFingerprint = target.saveFingerprint;
    }
    await persist(message, draft);
    return;
  }
  if (target.toolbeltAppliedState) {
    record.state = TOOLBELT_TARGET_STATES.EXTERNAL;
    record.reason = "toolbelt-applied-before-claim";
    await persist(message, draft);
    diagnostic("toolbelt-external-application-detected", { integrationId: draft.integrationId, targetKey });
    return;
  }
  if (normalized.persistent) {
    record.state = TOOLBELT_TARGET_STATES.MANUAL;
    record.reason = "persistent-damage-unsupported";
    await persist(message, draft);
    diagnostic("toolbelt-application-manual", { integrationId: draft.integrationId, targetKey, reason: record.reason });
    return;
  }

  record.state = TOOLBELT_TARGET_STATES.CLAIMED;
  record.reason = null;
  await persist(message, draft);
  diagnostic("toolbelt-application-claimed", { integrationId: draft.integrationId, targetKey });

  normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(messageById(message.id) ?? message);
  const latest = normalized.ok
    ? normalized.targets.find((entry) => entry.toolbeltTargetKey === targetKey)
    : null;
  if (!latest || latest.toolbeltAppliedState || latest.saveFingerprint !== record.toolbeltStateFingerprint) {
    record.state = latest?.toolbeltAppliedState
      ? TOOLBELT_TARGET_STATES.EXTERNAL
      : TOOLBELT_TARGET_STATES.MANUAL;
    record.reason = latest?.toolbeltAppliedState ? "toolbelt-applied-after-claim" : "toolbelt-state-changed-after-claim";
    await persist(message, draft);
    return;
  }

  if (record.multiplier === 0) {
    record.state = TOOLBELT_TARGET_STATES.NO_DAMAGE;
    await persist(message, draft);
    return;
  }

  record.state = TOOLBELT_TARGET_STATES.APPLYING;
  await persist(message, draft);
  diagnostic("toolbelt-application-started", { integrationId: draft.integrationId, targetKey });

  try {
    const targetToken = await PF2eAdapter.resolveToken(record.tokenUuid);
    const sourceActor = message.actor;
    const sourceItem = message.item;
    if (!targetToken?.actor || targetToken.actor.uuid !== record.actorUuid || !sourceActor || !sourceItem) {
      record.state = TOOLBELT_TARGET_STATES.MANUAL;
      record.reason = "exact-document-unavailable";
      await persist(message, draft);
      return;
    }
    const before = PF2eAdapter.healthSnapshot(targetToken.actor);
    if (!before) {
      record.state = TOOLBELT_TARGET_STATES.MANUAL;
      record.reason = "health-snapshot-unavailable";
      await persist(message, draft);
      return;
    }
    const damageRoll = message.rolls?.at(draft.rollIndex);
    const result = await PF2eAdapter.applyDamageRollToRecordedTarget({
      damageMessage: message,
      damageRoll,
      sourceActor,
      sourceItem,
      targetToken,
      expectedTargetActorUuid: record.actorUuid,
      multiplier: record.multiplier,
      outcome: record.effectiveOutcome,
      applicationId: record.applicationId,
      nativeMarker: {
        integrationId: draft.integrationId,
        damageMessageId: message.id,
        targetKey,
        role: "toolbelt-application",
      },
    });
    const after = result ? PF2eAdapter.healthSnapshot(targetToken.actor) : null;
    if (!result || !after) {
      record.state = TOOLBELT_TARGET_STATES.ERROR;
      record.reason = "native-application-failed";
      await persist(message, draft);
      return;
    }
    record.preApplicationHp = before.hp;
    record.preApplicationTempHp = before.tempHp;
    record.postApplicationHp = after.hp;
    record.postApplicationTempHp = after.tempHp;
    record.actualHpDelta = before.hp + before.tempHp - after.hp - after.tempHp;
    record.applicationMessageId = result.applicationMessage?.id ?? null;
    record.state = TOOLBELT_TARGET_STATES.APPLIED;
    record.undoState = "available";
    await persist(message, draft);
    diagnostic("toolbelt-application-complete", { integrationId: draft.integrationId, targetKey });
  } catch (error) {
    record.state = TOOLBELT_TARGET_STATES.ERROR;
    record.reason = error instanceof Error ? error.message : String(error);
    await persist(message, draft);
    logger.error("Toolbelt target application failed", {
      stage: "toolbelt-application",
      targetActorUuid: record.actorUuid,
      reason: record.reason,
    }, error);
  }
}

async function process(message, draft, normalized, { confirmed = false } = {}) {
  if (!currentUserOwns(draft)) return;
  if (!processingGmStillActive(draft)) return markInterrupted(message, draft, "processing-gm-inactive");
  const mode = getSetting(SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION);
  const keys = applicableKeys(draft, normalized, mode, confirmed);
  if (!keys.length) return;
  draft.phase = "applying";
  await persist(message, draft);
  for (const key of keys) {
    if (!processingGmStillActive(draft)) {
      await markInterrupted(message, draft, "processing-gm-inactive");
      return;
    }
    await applyOne(messageById(message.id) ?? message, draft, key);
  }
  const states = Object.values(draft.targets).map((target) => target.state);
  draft.phase = states.every((state) => [
    TOOLBELT_TARGET_STATES.APPLIED,
    TOOLBELT_TARGET_STATES.NO_DAMAGE,
    TOOLBELT_TARGET_STATES.EXTERNAL,
    TOOLBELT_TARGET_STATES.MANUAL,
    TOOLBELT_TARGET_STATES.ERROR,
    TOOLBELT_TARGET_STATES.RESULT_CHANGED,
  ].includes(state)) ? "complete" : "observing";
  await persist(message, draft);
  diagnostic("toolbelt-integration-complete", { damageMessageId: message.id, integrationId: draft.integrationId });
}

async function observe(message, { confirmed = false } = {}) {
  if (!workflowEnabled()) return;
  const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
  if (!normalized.ok) {
    if (normalized.reason === "toolbelt-inactive") warningOnce(normalized.reason, "Nelflow.Notification.ToolbeltInactive");
    if (normalized.reason === "target-helper-disabled") warningOnce(normalized.reason, "Nelflow.Notification.TargetHelperDisabled");
    if (normalized.reason === "toolbelt-version-unsupported") warningOnce(normalized.reason, "Nelflow.Notification.ToolbeltUnsupported");
    return;
  }
  diagnostic("toolbelt-damage-observed", { damageMessageId: message.id });
  const processingUserId = electProcessingGm(game.users ?? [], normalized.sourceUserId);
  if (!processingUserId) return;

  const persistedFlag = message.getFlag?.(MODULE_ID, FLAG);
  let draft = transaction(message);
  let persistedNew = false;
  if (persistedFlag && !draft) {
    diagnostic("toolbelt-message-ineligible", {
      damageMessageId: message.id,
      reason: "unsupported-nelflow-transaction-schema",
    });
    return;
  }
  if (!draft) {
    if (game.user.id !== processingUserId) return;
    draft = createTransaction(message, normalized, processingUserId);
    await persist(message, draft); // Persistent authority claim precedes mechanics.
    persistedNew = true;
  }
  if (!currentUserOwns(draft)) return;
  if (draft.phase === "applying") {
    await markInterrupted(message, draft, "reload-or-unobserved-application");
    return;
  }
  const beforeProjection = mechanicalFingerprint(draft);
  updateProjection(draft, normalized);
  if (!persistedNew && mechanicalFingerprint(draft) !== beforeProjection) {
    await persist(message, draft);
  }
  if (allPrimarySavesResolved(normalized.targets)) {
    diagnostic("toolbelt-all-saves-ready", { integrationId: draft.integrationId });
  }
  await process(messageById(message.id) ?? message, draft, normalized, { confirmed });
}

export class ToolbeltBasicSaveService {
  static initialize() {
    const status = ToolbeltTargetHelperAdapter.status();
    diagnostic("toolbelt-detected", { reason: status.active ? status.version : "inactive" });
    if (status.active) diagnostic(status.supported ? "toolbelt-version-supported" : "toolbelt-version-unsupported");
    diagnostic(status.enabled ? "target-helper-enabled" : "target-helper-disabled");
    if (getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT) {
      if (!status.active) warningOnce("toolbelt-inactive", "Nelflow.Notification.ToolbeltInactive");
      else if (!status.enabled) warningOnce("target-helper-disabled", "Nelflow.Notification.TargetHelperDisabled");
      else if (!status.supported) warningOnce("toolbelt-version-unsupported", "Nelflow.Notification.ToolbeltUnsupported");
    }
    for (const message of game.messages ?? []) {
      const draft = transaction(message);
      if (!draft || draft.phase !== "applying" || !currentUserOwns(draft)) continue;
      void queue(message.id, () => markInterrupted(message, draft, "reload-during-application")).catch((error) => {
        logger.error("Toolbelt interrupted-state persistence failed", {
          stage: "toolbelt-reload",
          reason: error instanceof Error ? error.message : String(error),
        }, error);
      });
    }
  }

  static handleMessage(message) {
    return queue(message.id, () => observe(message));
  }

  static confirm(messageId) {
    const message = messageById(messageId);
    if (!message) return Promise.resolve();
    return queue(message.id, () => observe(message, { confirmed: true }));
  }

  static async undo(messageId, targetKey) {
    const message = messageById(messageId);
    if (!message) return;
    return queue(message.id, async () => {
      const draft = transaction(message);
      const record = draft?.targets?.[targetKey];
      const undoableState =
        record?.state === TOOLBELT_TARGET_STATES.APPLIED ||
        (record?.state === TOOLBELT_TARGET_STATES.RESULT_CHANGED && Number.isFinite(record.preApplicationHp));
      if (!draft || !record || !currentUserOwns(draft) || !undoableState) return;
      const restored = await guardedHealthRestore({
        resolveToken: (uuid) => PF2eAdapter.resolveToken(uuid),
        healthSnapshot: (actor) => PF2eAdapter.healthSnapshot(actor),
        restoreHealth: (actor, snapshot) => PF2eAdapter.restoreHealth(actor, snapshot),
        targetTokenUuid: record.tokenUuid,
        targetActorUuid: record.actorUuid,
        preApplication: { hp: record.preApplicationHp, tempHp: record.preApplicationTempHp },
        postApplication: { hp: record.postApplicationHp, tempHp: record.postApplicationTempHp },
      });
      if (!restored.ok) {
        record.state = TOOLBELT_TARGET_STATES.UNDO_BLOCKED;
        record.undoState = "blocked";
        record.reason = restored.reason;
      } else {
        record.state = TOOLBELT_TARGET_STATES.UNDONE;
        record.undoState = "used";
      }
      await persist(message, draft);
    });
  }
}

export { FLAG as TOOLBELT_BASIC_SAVE_FLAG };
