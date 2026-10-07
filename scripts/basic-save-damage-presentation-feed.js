/**
 * Presentation-neutral per-target basic-save damage feed (protocol 3).
 *
 * Stages:
 * - targetDamageApplying — ownership reservation immediately before PF2e applyDamage
 * - targetDamageApplied — authoritative actual HP/temp-HP loss after application
 *
 * Never calculates IWR, applies HP, rolls damage, or mutates Toolbelt.
 * Hooks.callAll is intentionally GM-local.
 */

import { logger } from "./logger.js";
import { buildBasicSaveTargetResultId } from "./basic-save-presentation-identity.js";

export const BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK =
  "nelflow.basicSaveTargetDamageApplyingPresentation";
export const BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK =
  "nelflow.basicSaveTargetDamageAppliedPresentation";
export const BASIC_SAVE_DAMAGE_APPLIED_SOURCE = "transaction-before-after";
export const BASIC_SAVE_DAMAGE_TEMP_HP_AWARE = true;

const LOG_PREFIX = "NelFlow | Basic save damage presentation feed |";

/** Dedicated applying registry; never shared with applied / save-result / HP / Undo. */
const applyingPresentationEmittedByDamageResultId = new Map();

/** Dedicated applied registry; never shared with applying / save-result / HP / Undo. */
const damagePresentationEmittedByDamageResultId = new Map();

/** @type {((summary: object) => void)|null} */
let damageFeedWatcher = null;

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Observe actual target resource loss after PF2e's authoritative application.
 * Temporary HP and Stamina (when snapshotted) are included so pool absorption
 * is not reported as 0.
 */
export function deriveActualBasicSaveHpLoss(args = {}) {
  const beforeHp = finiteNumber(args.beforeHp);
  const beforeTempHp = finiteNumber(args.beforeTempHp);
  const afterHp = finiteNumber(args.afterHp);
  const afterTempHp = finiteNumber(args.afterTempHp);
  if ([beforeHp, beforeTempHp, afterHp, afterTempHp].some((value) => value == null)) {
    return null;
  }
  const beforeStamina = finiteNumber(args.beforeStamina);
  const afterStamina = finiteNumber(args.afterStamina);
  const staminaLoss =
    beforeStamina != null && afterStamina != null
      ? Math.max(0, beforeStamina - afterStamina)
      : 0;
  return Math.max(0, beforeHp + beforeTempHp - afterHp - afterTempHp + staminaLoss);
}

/**
 * One damage result belongs to one exact application target and final save fingerprint.
 * Shared by applying + applied stages.
 */
export function buildBasicSaveTargetDamageResultId(args = {}) {
  const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
  const appId = safeString(args.applicationId);
  if (!targetResultId || !appId) return null;
  return `${targetResultId}:damage:${appId}`;
}

export function hasBasicSaveTargetDamageApplyingPresentationEmission(damageResultId) {
  return Boolean(damageResultId && applyingPresentationEmittedByDamageResultId.has(damageResultId));
}

export function hasBasicSaveTargetDamagePresentationEmission(damageResultId) {
  return Boolean(damageResultId && damagePresentationEmittedByDamageResultId.has(damageResultId));
}

export function evaluateBasicSaveTargetDamageApplyingPresentationEligibility(ctx = {}) {
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (!ctx.damageResultId) return { eligible: false, reason: "missing-damage-result-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  if (ctx.isBasicSave !== true) return { eligible: false, reason: "not-basic-save" };
  if (ctx.private === true) return { eligible: false, reason: "private-save" };
  if (!ctx.targetTokenUuid) return { eligible: false, reason: "missing-target-token" };
  if (!ctx.degreeOfSuccess) return { eligible: false, reason: "missing-degree" };
  if (!ctx.saveType) return { eligible: false, reason: "missing-save-type" };
  return { eligible: true };
}

export function evaluateBasicSaveTargetDamagePresentationEligibility(ctx = {}) {
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (!ctx.damageResultId) return { eligible: false, reason: "missing-damage-result-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  if (ctx.isBasicSave !== true) return { eligible: false, reason: "not-basic-save" };
  if (ctx.private === true) return { eligible: false, reason: "private-save" };
  if (!ctx.targetTokenUuid) return { eligible: false, reason: "missing-target-token" };
  if (!ctx.degreeOfSuccess) return { eligible: false, reason: "missing-degree" };
  if (!ctx.saveType) return { eligible: false, reason: "missing-save-type" };
  if (!Number.isFinite(ctx.applied) || ctx.applied < 0) {
    return { eligible: false, reason: "missing-authoritative-applied-damage" };
  }
  return { eligible: true };
}

function appendOptionalStrings(payload, args) {
  const optionalStrings = [
    ["sceneId", args.sceneId],
    ["sourceTokenUuid", args.sourceTokenUuid],
    ["sourceActorUuid", args.sourceActorUuid],
    ["targetActorUuid", args.targetActorUuid],
    ["actionName", args.actionName],
    ["itemUuid", args.itemUuid],
  ];
  for (const [key, value] of optionalStrings) {
    const normalized = safeString(value);
    if (normalized) payload[key] = normalized;
  }
}

/** Build the plain JSON ownership-reservation payload (no damage.applied). */
export function buildBasicSaveTargetDamageApplyingPresentationPayload(args = {}) {
  const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
  const damageResultId =
    safeString(args.damageResultId) ??
    buildBasicSaveTargetDamageResultId({ ...args, targetResultId });
  if (!targetResultId) return { ok: false, reason: "missing-target-result-id" };
  if (!damageResultId) return { ok: false, reason: "missing-damage-result-id" };
  if (!safeString(args.targetTokenUuid)) return { ok: false, reason: "missing-target-token" };
  if (!safeString(args.degreeOfSuccess)) return { ok: false, reason: "missing-degree" };
  if (!safeString(args.saveType)) return { ok: false, reason: "missing-save-type" };

  const payload = {
    schemaVersion: 1,
    stage: "targetDamageApplying",
    batchId: safeString(args.batchId ?? args.integrationId),
    targetResultId,
    damageResultId,
    targetTokenUuid: safeString(args.targetTokenUuid),
    save: {
      type: safeString(args.saveType),
      basic: true,
      degreeOfSuccess: safeString(args.degreeOfSuccess),
    },
    createdAt: Number.isFinite(args.createdAt) ? Number(args.createdAt) : Date.now(),
  };
  appendOptionalStrings(payload, args);

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
}

/** Build the plain JSON Stage applied payload. */
export function buildBasicSaveTargetDamagePresentationPayload(args = {}) {
  const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
  const damageResultId =
    safeString(args.damageResultId) ??
    buildBasicSaveTargetDamageResultId({ ...args, targetResultId });
  const applied = finiteNumber(args.applied);
  if (!targetResultId) return { ok: false, reason: "missing-target-result-id" };
  if (!damageResultId) return { ok: false, reason: "missing-damage-result-id" };
  if (!safeString(args.targetTokenUuid)) return { ok: false, reason: "missing-target-token" };
  if (!safeString(args.degreeOfSuccess)) return { ok: false, reason: "missing-degree" };
  if (!safeString(args.saveType)) return { ok: false, reason: "missing-save-type" };
  if (applied == null || applied < 0) {
    return { ok: false, reason: "missing-authoritative-applied-damage" };
  }

  const damage = { applied };
  const baseRollTotal = finiteNumber(args.baseRollTotal);
  const degreeAdjustedAmount = finiteNumber(args.degreeAdjustedAmount);
  if (baseRollTotal != null) damage.baseRollTotal = baseRollTotal;
  if (degreeAdjustedAmount != null) damage.degreeAdjustedAmount = degreeAdjustedAmount;
  const resourceLoss = (() => {
    const raw = args.resourceLoss;
    if (!raw || typeof raw !== "object") return null;
    const hp = finiteNumber(raw.hp ?? raw.hpLoss);
    const tempHp = finiteNumber(raw.tempHp ?? raw.tempHpLoss);
    const stamina = finiteNumber(raw.stamina ?? raw.staminaLoss);
    if ([hp, tempHp, stamina].some((value) => value == null || value < 0)) return null;
    return { hp, tempHp, stamina, total: hp + tempHp + stamina };
  })();
  if (resourceLoss) damage.resourceLoss = resourceLoss;

  const payload = {
    schemaVersion: 1,
    stage: "targetDamageApplied",
    batchId: safeString(args.batchId ?? args.integrationId),
    targetResultId,
    damageResultId,
    targetTokenUuid: safeString(args.targetTokenUuid),
    save: {
      type: safeString(args.saveType),
      basic: true,
      degreeOfSuccess: safeString(args.degreeOfSuccess),
    },
    damage,
    createdAt: Number.isFinite(args.createdAt) ? Number(args.createdAt) : Date.now(),
  };
  if (resourceLoss) payload.resourceLoss = resourceLoss;
  appendOptionalStrings(payload, args);

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
}

function resolveHooksCallAll(args) {
  return (
    args.hooksCallAll ??
    (typeof globalThis.Hooks?.callAll === "function" ? Hooks.callAll.bind(Hooks) : null)
  );
}

/** Emit exactly once per real PF2e application ownership reservation. */
export function tryEmitBasicSaveTargetDamageApplyingPresentation(args = {}) {
  try {
    const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
    const damageResultId = buildBasicSaveTargetDamageResultId({ ...args, targetResultId });
    const gate = evaluateBasicSaveTargetDamageApplyingPresentationEligibility({
      isGM: globalThis.game?.user?.isGM === true,
      damageResultId,
      alreadyEmitted: hasBasicSaveTargetDamageApplyingPresentationEmission(damageResultId),
      isBasicSave: args.isBasicSave !== false,
      private: args.private === true,
      targetTokenUuid: args.targetTokenUuid,
      degreeOfSuccess: args.degreeOfSuccess,
      saveType: args.saveType,
    });
    if (!gate.eligible) {
      return { emitted: false, reason: gate.reason, damageResultId: damageResultId ?? undefined };
    }

    const built = buildBasicSaveTargetDamageApplyingPresentationPayload({
      ...args,
      targetResultId,
      damageResultId,
    });
    if (!built.ok) return { emitted: false, reason: built.reason, damageResultId };

    const callAll = resolveHooksCallAll(args);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable", damageResultId };
    }
    rememberApplyingEmission(damageResultId);
    try {
      callAll(BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK, built.payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Applying listener failed`, {
        stage: "basic-save-damage-applying-presentation-feed",
        damageResultId,
        reason: error instanceof Error ? error.message : String(error),
      });
      notifyDamageWatcher(built.payload);
      return {
        emitted: true,
        reason: "listener-failed",
        hook: BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
        damageResultId,
      };
    }
    notifyDamageWatcher(built.payload);
    return {
      emitted: true,
      hook: BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
      damageResultId,
    };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Applying unexpected failure`, {
      stage: "basic-save-damage-applying-presentation-feed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/** Emit exactly once per authoritative target damage result. */
export function tryEmitBasicSaveTargetDamagePresentation(args = {}) {
  try {
    const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
    const damageResultId = buildBasicSaveTargetDamageResultId({ ...args, targetResultId });
    const applied = finiteNumber(args.applied);
    const gate = evaluateBasicSaveTargetDamagePresentationEligibility({
      isGM: globalThis.game?.user?.isGM === true,
      damageResultId,
      alreadyEmitted: hasBasicSaveTargetDamagePresentationEmission(damageResultId),
      isBasicSave: args.isBasicSave !== false,
      private: args.private === true,
      targetTokenUuid: args.targetTokenUuid,
      degreeOfSuccess: args.degreeOfSuccess,
      saveType: args.saveType,
      applied,
    });
    if (!gate.eligible) {
      return { emitted: false, reason: gate.reason, damageResultId: damageResultId ?? undefined };
    }

    const built = buildBasicSaveTargetDamagePresentationPayload({
      ...args,
      targetResultId,
      damageResultId,
      applied,
    });
    if (!built.ok) return { emitted: false, reason: built.reason, damageResultId };

    const callAll = resolveHooksCallAll(args);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable", damageResultId };
    }
    rememberDamageEmission(damageResultId);
    try {
      callAll(BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK, built.payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Listener failed`, {
        stage: "basic-save-damage-presentation-feed",
        damageResultId,
        reason: error instanceof Error ? error.message : String(error),
      });
      notifyDamageWatcher(built.payload);
      return {
        emitted: true,
        reason: "listener-failed",
        hook: BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
        damageResultId,
      };
    }
    notifyDamageWatcher(built.payload);
    return {
      emitted: true,
      hook: BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
      damageResultId,
    };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected failure`, {
      stage: "basic-save-damage-presentation-feed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

function projectionIds({ draft, record, target }) {
  const targetResultId = buildBasicSaveTargetResultId({
    integrationId: draft?.integrationId,
    applicationId: record?.applicationId,
    toolbeltTargetKey: target?.toolbeltTargetKey ?? record?.toolbeltTargetKey,
    saveFingerprint: target?.saveFingerprint ?? record?.toolbeltStateFingerprint,
  });
  return {
    targetResultId,
    damageResultId: buildBasicSaveTargetDamageResultId({
      applicationId: record?.applicationId,
      targetResultId,
    }),
  };
}

/**
 * Ownership reservation for one real PF2e application. Not used for conclusive
 * critical-success no-damage paths that never call applyDamage.
 */
export function emitBasicSaveTargetDamageApplyingPresentationFromApplication({
  draft,
  record,
  target,
  normalized,
} = {}) {
  const { targetResultId } = projectionIds({ draft, record, target });
  return tryEmitBasicSaveTargetDamageApplyingPresentation({
    integrationId: draft?.integrationId,
    batchId: draft?.integrationId,
    applicationId: record?.applicationId,
    targetResultId,
    sceneId: target?.sceneId ?? record?.sceneId,
    sourceActorUuid: draft?.sourceActorUuid ?? normalized?.sourceActorUuid,
    sourceTokenUuid: null,
    targetTokenUuid: target?.tokenUuid ?? record?.tokenUuid,
    targetActorUuid: target?.actorUuid ?? record?.actorUuid,
    actionName: draft?.sourceActionSlug,
    itemUuid: draft?.sourceItemUuid ?? normalized?.sourceItemUuid,
    saveType: target?.saveType ?? record?.saveType ?? draft?.saveType,
    isBasicSave: target?.isBasicSave !== false,
    private: target?.private === true,
    degreeOfSuccess: target?.degreeOfSuccess ?? record?.effectiveOutcome,
  });
}

/**
 * Project one terminal Toolbelt target. Positive applications derive from the
 * durable normal+temp HP snapshots; critical-success no-damage uses the existing
 * conclusive zero transition and creates no mechanics operation / applying event.
 */
export function emitBasicSaveTargetDamagePresentationFromApplication({
  draft,
  record,
  target,
  normalized,
  damageRoll = null,
  transformedRoll = null,
  conclusiveZero = false,
} = {}) {
  const { targetResultId } = projectionIds({ draft, record, target });
  const applied = conclusiveZero
    ? 0
    : deriveActualBasicSaveHpLoss({
        beforeHp: record?.preApplicationHp,
        beforeTempHp: record?.preApplicationTempHp,
        beforeStamina: record?.preApplicationStamina,
        afterHp: record?.postApplicationHp,
        afterTempHp: record?.postApplicationTempHp,
        afterStamina: record?.postApplicationStamina,
      });
  const resourceLoss =
    applied == null
      ? null
      : conclusiveZero
        ? { hp: 0, tempHp: 0, stamina: 0, total: 0 }
        : {
            hp: Math.max(
              0,
              Number(record?.preApplicationHp) - Number(record?.postApplicationHp),
            ) || 0,
            tempHp: Math.max(
              0,
              Number(record?.preApplicationTempHp ?? 0) - Number(record?.postApplicationTempHp ?? 0),
            ),
            stamina: Math.max(
              0,
              Number(record?.preApplicationStamina ?? 0) - Number(record?.postApplicationStamina ?? 0),
            ),
            total: applied,
          };

  return tryEmitBasicSaveTargetDamagePresentation({
    integrationId: draft?.integrationId,
    batchId: draft?.integrationId,
    applicationId: record?.applicationId,
    targetResultId,
    sceneId: target?.sceneId ?? record?.sceneId,
    sourceActorUuid: draft?.sourceActorUuid ?? normalized?.sourceActorUuid,
    sourceTokenUuid: null,
    targetTokenUuid: target?.tokenUuid ?? record?.tokenUuid,
    targetActorUuid: target?.actorUuid ?? record?.actorUuid,
    actionName: draft?.sourceActionSlug,
    itemUuid: draft?.sourceItemUuid ?? normalized?.sourceItemUuid,
    saveType: target?.saveType ?? record?.saveType ?? draft?.saveType,
    isBasicSave: target?.isBasicSave !== false,
    private: target?.private === true,
    degreeOfSuccess: target?.degreeOfSuccess ?? record?.effectiveOutcome,
    applied,
    resourceLoss,
    baseRollTotal: finiteNumber(damageRoll?.total),
    degreeAdjustedAmount: finiteNumber(transformedRoll?.total),
  });
}

function rememberMap(map, damageResultId) {
  map.set(damageResultId, {
    damageResultId,
    emittedAt: Date.now(),
  });
}

function rememberApplyingEmission(damageResultId) {
  rememberMap(applyingPresentationEmittedByDamageResultId, damageResultId);
}

function rememberDamageEmission(damageResultId) {
  rememberMap(damagePresentationEmittedByDamageResultId, damageResultId);
}

function labelFromUuid(uuid) {
  if (!safeString(uuid)) return null;
  try {
    const doc = typeof globalThis.fromUuidSync === "function" ? fromUuidSync(uuid) : null;
    const name = doc?.name ?? doc?.actor?.name ?? null;
    return safeString(name);
  } catch {
    return null;
  }
}

function notifyDamageWatcher(payload) {
  if (typeof damageFeedWatcher !== "function") return;
  try {
    damageFeedWatcher({
      stage: payload.stage ?? null,
      batchId: payload.batchId ?? null,
      damageResultId: payload.damageResultId ?? null,
      targetLabel: labelFromUuid(payload.targetTokenUuid) ?? labelFromUuid(payload.targetActorUuid),
      degree: payload.save?.degreeOfSuccess ?? null,
      baseRollTotal: Number.isFinite(payload.damage?.baseRollTotal)
        ? payload.damage.baseRollTotal
        : null,
      applied: Number.isFinite(payload.damage?.applied) ? payload.damage.applied : null,
    });
  } catch {
    /* diagnostic watcher must never affect mechanics */
  }
}

export function watchBasicSaveDamagePresentationFeed() {
  if (globalThis.game?.user?.isGM !== true) return false;
  if (damageFeedWatcher) return true;
  damageFeedWatcher = (summary) => {
    if (summary.stage === "targetDamageApplying") {
      console.debug(
        [
          "BASIC SAVE TARGET DAMAGE APPLYING",
          `target: ${summary.targetLabel ?? "unavailable"}`,
          `damageResultId: ${summary.damageResultId ?? "unavailable"}`,
        ].join("\n"),
      );
      return;
    }
    console.debug(
      [
        "BASIC SAVE TARGET DAMAGE APPLIED",
        `batch: ${summary.batchId ?? "unavailable"}`,
        `target: ${summary.targetLabel ?? "unavailable"}`,
        `degree: ${summary.degree ?? "unavailable"}`,
        `base roll: ${Number.isFinite(summary.baseRollTotal) ? summary.baseRollTotal : "unavailable"}`,
        `applied: ${Number.isFinite(summary.applied) ? summary.applied : "unavailable"}`,
      ].join("\n"),
    );
  };
  return true;
}

export function stopWatchingBasicSaveDamagePresentationFeed() {
  const had = Boolean(damageFeedWatcher);
  damageFeedWatcher = null;
  return had;
}

export function getBasicSaveDamagePresentationStatus() {
  return {
    targetDamageApplyingHook: BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
    targetDamageAppliedHook: BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
    damageProducerAvailable: true,
    appliedDamageSource: BASIC_SAVE_DAMAGE_APPLIED_SOURCE,
    tempHpAware: BASIC_SAVE_DAMAGE_TEMP_HP_AWARE,
    emittedApplyingResults: applyingPresentationEmittedByDamageResultId.size,
    emittedDamageResults: damagePresentationEmittedByDamageResultId.size,
  };
}

/** Test helpers. */
export function clearBasicSaveDamagePresentationEmissions() {
  applyingPresentationEmittedByDamageResultId.clear();
  damagePresentationEmittedByDamageResultId.clear();
  damageFeedWatcher = null;
}

export function seedBasicSaveTargetDamageApplyingPresentationEmission(damageResultId) {
  if (damageResultId) rememberApplyingEmission(damageResultId);
}

export function seedBasicSaveTargetDamagePresentationEmission(damageResultId) {
  if (damageResultId) rememberDamageEmission(damageResultId);
}
