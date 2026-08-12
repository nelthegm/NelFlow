/**
 * Presentation-neutral per-target basic-save damage result feed (protocol 2).
 *
 * This module observes the durable before/after health snapshots produced by the
 * existing exact PF2e application. It never calculates IWR, applies HP, rolls
 * damage, or mutates Toolbelt. Hooks.callAll is intentionally GM-local.
 */

import { logger } from "./logger.js";
import { buildBasicSaveTargetResultId } from "./basic-save-presentation-identity.js";

export const BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK =
  "nelflow.basicSaveTargetDamageAppliedPresentation";
export const BASIC_SAVE_DAMAGE_APPLIED_SOURCE = "transaction-before-after";
export const BASIC_SAVE_DAMAGE_TEMP_HP_AWARE = true;

const LOG_PREFIX = "NelFlow | Basic save damage presentation feed |";

/** Dedicated to Stage 2; never shared with save-result, HP, Undo, or NelCine state. */
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
 * Temporary HP is deliberately included so temp-only damage is not reported as 0.
 */
export function deriveActualBasicSaveHpLoss(args = {}) {
  const beforeHp = finiteNumber(args.beforeHp);
  const beforeTempHp = finiteNumber(args.beforeTempHp);
  const afterHp = finiteNumber(args.afterHp);
  const afterTempHp = finiteNumber(args.afterTempHp);
  if ([beforeHp, beforeTempHp, afterHp, afterTempHp].some((value) => value == null)) {
    return null;
  }
  return Math.max(0, beforeHp + beforeTempHp - afterHp - afterTempHp);
}

/**
 * One damage result belongs to one exact application target and final save fingerprint.
 */
export function buildBasicSaveTargetDamageResultId(args = {}) {
  const targetResultId = safeString(args.targetResultId) ?? buildBasicSaveTargetResultId(args);
  const appId = safeString(args.applicationId);
  if (!targetResultId || !appId) return null;
  return `${targetResultId}:damage:${appId}`;
}

export function hasBasicSaveTargetDamagePresentationEmission(damageResultId) {
  return Boolean(damageResultId && damagePresentationEmittedByDamageResultId.has(damageResultId));
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

/** Build the plain JSON Stage 2 payload. */
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

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
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

    const callAll =
      args.hooksCallAll ??
      (typeof globalThis.Hooks?.callAll === "function" ? Hooks.callAll.bind(Hooks) : null);
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

/**
 * Project one terminal Toolbelt target. Positive applications derive from the
 * durable normal+temp HP snapshots; critical-success no-damage uses the existing
 * conclusive zero transition and creates no mechanics operation.
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
  const targetResultId = buildBasicSaveTargetResultId({
    integrationId: draft?.integrationId,
    applicationId: record?.applicationId,
    toolbeltTargetKey: target?.toolbeltTargetKey ?? record?.toolbeltTargetKey,
    saveFingerprint: target?.saveFingerprint ?? record?.toolbeltStateFingerprint,
  });
  const applied = conclusiveZero
    ? 0
    : deriveActualBasicSaveHpLoss({
        beforeHp: record?.preApplicationHp,
        beforeTempHp: record?.preApplicationTempHp,
        afterHp: record?.postApplicationHp,
        afterTempHp: record?.postApplicationTempHp,
      });

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
    baseRollTotal: finiteNumber(damageRoll?.total),
    degreeAdjustedAmount: finiteNumber(transformedRoll?.total),
  });
}

function rememberDamageEmission(damageResultId) {
  damagePresentationEmittedByDamageResultId.set(damageResultId, {
    damageResultId,
    emittedAt: Date.now(),
  });
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
      batchId: payload.batchId ?? null,
      targetLabel: labelFromUuid(payload.targetTokenUuid) ?? labelFromUuid(payload.targetActorUuid),
      degree: payload.save?.degreeOfSuccess ?? null,
      baseRollTotal: Number.isFinite(payload.damage?.baseRollTotal)
        ? payload.damage.baseRollTotal
        : null,
      applied: payload.damage?.applied,
    });
  } catch {
    /* diagnostic watcher must never affect mechanics */
  }
}

export function watchBasicSaveDamagePresentationFeed() {
  if (globalThis.game?.user?.isGM !== true) return false;
  if (damageFeedWatcher) return true;
  damageFeedWatcher = (summary) => {
    console.debug(
      [
        "BASIC SAVE TARGET DAMAGE",
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
    targetDamageAppliedHook: BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
    damageProducerAvailable: true,
    appliedDamageSource: BASIC_SAVE_DAMAGE_APPLIED_SOURCE,
    tempHpAware: BASIC_SAVE_DAMAGE_TEMP_HP_AWARE,
    emittedDamageResults: damagePresentationEmittedByDamageResultId.size,
  };
}

/** Test helpers. */
export function clearBasicSaveDamagePresentationEmissions() {
  damagePresentationEmittedByDamageResultId.clear();
  damageFeedWatcher = null;
}

export function seedBasicSaveTargetDamagePresentationEmission(damageResultId) {
  if (damageResultId) rememberDamageEmission(damageResultId);
}
