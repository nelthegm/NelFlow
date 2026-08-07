/**
 * NelCine Strike presentation delivery (0.9.1).
 * Mutually exclusive paths: ordinary hook vs impact-sync broadcast.
 * Never applies HP; never trusts NelCine mechanical values.
 */

import { SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import {
  NELCINE_MODULE_ID,
  buildNelcineStrikeRawPayload,
  detectNelcineRuntime,
  evaluateNelcineImpactEligibility,
} from "./nelcine-impact-bridge.js";
import {
  getSaveBatchDiagnostic,
  getSaveBatchIntegrationStatus,
  installSaveBatchPublicApi,
} from "./nelcine-save-batch-bridge.js";
import { installSaveBatchImpactPublicApi, getPendingImpactStatus } from "./nelcine-save-batch-impact.js";
import { buildAttackRollInspection, buildDamageRollInspection } from "./strike-roll-inspection.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";

export const NELCINE_STRIKE_RESOLVED_HOOK = "nelflow.strikeResolved";
export const STRIKE_DELIVERY_PATHS = Object.freeze({
  PRESENTATION: "presentation",
  IMPACT_SYNC: "impact-sync",
});
export const STRIKE_DELIVERY_STATES = Object.freeze({
  PENDING: "pending",
  DELIVERED: "delivered",
  SKIPPED: "skipped",
  FAILED: "failed",
});

const MAX_RECENT = 48;
const LOG_PREFIX = "NelFlow | NelCine Strike |";

/** @type {Map<string, object>} */
const deliveriesByTransactionId = new Map();
/** @type {((summary: object) => void)|null} */
let strikeWatcher = null;

const DEGREE_MAP = Object.freeze({
  criticalFailure: 0,
  failure: 1,
  success: 2,
  criticalSuccess: 3,
});

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isSerializableStrikePayload(payload) {
  try {
    cloneSerializable(payload);
    return Boolean(payload) && typeof payload === "object";
  } catch {
    return false;
  }
}

/**
 * Pure eligibility for ordinary presentation-only Strike delivery.
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateStrikePresentationEligibility(ctx = {}) {
  if (ctx.settingEnabled !== true) return { eligible: false, reason: "setting-disabled" };
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.nelcineActive !== true) return { eligible: false, reason: "nelcine-inactive" };
  if (ctx.multiTarget === true) return { eligible: false, reason: "multi-target-unsupported" };
  if (ctx.impactSyncSelected === true) {
    return { eligible: false, reason: "impact-sync-owns-delivery" };
  }
  if (!ctx.transactionId) return { eligible: false, reason: "missing-transaction-id" };
  if (ctx.alreadyDelivered === true) return { eligible: false, reason: "already-delivered" };
  if (ctx.hasAuthoritativeAttack !== true) {
    return { eligible: false, reason: "missing-authoritative-attack" };
  }
  return { eligible: true };
}

/**
 * Live presentation eligibility.
 * @param {object} args
 * @returns {{ eligible: boolean, reason?: string, runtime?: object }}
 */
export function canDeliverStrikePresentation(args = {}) {
  let settingEnabled = false;
  try {
    settingEnabled = getSetting(SETTINGS.NELCINE_STRIKE_CINEMATICS) === true;
  } catch {
    settingEnabled = false;
  }
  const runtime = detectNelcineRuntime();
  const result = evaluateStrikePresentationEligibility({
    settingEnabled,
    isGM: game.user?.isGM === true,
    nelcineActive: runtime.active,
    multiTarget: args.multiTarget === true,
    impactSyncSelected: args.impactSyncSelected === true,
    transactionId: args.transactionId,
    alreadyDelivered: hasStrikeDelivery(args.transactionId),
    hasAuthoritativeAttack: args.hasAuthoritativeAttack !== false,
  });
  return { ...result, runtime };
}

/**
 * Build a serializable Strike payload. Omits damage for misses / attack-only.
 * Does not mutate inputs.
 * @param {object} args
 * @returns {{ ok: true, payload: object }|{ ok: false, reason: string }}
 */
export function buildStrikePresentationPayload(args = {}) {
  const transactionId =
    typeof args.transactionId === "string" && args.transactionId.trim()
      ? args.transactionId.trim()
      : null;
  if (!transactionId) return { ok: false, reason: "missing-transaction-id" };

  if (args.includeDamage === true && args.damageMessage && args.strike && args.targetToken) {
    try {
      const raw = buildNelcineStrikeRawPayload({
        transactionId,
        strike: args.strike,
        attackMessage: args.attackMessage,
        targetToken: args.targetToken,
        damageMessage: args.damageMessage,
        damageSummary: args.damageSummary,
      });
      if (!isSerializableStrikePayload(raw)) return { ok: false, reason: "serialization-failure" };
      return { ok: true, payload: cloneSerializable(raw) };
    } catch {
      return { ok: false, reason: "payload-build-failed" };
    }
  }

  const attackInspection = args.attackMessage
    ? buildAttackRollInspection({
        message: args.attackMessage,
        transaction: {
          transactionType: args.transactionType ?? "npc-strike",
          snapshot: {
            targetTokenUuid: args.targetTokenUuid ?? null,
            targetActorUuid: args.targetActorUuid ?? null,
            strikeName: args.actionName ?? null,
            outcome: args.outcome ?? null,
            mapPenalty: args.mapPenalty ?? null,
          },
        },
        canInspectTarget: () => true,
        targetLabel: () => null,
      })
    : null;

  const degree =
    DEGREE_MAP[args.outcome] ??
    (Number.isInteger(args.degreeOfSuccess) ? args.degreeOfSuccess : args.outcome ?? null);

  const payload = {
    schemaVersion: 1,
    transactionId,
    type: "strike",
    attackerTokenUuid: args.attackerTokenUuid ?? null,
    attackerActorUuid: args.attackerActorUuid ?? null,
    targetTokenUuid: args.targetTokenUuid ?? null,
    targetActorUuid: args.targetActorUuid ?? null,
    itemUuid: args.itemUuid ?? null,
    actionName: args.actionName ?? null,
    attack: {
      dieResult: Number.isFinite(args.dieResult)
        ? args.dieResult
        : Number.isFinite(attackInspection?.natural)
          ? attackInspection.natural
          : null,
      modifier: Number.isFinite(args.modifier)
        ? args.modifier
        : Number.isFinite(attackInspection?.finalModifier)
          ? attackInspection.finalModifier
          : null,
      total: Number.isFinite(args.total)
        ? args.total
        : Number.isFinite(attackInspection?.total)
          ? attackInspection.total
          : null,
      degreeOfSuccess: degree,
    },
  };

  if (args.includeDamage === true && args.damageSummary) {
    let inspection = null;
    if (args.damageMessage) {
      try {
        inspection = buildDamageRollInspection({ message: args.damageMessage });
      } catch {
        inspection = null;
      }
    }
    const dice = Array.isArray(inspection?.dice)
      ? inspection.dice
          .filter((die) => Number.isFinite(die.faces) && Number.isFinite(die.kept))
          .map((die) => ({ faces: die.faces, result: die.kept }))
      : null;
    const staticMod = Array.isArray(inspection?.staticTerms)
      ? inspection.staticTerms.reduce((sum, term) => sum + (Number(term.value) || 0), 0)
      : null;
    const components = Array.isArray(args.damageSummary?.components)
      ? args.damageSummary.components.map((c) => ({ type: c.type, value: c.total }))
      : null;
    payload.damage = {
      formula: inspection?.formula ?? null,
      dice,
      modifier: Number.isFinite(staticMod) ? staticMod : null,
      total: Number.isFinite(args.damageSummary?.total) ? args.damageSummary.total : null,
      components,
    };
  }

  if (!isSerializableStrikePayload(payload)) return { ok: false, reason: "serialization-failure" };
  return { ok: true, payload: cloneSerializable(payload) };
}

function rememberDelivery(summary) {
  deliveriesByTransactionId.set(summary.transactionId, summary);
  while (deliveriesByTransactionId.size > MAX_RECENT) {
    const oldest = deliveriesByTransactionId.keys().next().value;
    deliveriesByTransactionId.delete(oldest);
  }
}

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function hasStrikeDelivery(transactionId) {
  if (!transactionId) return false;
  const entry = deliveriesByTransactionId.get(transactionId);
  return entry?.state === STRIKE_DELIVERY_STATES.DELIVERED;
}

/**
 * @param {string} transactionId
 * @returns {object|null}
 */
export function getStrikeDeliveryRecord(transactionId) {
  return deliveriesByTransactionId.get(transactionId) ?? null;
}

/**
 * Single delivery operation — presentation hook XOR impact broadcast.
 * Marks delivered before invoking external listeners/APIs.
 * @param {object} args
 * @returns {{ delivered: boolean, path?: string, reason?: string }}
 */
export function deliverStrikeToNelCine(args = {}) {
  const transactionId = args.transactionId;
  if (!transactionId) return { delivered: false, reason: "missing-transaction-id" };

  const existing = deliveriesByTransactionId.get(transactionId);
  if (existing?.state === STRIKE_DELIVERY_STATES.DELIVERED) {
    return { delivered: false, reason: "already-delivered", path: existing.path };
  }

  const path =
    args.path === STRIKE_DELIVERY_PATHS.IMPACT_SYNC
      ? STRIKE_DELIVERY_PATHS.IMPACT_SYNC
      : STRIKE_DELIVERY_PATHS.PRESENTATION;

  const payload = args.payload;
  if (!payload || !isSerializableStrikePayload(payload)) {
    rememberDelivery({
      transactionId,
      state: STRIKE_DELIVERY_STATES.FAILED,
      path,
      createdAt: args.createdAt ?? Date.now(),
      deliveredAt: null,
      reason: "invalid-payload",
      degree: args.degree ?? null,
    });
    return { delivered: false, reason: "invalid-payload", path };
  }

  const now = args.now ?? Date.now();
  const summary = {
    transactionId,
    state: STRIKE_DELIVERY_STATES.DELIVERED,
    path,
    createdAt: args.createdAt ?? now,
    deliveredAt: now,
    reason: null,
    degree: args.degree ?? payload.attack?.degreeOfSuccess ?? null,
  };
  // Mark before external work so throwing listeners cannot retry.
  rememberDelivery(summary);

  try {
    if (path === STRIKE_DELIVERY_PATHS.IMPACT_SYNC) {
      const broadcast = args.broadcast;
      if (typeof broadcast !== "function") {
        summary.state = STRIKE_DELIVERY_STATES.FAILED;
        summary.reason = "missing-broadcast-api";
        rememberDelivery(summary);
        return { delivered: false, reason: "missing-broadcast-api", path };
      }
      const result = broadcast(payload, args.broadcastOptions ?? {});
      if (typeof args.onBroadcastPromise === "function") {
        args.onBroadcastPromise(result);
      }
    } else {
      const callAll =
        args.hooksCallAll ??
        (typeof Hooks !== "undefined" && typeof Hooks.callAll === "function"
          ? Hooks.callAll.bind(Hooks)
          : null);
      if (typeof callAll !== "function") {
        summary.state = STRIKE_DELIVERY_STATES.FAILED;
        summary.reason = "hooks-unavailable";
        rememberDelivery(summary);
        return { delivered: false, reason: "hooks-unavailable", path };
      }
      callAll(NELCINE_STRIKE_RESOLVED_HOOK, payload);
    }
  } catch (error) {
    summary.reason = "external-listener-failed";
    rememberDelivery(summary);
    logger.error(`${LOG_PREFIX} External delivery failed`, {
      stage: "nelcine-strike-delivery",
      transactionId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { delivered: true, reason: "external-listener-failed", path };
  }

  if (typeof strikeWatcher === "function") {
    try {
      strikeWatcher({
        transactionId,
        degree: summary.degree,
        path,
        state: summary.state,
      });
    } catch {
      /* watcher failures are non-fatal */
    }
  }

  return { delivered: true, path };
}

/**
 * Record a skipped delivery without emitting.
 * @param {object} args
 */
export function skipStrikeDelivery(args = {}) {
  if (!args.transactionId) return;
  if (hasStrikeDelivery(args.transactionId)) return;
  rememberDelivery({
    transactionId: args.transactionId,
    state: STRIKE_DELIVERY_STATES.SKIPPED,
    path: args.path ?? null,
    createdAt: Date.now(),
    deliveredAt: null,
    reason: args.reason ?? "skipped",
    degree: args.degree ?? null,
  });
}

/**
 * High-level helper used by resolvers after mechanics finalize.
 * Presentation-only path; never used for impact-sync transactions.
 * @param {object} args
 * @returns {{ delivered: boolean, reason?: string }}
 */
export function tryDeliverStrikePresentation(args = {}) {
  try {
    if (args.multiTarget === true) {
      skipStrikeDelivery({
        transactionId: args.transactionId,
        reason: "multi-target-unsupported",
        degree: args.outcome,
      });
      return { delivered: false, reason: "multi-target-unsupported" };
    }

    const gate = canDeliverStrikePresentation({
      transactionId: args.transactionId,
      multiTarget: false,
      impactSyncSelected: args.impactSyncSelected === true,
      hasAuthoritativeAttack: true,
    });
    if (!gate.eligible) {
      skipStrikeDelivery({
        transactionId: args.transactionId,
        reason: gate.reason,
        degree: args.outcome,
      });
      return { delivered: false, reason: gate.reason };
    }

    const built = buildStrikePresentationPayload(args);
    if (!built.ok) {
      skipStrikeDelivery({
        transactionId: args.transactionId,
        reason: built.reason,
        degree: args.outcome,
      });
      return { delivered: false, reason: built.reason };
    }

    return deliverStrikeToNelCine({
      transactionId: args.transactionId,
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      payload: built.payload,
      degree: built.payload.attack?.degreeOfSuccess ?? args.outcome ?? null,
      hooksCallAll: args.hooksCallAll,
    });
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected presentation failure`, {
      stage: "nelcine-strike-delivery",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { delivered: false, reason: "internal-exception" };
  }
}

/**
 * Impact-sync delivery via direct broadcast. Marks the transaction so the
 * ordinary hook cannot also fire.
 * @param {object} args
 * @returns {{ delivered: boolean, reason?: string }}
 */
export function tryDeliverStrikeImpactSync(args = {}) {
  try {
    if (hasStrikeDelivery(args.transactionId)) {
      return { delivered: false, reason: "already-delivered" };
    }
    return deliverStrikeToNelCine({
      transactionId: args.transactionId,
      path: STRIKE_DELIVERY_PATHS.IMPACT_SYNC,
      payload: args.payload,
      broadcast: args.broadcast,
      broadcastOptions: args.broadcastOptions,
      onBroadcastPromise: args.onBroadcastPromise,
      degree: args.payload?.attack?.degreeOfSuccess ?? null,
    });
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected impact-sync delivery failure`, {
      stage: "nelcine-strike-delivery",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { delivered: false, reason: "internal-exception" };
  }
}

/**
 * Impact sync requires presentation setting as well as impact setting.
 * @param {object} args
 * @returns {object}
 */
export function canUseNelcineImpactSyncWithPresentation(args = {}) {
  let strikeCinematics = false;
  try {
    strikeCinematics = getSetting(SETTINGS.NELCINE_STRIKE_CINEMATICS) === true;
  } catch {
    strikeCinematics = false;
  }
  if (!strikeCinematics) {
    return {
      eligible: false,
      reason: "strike-cinematics-disabled",
      runtime: detectNelcineRuntime(),
    };
  }
  // Re-export gate from impact bridge after injecting presentation requirement
  // is handled by caller via evaluateNelcineImpactEligibility + this check.
  return {
    eligible: true,
    reason: null,
    runtime: detectNelcineRuntime(),
    strikeCinematicsEnabled: true,
  };
}

/**
 * Combined live impact gate: presentation on + impact sync eligibility.
 * @param {object} args from canUseNelcineImpactSync
 * @param {Function} canUseNelcineImpactSync
 * @returns {object}
 */
export function evaluateImpactSyncDeliveryGate(args, canUseNelcineImpactSync) {
  const presentation = canUseNelcineImpactSyncWithPresentation();
  if (!presentation.eligible) return presentation;
  return canUseNelcineImpactSync(args);
}

/** @returns {object} */
export function getNelcineIntegrationStatus() {
  const runtime = detectNelcineRuntime();
  let strikeCinematicsEnabled = false;
  let impactSyncEnabled = false;
  try {
    strikeCinematicsEnabled = getSetting(SETTINGS.NELCINE_STRIKE_CINEMATICS) === true;
  } catch {
    strikeCinematicsEnabled = false;
  }
  try {
    impactSyncEnabled = getSetting(SETTINGS.NELCINE_IMPACT_SYNC) === true;
  } catch {
    impactSyncEnabled = false;
  }
  return {
    available: game.modules?.get?.(NELCINE_MODULE_ID) != null,
    active: runtime.active === true,
    strikeCinematicsEnabled,
    impactSyncEnabled,
    compatible: runtime.active === true && runtime.hasImpactContract === true,
    isPrimaryGM: runtime.hasBroadcastApi
      ? runtime.isPrimaryGM
      : typeof game.nelcine?.sync?.isPrimaryGM === "function"
        ? Boolean(game.nelcine.sync.isPrimaryGM())
        : null,
    recentStrikeDeliveries: [...deliveriesByTransactionId.values()].filter(
      (entry) => entry.state === STRIKE_DELIVERY_STATES.DELIVERED,
    ).length,
  };
}

/**
 * GM-only safe delivery diagnostic.
 * @param {string} transactionId
 * @returns {object|null}
 */
export function getStrikeDeliveryDiagnostic(transactionId) {
  if (game.user?.isGM !== true) return null;
  if (typeof transactionId !== "string" || !transactionId) return null;
  const entry = deliveriesByTransactionId.get(transactionId);
  if (!entry) return null;
  return cloneSerializable({
    transactionId: entry.transactionId,
    state: entry.state,
    path: entry.path,
    createdAt: entry.createdAt,
    deliveredAt: entry.deliveredAt,
    reason: entry.reason,
  });
}

/** @returns {boolean} */
export function watchNelCineStrikes() {
  if (game.user?.isGM !== true) return false;
  if (strikeWatcher) return true;
  strikeWatcher = (summary) => {
    console.debug(LOG_PREFIX, "delivery", {
      transactionId: String(summary.transactionId ?? "").slice(-12),
      degree: summary.degree,
      path: summary.path,
      state: summary.state,
    });
  };
  return true;
}

/** @returns {boolean} */
export function stopWatchingNelCineStrikes() {
  const had = Boolean(strikeWatcher);
  strikeWatcher = null;
  return had;
}

/** Test helper */
export function clearStrikeDeliveries() {
  deliveriesByTransactionId.clear();
  strikeWatcher = null;
}

/** Test helper */
export function seedStrikeDelivery(summary) {
  rememberDelivery(summary);
}

// Re-export eligibility helper for tests that need the pure impact check.
export { evaluateNelcineImpactEligibility };

/**
 * Install game.nelflow NelCine integration surfaces (Strike + save-batch).
 * Safe to call once from ready.
 */
export function installNelcinePublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};

  installSaveBatchPublicApi();
  installSaveBatchImpactPublicApi();

  root.integrations.nelcine = Object.freeze({
    getStatus: () => {
      const strike = getNelcineIntegrationStatus();
      const batches = getSaveBatchIntegrationStatus();
      let liveToolbelt = { version: null, supported: false };
      try {
        liveToolbelt = ToolbeltTargetHelperAdapter.status();
      } catch {
        /* absent Toolbelt is fine */
      }
      let saveBatchImpactSyncEnabled = false;
      try {
        saveBatchImpactSyncEnabled = getSetting(SETTINGS.NELCINE_SAVE_BATCH_IMPACT_SYNC) === true;
      } catch {
        saveBatchImpactSyncEnabled = false;
      }
      let effectMasterEnabled = true;
      try {
        effectMasterEnabled = getSetting(SETTINGS.NELCINE_EFFECT_CINEMATICS) !== false;
      } catch {
        effectMasterEnabled = true;
      }
      return {
        available: strike.available,
        active: strike.active,
        strikeCinematicsEnabled: strike.strikeCinematicsEnabled,
        impactSyncEnabled: strike.impactSyncEnabled,
        compatible: strike.compatible,
        isPrimaryGM: strike.isPrimaryGM,
        toolbeltVersion: liveToolbelt.version ?? null,
        toolbeltCompatible: liveToolbelt.supported === true,
        recentStrikeDeliveries: strike.recentStrikeDeliveries,
        saveBatchEnabled: batches.enabled,
        saveBatchImpactSyncEnabled,
        recentSaveBatchDeliveries: batches.recentEmittedCount,
        pendingSaveBatchImpactCount: getPendingImpactStatus().pendingBatchCount,
        effectCinematicsEnabled: effectMasterEnabled,
      };
    },
    getStrikeDelivery: (transactionId) => getStrikeDeliveryDiagnostic(transactionId),
    getSaveBatch: (transactionId) => getSaveBatchDiagnostic(transactionId),
  });

  root.dev.watchNelCineStrikes = () => watchNelCineStrikes();
  root.dev.stopWatchingNelCineStrikes = () => stopWatchingNelCineStrikes();
}
