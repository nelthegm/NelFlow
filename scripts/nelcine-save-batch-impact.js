/**
 * NelCine save-batch impact commit bridge (0.10.0 / Slice 2C-B).
 * NelFlow prepares authoritative applications and commits them when NelCine
 * signals per-result impact timing. Presentation never supplies damage math.
 */

import { SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import {
  clampSaveBatchMinimumTargets,
  DEFAULT_MIN_TARGETS,
  NELCINE_MODULE_ID,
  normalizeSaveType,
} from "./nelcine-save-batch-bridge.js";

export const NELCINE_SAVE_BATCH_IMPACT_HOOK = "nelcine.saveBatchImpact";

export const SAVE_BATCH_COMMIT_TRIGGERS = Object.freeze({
  VISUAL: "visual",
  IMMEDIATE: "immediate",
  FALLBACK: "fallback",
  TIMEOUT: "nelflow-timeout",
  BROADCAST_FAILURE: "broadcast-failure",
});

export const PREPARED_RESULT_STATES = Object.freeze({
  PREPARED: "prepared",
  CLAIMING: "claiming",
  COMMITTED: "committed",
  FAILED: "failed",
  CANCELED: "canceled",
});

const DEFAULT_IMPACT_TIMEOUT_MS = 12_000;
const MIN_IMPACT_TIMEOUT_MS = 500;
const MAX_IMPACT_TIMEOUT_MS = 30_000;
const EMERGENCY_PADDING_MS = 2_000;
const MIN_EMERGENCY_MS = 4_000;
const MAX_EMERGENCY_MS = 32_000;

/** @type {Map<string, object>} */
const pendingBatches = new Map();
/** @type {((summary: object) => void)|null} */
let impactWatcher = null;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampSaveBatchImpactTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_IMPACT_TIMEOUT_MS;
  return Math.min(MAX_IMPACT_TIMEOUT_MS, Math.max(MIN_IMPACT_TIMEOUT_MS, Math.round(n)));
}

/**
 * @param {number} impactTimeoutMs
 * @returns {number}
 */
export function computeSaveBatchEmergencyTimeoutMs(impactTimeoutMs) {
  const base = clampSaveBatchImpactTimeoutMs(impactTimeoutMs) + EMERGENCY_PADDING_MS;
  return Math.min(MAX_EMERGENCY_MS, Math.max(MIN_EMERGENCY_MS, base));
}

/**
 * Map NelCine lifecycle source → local commit trigger.
 * @param {unknown} source
 * @returns {string}
 */
export function mapSaveBatchImpactSource(source) {
  if (source === "visual") return SAVE_BATCH_COMMIT_TRIGGERS.VISUAL;
  if (source === "immediate") return SAVE_BATCH_COMMIT_TRIGGERS.IMMEDIATE;
  if (source === "fallback") return SAVE_BATCH_COMMIT_TRIGGERS.FALLBACK;
  if (source === SAVE_BATCH_COMMIT_TRIGGERS.TIMEOUT) return SAVE_BATCH_COMMIT_TRIGGERS.TIMEOUT;
  if (source === SAVE_BATCH_COMMIT_TRIGGERS.BROADCAST_FAILURE) {
    return SAVE_BATCH_COMMIT_TRIGGERS.BROADCAST_FAILURE;
  }
  return SAVE_BATCH_COMMIT_TRIGGERS.IMMEDIATE;
}

/**
 * Pure eligibility for delayed save-batch commit.
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateSaveBatchImpactSyncEligibility(ctx = {}) {
  if (ctx.impactSyncEnabled !== true) return { eligible: false, reason: "impact-sync-disabled" };
  if (ctx.batchCinematicsEnabled !== true) {
    return { eligible: false, reason: "batch-cinematics-disabled" };
  }
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.isProcessingGm !== true) return { eligible: false, reason: "not-processing-gm" };
  if (ctx.nelcineActive !== true) return { eligible: false, reason: "nelcine-inactive" };
  if (ctx.hasBroadcastApi !== true) return { eligible: false, reason: "missing-broadcast-api" };
  if (ctx.hasImpactContract !== true) return { eligible: false, reason: "missing-impact-contract" };
  if (ctx.primaryGmApiAvailable === true && ctx.isPrimaryGM !== true) {
    return { eligible: false, reason: "not-primary-gm" };
  }
  if (ctx.nelcineClientEnabled !== true) return { eligible: false, reason: "nelcine-client-disabled" };
  if (ctx.presentationMode === "off") return { eligible: false, reason: "presentation-off" };
  if (ctx.supportedWorkflow !== true) return { eligible: false, reason: "unsupported-workflow" };
  if (ctx.hpAlreadyStarted === true) return { eligible: false, reason: "hp-already-started" };
  if (!ctx.transactionId) return { eligible: false, reason: "missing-transaction-id" };
  if (ctx.alreadyPresented === true) return { eligible: false, reason: "already-presented" };
  const minTargets = clampSaveBatchMinimumTargets(ctx.minimumTargets ?? DEFAULT_MIN_TARGETS);
  if (!Number.isFinite(ctx.targetCount) || ctx.targetCount < minTargets) {
    return { eligible: false, reason: "below-minimum-targets" };
  }
  if (!normalizeSaveType(ctx.saveType)) return { eligible: false, reason: "unsupported-save-type" };
  if (ctx.hasSharedDamageRoll !== true) {
    return { eligible: false, reason: "independent-per-target-rolls" };
  }
  if (ctx.hasAuthoritativeDegrees !== true) {
    return { eligible: false, reason: "missing-authoritative-degrees" };
  }
  if (ctx.hasStableResultIds !== true) {
    return { eligible: false, reason: "unstable-result-ids" };
  }
  return { eligible: true };
}

/**
 * Live NelCine detection for authoritative save-batch impacts.
 * @returns {object}
 */
export function detectNelcineSaveBatchImpactRuntime() {
  const active = game.modules?.get?.(NELCINE_MODULE_ID)?.active === true;
  const api = game.nelcine ?? null;
  const broadcast =
    typeof api?.integrations?.nelflow?.broadcastSaveBatch === "function"
      ? api.integrations.nelflow.broadcastSaveBatch.bind(api.integrations.nelflow)
      : null;
  const primaryGmApiAvailable = typeof api?.sync?.isPrimaryGM === "function";
  const isPrimaryGM = primaryGmApiAvailable ? Boolean(api.sync.isPrimaryGM()) : null;
  const impactHook =
    typeof api?.saveBatchImpact?.HOOK_NAME === "string" && api.saveBatchImpact.HOOK_NAME
      ? api.saveBatchImpact.HOOK_NAME
      : typeof api?.impact?.SAVE_BATCH_HOOK_NAME === "string" && api.impact.SAVE_BATCH_HOOK_NAME
        ? api.impact.SAVE_BATCH_HOOK_NAME
        : NELCINE_SAVE_BATCH_IMPACT_HOOK;
  const hasImpactContract =
    Boolean(api?.saveBatchImpact) ||
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
    primaryGmApiAvailable,
    isPrimaryGM,
    impactHook,
    hasImpactContract,
    hasBroadcastApi: typeof broadcast === "function",
    nelcineClientEnabled,
    presentationMode,
  };
}

/**
 * @param {object} args
 * @returns {{ eligible: boolean, reason?: string, runtime?: object, impactTimeoutMs?: number }}
 */
export function canUseSaveBatchImpactSync(args = {}) {
  const runtime = detectNelcineSaveBatchImpactRuntime();
  let impactSyncEnabled = false;
  let batchCinematicsEnabled = false;
  let minimumTargets = DEFAULT_MIN_TARGETS;
  let impactTimeoutMs = DEFAULT_IMPACT_TIMEOUT_MS;
  try {
    impactSyncEnabled = getSetting(SETTINGS.NELCINE_SAVE_BATCH_IMPACT_SYNC) === true;
  } catch {
    impactSyncEnabled = false;
  }
  try {
    batchCinematicsEnabled = getSetting(SETTINGS.NELCINE_SAVE_BATCH_CINEMATICS) === true;
  } catch {
    batchCinematicsEnabled = false;
  }
  try {
    minimumTargets = clampSaveBatchMinimumTargets(
      getSetting(SETTINGS.NELCINE_SAVE_BATCH_MINIMUM_TARGETS),
    );
  } catch {
    minimumTargets = DEFAULT_MIN_TARGETS;
  }
  try {
    // Prefer strike impact timeout when set; otherwise use batch default 12s.
    const configured = getSetting(SETTINGS.NELCINE_IMPACT_TIMEOUT_MS);
    impactTimeoutMs = Number.isFinite(Number(configured))
      ? clampSaveBatchImpactTimeoutMs(Math.max(Number(configured), DEFAULT_IMPACT_TIMEOUT_MS))
      : DEFAULT_IMPACT_TIMEOUT_MS;
  } catch {
    impactTimeoutMs = DEFAULT_IMPACT_TIMEOUT_MS;
  }

  const result = evaluateSaveBatchImpactSyncEligibility({
    impactSyncEnabled,
    batchCinematicsEnabled,
    isGM: game.user?.isGM === true,
    isProcessingGm: args.isProcessingGm === true,
    nelcineActive: runtime.active,
    hasBroadcastApi: runtime.hasBroadcastApi,
    hasImpactContract: runtime.hasImpactContract,
    primaryGmApiAvailable: runtime.primaryGmApiAvailable,
    isPrimaryGM: runtime.isPrimaryGM === true,
    nelcineClientEnabled: runtime.nelcineClientEnabled,
    presentationMode: runtime.presentationMode,
    supportedWorkflow: args.supportedWorkflow === true,
    hpAlreadyStarted: args.hpAlreadyStarted === true,
    transactionId: args.transactionId,
    alreadyPresented: args.alreadyPresented === true,
    minimumTargets,
    targetCount: args.targetCount,
    saveType: args.saveType,
    hasSharedDamageRoll: args.hasSharedDamageRoll !== false,
    hasAuthoritativeDegrees: args.hasAuthoritativeDegrees === true,
    hasStableResultIds: args.hasStableResultIds !== false,
  });
  return { ...result, runtime, impactTimeoutMs, minimumTargets };
}

/**
 * Arm a prepared multi-result batch. Memory-only for this slice.
 * @param {object} entry
 * @param {{ onEmergency: (transactionId: string) => void, now?: () => number, setTimeoutFn?: Function }} deps
 * @returns {object}
 */
export function armPendingSaveBatch(entry, deps) {
  const transactionId = entry?.transactionId;
  if (!transactionId) throw new Error("Pending save batch requires transactionId");
  if (pendingBatches.has(transactionId)) return pendingBatches.get(transactionId);

  const impactTimeoutMs = clampSaveBatchImpactTimeoutMs(entry.impactTimeoutMs);
  const emergencyMs = computeSaveBatchEmergencyTimeoutMs(impactTimeoutMs);
  const now = deps.now ?? (() => Date.now());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const results = new Map();
  for (const result of entry.results ?? []) {
    if (!result?.resultId) continue;
    results.set(result.resultId, {
      resultId: result.resultId,
      targetKey: result.targetKey ?? null,
      targetTokenUuid: result.targetTokenUuid ?? null,
      targetActorUuid: result.targetActorUuid ?? null,
      applicationId: result.applicationId ?? result.resultId,
      degreeOfSuccess: result.degreeOfSuccess ?? null,
      multiplier: result.multiplier ?? null,
      damageMessageId: result.damageMessageId ?? entry.damageMessageId ?? null,
      rollIndex: Number.isInteger(result.rollIndex) ? result.rollIndex : entry.rollIndex ?? 0,
      state: PREPARED_RESULT_STATES.PREPARED,
      preparedAt: now(),
      committedAt: null,
      commitTrigger: null,
      workflow: entry.workflow ?? null,
      meta: result.meta ?? null,
    });
  }

  const record = {
    transactionId,
    workflow: entry.workflow ?? null,
    damageMessageId: entry.damageMessageId ?? null,
    resolverMessageId: entry.resolverMessageId ?? null,
    processingUserId: entry.processingUserId ?? game.user?.id ?? null,
    impactTimeoutMs,
    emergencyMs,
    createdAt: now(),
    deadlineAt: now() + emergencyMs,
    canceled: false,
    timer: null,
    results,
    commitHandler: typeof entry.commitHandler === "function" ? entry.commitHandler : null,
  };

  record.timer = setTimeoutFn(() => {
    deps.onEmergency(transactionId);
  }, emergencyMs);

  pendingBatches.set(transactionId, record);
  notifyWatcher({
    event: "PREPARED",
    transactionId,
    preparedCount: results.size,
  });
  return record;
}

/**
 * Atomically claim one prepared result. Returns null if unavailable.
 * @param {string} transactionId
 * @param {string} resultId
 * @param {string} trigger
 * @returns {object|null}
 */
export function claimPendingBatchResult(transactionId, resultId, trigger) {
  const batch = pendingBatches.get(transactionId);
  if (!batch || batch.canceled) return null;
  const result = batch.results.get(resultId);
  if (!result || result.state !== PREPARED_RESULT_STATES.PREPARED) return null;
  result.state = PREPARED_RESULT_STATES.CLAIMING;
  result.commitTrigger = trigger;
  return { batch, result };
}

/**
 * Mark claimed result terminal and drop the batch when empty of prepared work.
 * @param {string} transactionId
 * @param {string} resultId
 * @param {"committed"|"failed"|"canceled"} terminal
 * @param {{ now?: () => number }} [deps]
 */
export function finalizePendingBatchResult(transactionId, resultId, terminal, deps = {}) {
  const batch = pendingBatches.get(transactionId);
  if (!batch) return;
  const result = batch.results.get(resultId);
  if (!result) return;
  const now = deps.now ?? (() => Date.now());
  if (terminal === "committed") {
    result.state = PREPARED_RESULT_STATES.COMMITTED;
    result.committedAt = now();
  } else if (terminal === "canceled") {
    result.state = PREPARED_RESULT_STATES.CANCELED;
  } else {
    result.state = PREPARED_RESULT_STATES.FAILED;
  }

  const remaining = [...batch.results.values()].some(
    (entry) =>
      entry.state === PREPARED_RESULT_STATES.PREPARED ||
      entry.state === PREPARED_RESULT_STATES.CLAIMING,
  );
  if (!remaining) {
    if (batch.timer != null) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    pendingBatches.delete(transactionId);
  }
}

/**
 * Commit every still-prepared result exactly once.
 * @param {string} transactionId
 * @param {string} trigger
 * @returns {Promise<number>}
 */
export async function commitRemainingPreparedResults(transactionId, trigger) {
  const batch = pendingBatches.get(transactionId);
  if (!batch || typeof batch.commitHandler !== "function") return 0;
  const preparedIds = [...batch.results.values()]
    .filter((entry) => entry.state === PREPARED_RESULT_STATES.PREPARED)
    .map((entry) => entry.resultId);
  let count = 0;
  for (const resultId of preparedIds) {
    const ok = await commitPendingBatchResult(transactionId, resultId, trigger);
    if (ok) count += 1;
  }
  return count;
}

/**
 * Central commit path for delayed batch HP.
 * @param {string} transactionId
 * @param {string} resultId
 * @param {string} trigger
 * @returns {Promise<boolean>}
 */
export async function commitPendingBatchResult(transactionId, resultId, trigger) {
  if (game.user?.isGM !== true) return false;
  const claimed = claimPendingBatchResult(transactionId, resultId, trigger);
  if (!claimed) return false;
  const { batch, result } = claimed;
  if (batch.processingUserId && batch.processingUserId !== game.user.id) {
    result.state = PREPARED_RESULT_STATES.PREPARED;
    result.commitTrigger = null;
    return false;
  }

  notifyWatcher({
    event: `IMPACT ${trigger}`,
    transactionId,
    resultId,
  });

  try {
    if (typeof batch.commitHandler !== "function") {
      finalizePendingBatchResult(transactionId, resultId, "failed");
      notifyWatcher({ event: "FAILED", transactionId, resultId, reason: "missing-commit-handler" });
      return false;
    }
    const outcome = await batch.commitHandler({
      transactionId,
      resultId,
      trigger,
      result,
      batch,
    });
    if (outcome === false || outcome?.ok === false) {
      finalizePendingBatchResult(transactionId, resultId, "failed");
      notifyWatcher({
        event: "FAILED",
        transactionId,
        resultId,
        reason: outcome?.reason ?? "commit-failed",
      });
      return false;
    }
    finalizePendingBatchResult(transactionId, resultId, "committed");
    notifyWatcher({ event: "COMMITTED", transactionId, resultId, trigger });
    return true;
  } catch (error) {
    finalizePendingBatchResult(transactionId, resultId, "failed");
    logger.error("Save-batch impact commit failed", {
      stage: "nelcine-save-batch-impact",
      transactionId,
      resultId,
      reason: error instanceof Error ? error.message : String(error),
    }, error);
    notifyWatcher({
      event: "FAILED",
      transactionId,
      resultId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * @param {object} impact
 * @returns {{ transactionId: string|null, resultId: string|null, source: string|null, senderUserId: string|null }}
 */
export function lifecycleIdsFromSaveBatchImpact(impact) {
  if (!impact || typeof impact !== "object") {
    return { transactionId: null, resultId: null, source: null, senderUserId: null };
  }
  return {
    transactionId:
      typeof impact.transactionId === "string" && impact.transactionId
        ? impact.transactionId
        : null,
    resultId:
      typeof impact.resultId === "string" && impact.resultId ? impact.resultId : null,
    source: typeof impact.source === "string" ? impact.source : null,
    senderUserId:
      typeof impact.senderUserId === "string" && impact.senderUserId
        ? impact.senderUserId
        : null,
  };
}

/**
 * Handle a NelCine save-batch impact lifecycle signal.
 * @param {object} impact
 * @returns {Promise<boolean>}
 */
export async function handleSaveBatchImpact(impact) {
  const ids = lifecycleIdsFromSaveBatchImpact(impact);
  if (!ids.transactionId || !ids.resultId) return false;
  const batch = pendingBatches.get(ids.transactionId);
  if (!batch) return false;
  if (batch.processingUserId && batch.processingUserId !== game.user?.id) return false;
  if (
    ids.senderUserId &&
    batch.processingUserId &&
    ids.senderUserId !== batch.processingUserId &&
    ids.senderUserId !== game.user?.id
  ) {
    // Prefer local processing GM; ignore foreign senders that do not match authority.
    return false;
  }
  const trigger = mapSaveBatchImpactSource(ids.source);
  return commitPendingBatchResult(ids.transactionId, ids.resultId, trigger);
}

/**
 * Register the nelcine.saveBatchImpact listener once.
 * @param {(impact: object) => void|Promise<void>} [handler]
 */
export function registerSaveBatchImpactHook(handler = handleSaveBatchImpact) {
  const flag = Symbol.for("nelflow.nelcine.saveBatchImpact.registered");
  if (globalThis[flag]) return;
  globalThis[flag] = true;
  if (typeof Hooks === "undefined" || typeof Hooks.on !== "function") return;
  const runtime = detectNelcineSaveBatchImpactRuntime();
  const hookName = runtime.impactHook || NELCINE_SAVE_BATCH_IMPACT_HOOK;
  Hooks.on(hookName, (impact) => {
    try {
      void Promise.resolve(handler(impact)).catch((error) => {
        logger.error("Save-batch impact handler failed", {
          stage: "nelcine-save-batch-impact",
        }, error);
      });
    } catch (error) {
      logger.error("Save-batch impact handler failed", {
        stage: "nelcine-save-batch-impact",
      }, error);
    }
  });
}

/**
 * Broadcast authoritative batch; on definitive failure commit remaining once.
 * @param {object} args
 * @returns {Promise<{ delivered: boolean, reason?: string }>}
 */
export async function broadcastAuthoritativeSaveBatch({
  payload,
  broadcast,
  impactTimeoutMs,
  transactionId,
} = {}) {
  if (typeof broadcast !== "function") {
    await commitRemainingPreparedResults(
      transactionId,
      SAVE_BATCH_COMMIT_TRIGGERS.BROADCAST_FAILURE,
    );
    notifyWatcher({ event: "FALLBACK", transactionId, reason: "missing-broadcast-api" });
    return { delivered: false, reason: "missing-broadcast-api" };
  }
  try {
    const result = await broadcast(payload, {
      authoritativeImpacts: true,
      impactTimeoutMs: clampSaveBatchImpactTimeoutMs(impactTimeoutMs),
    });
    if (result === false || result?.ok === false) {
      await commitRemainingPreparedResults(
        transactionId,
        SAVE_BATCH_COMMIT_TRIGGERS.BROADCAST_FAILURE,
      );
      notifyWatcher({
        event: "FALLBACK",
        transactionId,
        reason: result?.reason ?? "broadcast-rejected",
      });
      return { delivered: false, reason: result?.reason ?? "broadcast-rejected" };
    }
    return { delivered: true };
  } catch (error) {
    await commitRemainingPreparedResults(
      transactionId,
      SAVE_BATCH_COMMIT_TRIGGERS.BROADCAST_FAILURE,
    );
    notifyWatcher({
      event: "FALLBACK",
      transactionId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      delivered: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function hasPendingSaveBatch(transactionId) {
  return pendingBatches.has(transactionId);
}

export function getPendingSaveBatch(transactionId) {
  return pendingBatches.get(transactionId) ?? null;
}

/**
 * Safe GM-only pending impact status.
 * @returns {object}
 */
export function getPendingImpactStatus() {
  if (game.user?.isGM !== true) {
    return { pendingBatchCount: 0, batches: [] };
  }
  const batches = [...pendingBatches.values()].map((batch) => summarizeBatch(batch));
  return {
    pendingBatchCount: batches.length,
    batches,
  };
}

/**
 * @param {string} transactionId
 * @returns {object|null}
 */
export function getPendingImpactBatch(transactionId) {
  if (game.user?.isGM !== true) return null;
  const batch = pendingBatches.get(transactionId);
  return batch ? summarizeBatch(batch) : null;
}

function summarizeBatch(batch) {
  const results = [...batch.results.values()];
  return {
    transactionId: batch.transactionId,
    state: batch.canceled ? "canceled" : "pending",
    preparedCount: results.filter((r) => r.state === PREPARED_RESULT_STATES.PREPARED).length,
    committedCount: results.filter((r) => r.state === PREPARED_RESULT_STATES.COMMITTED).length,
    failedCount: results.filter((r) => r.state === PREPARED_RESULT_STATES.FAILED).length,
    remainingCount: results.filter(
      (r) =>
        r.state === PREPARED_RESULT_STATES.PREPARED ||
        r.state === PREPARED_RESULT_STATES.CLAIMING,
    ).length,
    createdAt: batch.createdAt,
    deadlineAt: batch.deadlineAt,
    results: results.map((r) => ({
      resultId: r.resultId,
      state: r.state,
      commitTrigger: r.commitTrigger,
    })),
  };
}

function notifyWatcher(summary) {
  if (typeof impactWatcher !== "function") return;
  try {
    impactWatcher(summary);
  } catch {
    /* non-fatal */
  }
}

export function watchSaveBatchImpactCommits() {
  if (game.user?.isGM !== true) return false;
  if (impactWatcher) return true;
  impactWatcher = (summary) => {
    console.debug("NelFlow | NelCine Save Batch Impact |", summary.event, {
      transactionId: String(summary.transactionId ?? "").slice(-12),
      resultId: summary.resultId ? String(summary.resultId).slice(-12) : undefined,
      reason: summary.reason,
      preparedCount: summary.preparedCount,
    });
  };
  return true;
}

export function stopWatchingSaveBatchImpactCommits() {
  const had = Boolean(impactWatcher);
  impactWatcher = null;
  return had;
}

/** Mark interrupted prepared batches as canceled without applying HP. */
export function abandonPendingSaveBatchesOnReload() {
  for (const [transactionId, batch] of [...pendingBatches.entries()]) {
    if (batch.timer != null) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    batch.canceled = true;
    for (const result of batch.results.values()) {
      if (result.state === PREPARED_RESULT_STATES.PREPARED) {
        result.state = PREPARED_RESULT_STATES.CANCELED;
      }
    }
    pendingBatches.delete(transactionId);
    notifyWatcher({ event: "TIMEOUT", transactionId, reason: "reload-abandon" });
  }
}

export function clearPendingSaveBatches() {
  for (const batch of pendingBatches.values()) {
    if (batch.timer != null) clearTimeout(batch.timer);
  }
  pendingBatches.clear();
}

/**
 * Install pending-impact diagnostics on the existing save-batch public API.
 */
export function installSaveBatchImpactPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  const existing = root.integrations.nelcineSaveBatch ?? {};
  root.integrations.nelcineSaveBatch = Object.freeze({
    ...existing,
    getPendingImpactStatus: () => getPendingImpactStatus(),
    getPendingImpactBatch: (transactionId) => getPendingImpactBatch(transactionId),
  });
  root.dev = root.dev ?? {};
  root.dev.watchSaveBatchImpactCommits = () => watchSaveBatchImpactCommits();
  root.dev.stopWatchingSaveBatchImpactCommits = () => stopWatchingSaveBatchImpactCommits();
}
