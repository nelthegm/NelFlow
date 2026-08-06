/**
 * NelCine impact commit bridge (Slice 1D-B).
 * NelFlow owns mechanics; NelCine supplies timing only.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { buildAttackRollInspection, buildDamageRollInspection } from "./strike-roll-inspection.js";
import { getSetting } from "./settings.js";

export const NELCINE_MODULE_ID = "nelcine";
export const NELCINE_IMPACT_HOOK = "nelcine.strikeImpact";
export const COMMIT_TRIGGERS = Object.freeze({
  IMPACT: "nelcine-impact",
  TIMEOUT: "nelflow-timeout",
  BROADCAST_FAILED: "nelflow-broadcast-failed",
  IMMEDIATE: "nelflow-immediate",
});

const DEFAULT_IMPACT_TIMEOUT_MS = 5000;
const MIN_IMPACT_TIMEOUT_MS = 500;
const MAX_IMPACT_TIMEOUT_MS = 15_000;
const EMERGENCY_PADDING_MS = 1500;
const MIN_EMERGENCY_MS = 2000;
const MAX_EMERGENCY_MS = 18_000;

/** @type {Map<string, object>} */
const pendingByTransactionId = new Map();

/**
 * @param {number} value
 * @returns {number}
 */
export function clampImpactTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IMPACT_TIMEOUT_MS;
  return Math.min(MAX_IMPACT_TIMEOUT_MS, Math.max(MIN_IMPACT_TIMEOUT_MS, Math.round(n)));
}

/**
 * @param {number} impactTimeoutMs
 * @returns {number}
 */
export function computeEmergencyCommitTimeoutMs(impactTimeoutMs) {
  const base = clampImpactTimeoutMs(impactTimeoutMs) + EMERGENCY_PADDING_MS;
  return Math.min(MAX_EMERGENCY_MS, Math.max(MIN_EMERGENCY_MS, base));
}

/**
 * Pure eligibility for delayed cinematic commit.
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateNelcineImpactEligibility(ctx = {}) {
  if (ctx.settingEnabled !== true) return { eligible: false, reason: "setting-disabled" };
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.nelcineActive !== true) return { eligible: false, reason: "nelcine-inactive" };
  if (ctx.hasBroadcastApi !== true) return { eligible: false, reason: "missing-broadcast-api" };
  if (ctx.hasImpactContract !== true) return { eligible: false, reason: "missing-impact-contract" };
  if (ctx.isPrimaryGM !== true) return { eligible: false, reason: "not-primary-gm" };
  if (ctx.nelcineClientEnabled !== true) return { eligible: false, reason: "nelcine-client-disabled" };
  if (ctx.presentationMode === "off") return { eligible: false, reason: "presentation-off" };
  if (ctx.canvasReady !== true) return { eligible: false, reason: "canvas-not-ready" };
  if (!ctx.activeSceneId || ctx.activeSceneId !== ctx.targetSceneId) {
    return { eligible: false, reason: "scene-mismatch" };
  }
  if (ctx.outcome !== "success" && ctx.outcome !== "criticalSuccess") {
    return { eligible: false, reason: "non-hit-outcome" };
  }
  if (ctx.hasAuthoritativeDamage !== true) return { eligible: false, reason: "missing-damage" };
  if (!Number.isFinite(ctx.damageTotal)) return { eligible: false, reason: "non-finite-damage-total" };
  if (ctx.supportsDelayedCommit !== true) return { eligible: false, reason: "unsafe-to-delay" };
  return { eligible: true };
}

/**
 * Live Foundry feature detection for NelCine compatibility.
 * Absence of NelCine is not an error.
 * @returns {object}
 */
export function detectNelcineRuntime() {
  const active = game.modules?.get?.(NELCINE_MODULE_ID)?.active === true;
  const api = game.nelcine ?? null;
  const broadcast =
    typeof api?.integrations?.nelflow?.broadcastStrike === "function"
      ? api.integrations.nelflow.broadcastStrike.bind(api.integrations.nelflow)
      : null;
  const isPrimaryGM =
    typeof api?.sync?.isPrimaryGM === "function" ? Boolean(api.sync.isPrimaryGM()) : false;
  const impactHook =
    typeof api?.impact?.HOOK_NAME === "string" && api.impact.HOOK_NAME
      ? api.impact.HOOK_NAME
      : NELCINE_IMPACT_HOOK;
  const hasImpactContract =
    Boolean(api?.impact) ||
    (typeof Hooks !== "undefined" && typeof Hooks.on === "function");

  let nelcineClientEnabled = false;
  let presentationMode = "off";
  if (active) {
    try {
      nelcineClientEnabled = game.settings.get(NELCINE_MODULE_ID, "enabled") === true;
    } catch {
      nelcineClientEnabled = false;
    }
    try {
      presentationMode = game.settings.get(NELCINE_MODULE_ID, "presentationMode") ?? "off";
    } catch {
      presentationMode = "off";
    }
  }

  return {
    active,
    broadcast,
    isPrimaryGM,
    impactHook,
    hasImpactContract,
    hasBroadcastApi: typeof broadcast === "function",
    nelcineClientEnabled,
    presentationMode,
  };
}

/**
 * Build a NelCine schemaVersion-1 raw strike payload from resolved NelFlow data.
 * Does not mutate inputs. Ignores nothing mechanical from NelCine later.
 * @param {object} args
 * @returns {object}
 */
export function buildNelcineStrikeRawPayload(args) {
  const {
    transactionId,
    strike,
    attackMessage,
    targetToken,
    damageMessage,
    damageSummary,
  } = args;

  const attackInspection = buildAttackRollInspection({
    message: attackMessage,
    transaction: {
      transactionType: "npc-strike",
      snapshot: {
        targetTokenUuid: targetToken.document.uuid,
        targetActorUuid: targetToken.actor.uuid,
        strikeName: strike.item?.name,
        outcome: strike.outcome,
        mapPenalty: strike.mapPenalty,
      },
    },
    canInspectTarget: () => true,
    targetLabel: () => targetToken.name,
  });

  const damageInspection = buildDamageRollInspection({ message: damageMessage });

  const degreeMap = {
    criticalFailure: 0,
    failure: 1,
    success: 2,
    criticalSuccess: 3,
  };

  const dice = Array.isArray(damageInspection.dice)
    ? damageInspection.dice
        .filter((die) => Number.isFinite(die.faces) && Number.isFinite(die.kept))
        .map((die) => ({ faces: die.faces, result: die.kept }))
    : null;

  const components = Array.isArray(damageSummary?.components)
    ? damageSummary.components.map((c) => ({
        type: c.type,
        value: c.total,
      }))
    : null;

  const staticMod = Array.isArray(damageInspection.staticTerms)
    ? damageInspection.staticTerms.reduce((sum, term) => sum + (Number(term.value) || 0), 0)
    : null;

  return {
    schemaVersion: 1,
    transactionId,
    type: "strike",
    attackerTokenUuid: strike.sourceTokenUuid ?? attackMessage.token?.document?.uuid ?? null,
    attackerActorUuid: strike.actor?.uuid ?? null,
    targetTokenUuid: targetToken.document.uuid,
    targetActorUuid: targetToken.actor.uuid,
    itemUuid: strike.item?.uuid ?? null,
    actionName: strike.item?.name ?? "Strike",
    attack: {
      dieResult: attackInspection.natural,
      modifier: attackInspection.finalModifier,
      total: attackInspection.total,
      degreeOfSuccess: degreeMap[strike.outcome] ?? strike.outcome,
    },
    damage: {
      formula: damageInspection.formula,
      dice,
      modifier: Number.isFinite(staticMod) ? staticMod : null,
      total: Number.isFinite(damageSummary?.total)
        ? damageSummary.total
        : damageInspection.total,
      components,
    },
  };
}

/**
 * Evaluate live eligibility for the current GM client.
 * @param {object} args
 * @returns {{ eligible: boolean, reason?: string, runtime?: object, impactTimeoutMs?: number }}
 */
export function canUseNelcineImpactSync(args) {
  const runtime = detectNelcineRuntime();
  const impactTimeoutMs = clampImpactTimeoutMs(
    args.impactTimeoutMs ?? getSetting(SETTINGS.NELCINE_IMPACT_TIMEOUT_MS),
  );
  const result = evaluateNelcineImpactEligibility({
    settingEnabled: getSetting(SETTINGS.NELCINE_IMPACT_SYNC) === true,
    isGM: game.user?.isGM === true,
    nelcineActive: runtime.active,
    hasBroadcastApi: runtime.hasBroadcastApi,
    hasImpactContract: runtime.hasImpactContract,
    isPrimaryGM: runtime.isPrimaryGM,
    nelcineClientEnabled: runtime.nelcineClientEnabled,
    presentationMode: runtime.presentationMode,
    canvasReady: Boolean(canvas?.ready),
    activeSceneId: canvas?.scene?.id ?? game.scenes?.active?.id ?? null,
    targetSceneId: args.targetSceneId ?? null,
    outcome: args.outcome,
    hasAuthoritativeDamage: args.hasAuthoritativeDamage === true,
    damageTotal: args.damageTotal,
    supportsDelayedCommit: args.supportsDelayedCommit !== false,
  });
  return { ...result, runtime, impactTimeoutMs };
}

/**
 * Arm a pending prepared-damage transaction.
 * @param {object} entry
 * @param {{ onEmergency: (transactionId: string) => void, now?: () => number, setTimeoutFn?: Function }} deps
 * @returns {object}
 */
export function armPendingImpactCommit(entry, deps) {
  const transactionId = entry.transactionId;
  if (!transactionId) throw new Error("Pending impact commit requires transactionId");
  if (pendingByTransactionId.has(transactionId)) {
    return pendingByTransactionId.get(transactionId);
  }

  const impactTimeoutMs = clampImpactTimeoutMs(entry.impactTimeoutMs);
  const emergencyMs = computeEmergencyCommitTimeoutMs(impactTimeoutMs);
  const now = deps.now ?? (() => Date.now());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;

  const record = {
    ...entry,
    impactTimeoutMs,
    emergencyMs,
    armedAt: now(),
    claimed: false,
    triggerSource: null,
    timer: null,
  };

  record.timer = setTimeoutFn(() => {
    deps.onEmergency(transactionId);
  }, emergencyMs);

  pendingByTransactionId.set(transactionId, record);
  return record;
}

/**
 * Atomically claim a pending transaction for commit. Returns null if already claimed/missing.
 * @param {string} transactionId
 * @param {string} triggerSource
 * @returns {object|null}
 */
export function claimPendingImpactCommit(transactionId, triggerSource) {
  const record = pendingByTransactionId.get(transactionId);
  if (!record || record.claimed) return null;
  record.claimed = true;
  record.triggerSource = triggerSource;
  if (record.timer != null) {
    clearTimeout(record.timer);
    record.timer = null;
  }
  pendingByTransactionId.delete(transactionId);
  return record;
}

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function hasPendingImpactCommit(transactionId) {
  return pendingByTransactionId.has(transactionId);
}

/**
 * @param {string} transactionId
 * @returns {object|null}
 */
export function getPendingImpactCommit(transactionId) {
  return pendingByTransactionId.get(transactionId) ?? null;
}

/**
 * Test/helper: clear all pending commits.
 */
export function clearAllPendingImpactCommits() {
  for (const record of pendingByTransactionId.values()) {
    if (record.timer != null) clearTimeout(record.timer);
  }
  pendingByTransactionId.clear();
}

/**
 * Register the nelcine.strikeImpact listener once.
 * @param {(impact: object) => void|Promise<void>} handler
 */
export function registerNelcineImpactHook(handler) {
  const flag = Symbol.for("nelflow.nelcine.strikeImpact.registered");
  if (globalThis[flag]) return;
  globalThis[flag] = true;
  if (typeof Hooks === "undefined" || typeof Hooks.on !== "function") return;

  const runtime = detectNelcineRuntime();
  const hookName = runtime.impactHook || NELCINE_IMPACT_HOOK;
  Hooks.on(hookName, (impact) => {
    try {
      void Promise.resolve(handler(impact)).catch((error) => {
        logger.error("NelCine impact handler failed", { stage: "nelcine-impact" }, error);
      });
    } catch (error) {
      logger.error("NelCine impact handler failed", { stage: "nelcine-impact" }, error);
    }
  });
}

/**
 * Ignore mechanical fields from NelCine impact payloads.
 * @param {object} impact
 * @returns {string|null}
 */
export function transactionIdFromImpact(impact) {
  if (!impact || typeof impact !== "object") return null;
  return typeof impact.transactionId === "string" && impact.transactionId
    ? impact.transactionId
    : null;
}
