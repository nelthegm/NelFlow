/**
 * NelCine multi-target basic-save batch bridge (0.9.0).
 * Presentation only — never applies HP, conditions, or Undo.
 * Emission occurs after NelFlow target applications reach a terminal state.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { buildDamageRollInspection } from "./strike-roll-inspection.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { TOOLBELT_TARGET_STATES, TERMINAL_TOOLBELT_STATES } from "./toolbelt-basic-save-model.js";
import { RESOLVER_PHASES, TERMINAL_APPLICATION_STATES, activeOutcome } from "./save-resolver-model.js";

export const NELCINE_MODULE_ID = "nelcine";
export const NELCINE_SAVE_BATCH_HOOK = "nelflow.basicSaveBatchResolved";
export const FALLBACK_BATCH_ID_PREFIX = "nelflow-save-batch-";
export const MAX_BATCH_TARGETS = 24;
export const DEFAULT_MIN_TARGETS = 2;
export const SAVE_BATCH_LOG_PREFIX = "NelFlow | NelCine Save Batch |";

const SUPPORTED_SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
const DEGREE_TO_NUMBER = Object.freeze({
  criticalFailure: 0,
  failure: 1,
  success: 2,
  criticalSuccess: 3,
});
const MULTIPLIER_TO_OUTCOME = Object.freeze({
  0: "none",
  0.5: "half",
  1: "full",
  2: "double",
});

const MAX_RECENT = 40;
const MAX_FAILED = 20;
const MAX_CONSEQUENCES = 6;

/** @type {Map<string, object>} */
const emittedByTransactionId = new Map();
/** @type {Map<string, object>} */
const pendingByTransactionId = new Map();
/** @type {object[]} */
const failedBatches = [];
/** @type {((summary: object) => void)|null} */
let watcher = null;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampSaveBatchMinimumTargets(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MIN_TARGETS;
  return Math.min(MAX_BATCH_TARGETS, Math.max(DEFAULT_MIN_TARGETS, Math.round(n)));
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeSaveType(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (SUPPORTED_SAVE_TYPES.has(key)) return key;
  if (key === "fort" || key === "fortitude-save") return "fortitude";
  if (key === "ref" || key === "reflex-save") return "reflex";
  if (key === "wil" || key === "will-save") return "will";
  return null;
}

/**
 * Preserve authoritative degree; never recompute from DC.
 * @param {unknown} value
 * @returns {number|string|null}
 */
export function normalizeDegreeOfSuccess(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) {
    return value;
  }
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(DEGREE_TO_NUMBER, value)) {
    return DEGREE_TO_NUMBER[value];
  }
  return null;
}

/**
 * Map mechanical multiplier → presentation outcome. Custom when unmatched.
 * @param {unknown} multiplier
 * @returns {"none"|"half"|"full"|"double"|"custom"|null}
 */
export function mapMultiplierToOutcome(multiplier) {
  if (multiplier == null) return null;
  const key = Number(multiplier);
  if (!Number.isFinite(key)) return "custom";
  return MULTIPLIER_TO_OUTCOME[key] ?? "custom";
}

/**
 * Pure eligibility for batch emission.
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateSaveBatchEligibility(ctx = {}) {
  if (ctx.settingEnabled !== true) return { eligible: false, reason: "setting-disabled" };
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.nelcineActive !== true) return { eligible: false, reason: "nelcine-inactive" };
  if (ctx.primaryGmApiAvailable === true && ctx.isPrimaryGM !== true) {
    return { eligible: false, reason: "not-primary-gm" };
  }
  if (ctx.supportedWorkflow !== true) return { eligible: false, reason: "unsupported-workflow" };
  if (ctx.batchComplete !== true) return { eligible: false, reason: "batch-incomplete" };
  if (!ctx.transactionId) return { eligible: false, reason: "missing-transaction-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  const minTargets = clampSaveBatchMinimumTargets(ctx.minimumTargets);
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
  return { eligible: true };
}

/**
 * Live NelCine feature detection. Absence is not an error.
 * @returns {object}
 */
export function detectNelcineSaveBatchRuntime() {
  const active = game.modules?.get?.(NELCINE_MODULE_ID)?.active === true;
  const api = game.nelcine ?? null;
  const primaryGmApiAvailable = typeof api?.sync?.isPrimaryGM === "function";
  const isPrimaryGM = primaryGmApiAvailable ? Boolean(api.sync.isPrimaryGM()) : null;
  return {
    active,
    primaryGmApiAvailable,
    isPrimaryGM,
    available: active,
  };
}

/**
 * Prefer existing group IDs; otherwise allocate a prefixed fallback once.
 * @param {{ existingId?: string|null, generateId?: () => string }} args
 * @returns {string}
 */
export function resolveBatchTransactionId({ existingId = null, generateId = null } = {}) {
  if (typeof existingId === "string" && existingId.trim()) return existingId.trim();
  const suffix =
    typeof generateId === "function"
      ? generateId()
      : typeof foundry?.utils?.randomID === "function"
        ? foundry.utils.randomID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${FALLBACK_BATCH_ID_PREFIX}${suffix}`;
}

/**
 * Prefer per-target application ID, then save ID, then derived stable ID.
 * @param {object} args
 * @returns {string}
 */
export function resolveResultId({
  applicationId = null,
  saveResolutionId = null,
  transactionId,
  targetTokenUuid = null,
} = {}) {
  if (typeof applicationId === "string" && applicationId.trim()) return applicationId.trim();
  if (typeof saveResolutionId === "string" && saveResolutionId.trim()) {
    return saveResolutionId.trim();
  }
  const tokenPart =
    typeof targetTokenUuid === "string" && targetTokenUuid.trim()
      ? targetTokenUuid.trim()
      : "unknown-target";
  return `${transactionId}:result:${tokenPart}`;
}

/**
 * @param {object[]} targets
 * @returns {{ ok: boolean, duplicates?: string[] }}
 */
export function ensureUniqueResultIds(targets) {
  const seen = new Set();
  const duplicates = [];
  for (const target of targets) {
    const id = target?.resultId;
    if (typeof id !== "string" || !id) {
      duplicates.push(String(id));
      continue;
    }
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }
  return duplicates.length ? { ok: false, duplicates } : { ok: true };
}

/**
 * Safer initial truncation: first 24 in authoritative order.
 * @param {object[]} targets
 * @returns {{ targets: object[], truncated: boolean }}
 */
export function truncateBatchTargets(targets) {
  const list = Array.isArray(targets) ? targets : [];
  if (list.length <= MAX_BATCH_TARGETS) return { targets: list, truncated: false };
  return { targets: list.slice(0, MAX_BATCH_TARGETS), truncated: true };
}

/**
 * Bound consequence labels; never infer from descriptions.
 * @param {unknown} consequences
 * @returns {string[]}
 */
export function normalizeConsequences(consequences) {
  if (!Array.isArray(consequences)) return [];
  return consequences
    .filter((entry) => typeof entry === "string" && entry.trim())
    .map((entry) => entry.trim())
    .slice(0, MAX_CONSEQUENCES);
}

/**
 * Serialize shared damage presentation data without Roll objects.
 * @param {object} args
 * @returns {object|null}
 */
export function serializeSharedDamageRoll({
  formula = null,
  dice = null,
  modifier = null,
  rolledTotal = null,
  components = null,
  damageMessage = null,
  damageSummary = null,
  rollIndex = 0,
} = {}) {
  let inspection = null;
  if (damageMessage) {
    try {
      inspection = buildDamageRollInspection({ message: damageMessage });
    } catch {
      inspection = null;
    }
  }
  const summary =
    damageSummary ??
    (damageMessage?.rolls?.at?.(rollIndex)
      ? PF2eAdapter.summarizeDamageRoll(damageMessage.rolls.at(rollIndex))
      : null);

  const serializedDice = Array.isArray(dice)
    ? dice
        .filter((die) => Number.isFinite(die?.faces) && Number.isFinite(die?.result))
        .map((die) => ({ faces: die.faces, result: die.result }))
    : Array.isArray(inspection?.dice)
      ? inspection.dice
          .filter((die) => Number.isFinite(die.faces) && Number.isFinite(die.kept))
          .map((die) => ({ faces: die.faces, result: die.kept }))
      : null;

  const staticMod = Number.isFinite(modifier)
    ? modifier
    : Array.isArray(inspection?.staticTerms)
      ? inspection.staticTerms.reduce((sum, term) => sum + (Number(term.value) || 0), 0)
      : null;

  const serializedComponents = Array.isArray(components)
    ? components
        .filter((c) => typeof c?.type === "string" && Number.isFinite(c?.value))
        .map((c) => ({ type: c.type, value: c.value }))
    : Array.isArray(summary?.components)
      ? summary.components
          .filter((c) => typeof c?.type === "string" && Number.isFinite(c?.total))
          .map((c) => ({ type: c.type, value: c.total }))
      : null;

  const total = Number.isFinite(rolledTotal)
    ? rolledTotal
    : Number.isFinite(summary?.total)
      ? summary.total
      : Number.isFinite(inspection?.total)
        ? inspection.total
        : null;

  const out = {
    formula:
      typeof formula === "string" && formula.trim()
        ? formula.trim()
        : typeof inspection?.formula === "string"
          ? inspection.formula
          : null,
    dice: serializedDice,
    modifier: Number.isFinite(staticMod) ? staticMod : null,
    rolledTotal: total,
    components: serializedComponents,
  };

  if (out.formula == null && out.rolledTotal == null && !out.dice?.length) return null;
  return out;
}

/**
 * Non-negative presentation magnitude from HP delta / applied amount.
 * @param {unknown} value
 * @returns {number|undefined}
 */
export function appliedTotalFromRecord(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.abs(n));
}

/**
 * Deep-clone JSON-safe presentation data. Rejects functions / documents.
 * @param {unknown} value
 * @returns {unknown}
 */
export function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} payload
 * @returns {boolean}
 */
export function isSerializablePayload(payload) {
  try {
    const cloned = cloneSerializable(payload);
    return Boolean(cloned) && typeof cloned === "object";
  } catch {
    return false;
  }
}

/**
 * Build the NelCine schemaVersion-1 saveBatch payload. Does not mutate inputs.
 * @param {object} input
 * @returns {{ ok: true, payload: object, truncated: boolean }|{ ok: false, reason: string, error?: string }}
 */
export function buildSaveBatchPayload(input) {
  const transactionId =
    typeof input?.transactionId === "string" && input.transactionId.trim()
      ? input.transactionId.trim()
      : null;
  if (!transactionId) return { ok: false, reason: "missing-transaction-id" };

  const saveType = normalizeSaveType(input.saveType);
  if (!saveType) return { ok: false, reason: "unsupported-save-type" };

  const sourceTargets = Array.isArray(input.targets) ? input.targets : [];
  const prepared = [];
  for (let index = 0; index < sourceTargets.length; index += 1) {
    const entry = sourceTargets[index];
    const degree = normalizeDegreeOfSuccess(entry?.degreeOfSuccess ?? entry?.save?.degreeOfSuccess);
    if (degree == null) continue;

    const tokenUuid =
      typeof entry.targetTokenUuid === "string" && entry.targetTokenUuid.trim()
        ? entry.targetTokenUuid.trim()
        : null;
    const actorUuid =
      typeof entry.targetActorUuid === "string" && entry.targetActorUuid.trim()
        ? entry.targetActorUuid.trim()
        : null;
    if (!tokenUuid && !actorUuid) continue;

    const resultId = resolveResultId({
      applicationId: entry.applicationId ?? entry.resultId,
      saveResolutionId: entry.saveResolutionId,
      transactionId,
      targetTokenUuid: tokenUuid,
    });

    const damage = {};
    const applied = appliedTotalFromRecord(entry.appliedTotal ?? entry.actualHpDelta);
    if (applied !== undefined) damage.appliedTotal = applied;
    const outcome =
      entry.outcome ??
      mapMultiplierToOutcome(entry.multiplier) ??
      null;
    if (outcome) damage.outcome = outcome;
    if (Array.isArray(entry.damageComponents) && entry.damageComponents.length) {
      damage.components = entry.damageComponents
        .filter((c) => typeof c?.type === "string" && Number.isFinite(c?.value))
        .map((c) => ({ type: c.type, value: c.value }));
    }

    prepared.push({
      resultId,
      order: Number.isInteger(entry.order) ? entry.order : index,
      targetTokenUuid: tokenUuid,
      targetActorUuid: actorUuid,
      save: {
        dieResult: Number.isFinite(entry.save?.dieResult) ? entry.save.dieResult : null,
        modifier: Number.isFinite(entry.save?.modifier) ? entry.save.modifier : null,
        total: Number.isFinite(entry.save?.total) ? entry.save.total : null,
        degreeOfSuccess: degree,
      },
      damage,
      consequences: normalizeConsequences(entry.consequences),
    });
  }

  if (!prepared.length) return { ok: false, reason: "no-authoritative-targets" };

  prepared.sort((a, b) => a.order - b.order);
  for (let i = 0; i < prepared.length; i += 1) prepared[i].order = i;

  const uniqueness = ensureUniqueResultIds(prepared);
  if (!uniqueness.ok) {
    return {
      ok: false,
      reason: "duplicate-result-ids",
      error: uniqueness.duplicates.join(","),
    };
  }

  const { targets, truncated } = truncateBatchTargets(prepared);
  const damageRoll =
    input.damageRoll ??
    serializeSharedDamageRoll({
      formula: input.damageFormula,
      dice: input.damageDice,
      modifier: input.damageModifier,
      rolledTotal: input.damageRolledTotal,
      components: input.damageComponents,
      damageMessage: input.damageMessage,
      damageSummary: input.damageSummary,
      rollIndex: input.rollIndex ?? 0,
    });

  if (!damageRoll) return { ok: false, reason: "missing-shared-damage-roll" };

  const payload = {
    schemaVersion: 1,
    transactionId,
    type: "saveBatch",
    sourceTokenUuid:
      typeof input.sourceTokenUuid === "string" && input.sourceTokenUuid.trim()
        ? input.sourceTokenUuid.trim()
        : null,
    sourceActorUuid:
      typeof input.sourceActorUuid === "string" && input.sourceActorUuid.trim()
        ? input.sourceActorUuid.trim()
        : null,
    itemUuid:
      typeof input.itemUuid === "string" && input.itemUuid.trim()
        ? input.itemUuid.trim()
        : null,
    effectName:
      typeof input.effectName === "string" && input.effectName.trim()
        ? input.effectName.trim()
        : null,
    save: {
      type: saveType,
      dc: Number.isFinite(input.saveDc) ? input.saveDc : null,
      dcPublic: input.dcPublic === true,
    },
    damageRoll,
    targets,
  };

  if (truncated) payload.truncated = true;

  if (!isSerializablePayload(payload)) {
    return { ok: false, reason: "serialization-failure" };
  }

  return { ok: true, payload: cloneSerializable(payload), truncated };
}

function rememberEmitted(summary) {
  emittedByTransactionId.set(summary.transactionId, summary);
  while (emittedByTransactionId.size > MAX_RECENT) {
    const oldest = emittedByTransactionId.keys().next().value;
    emittedByTransactionId.delete(oldest);
  }
}

function rememberFailed(summary) {
  failedBatches.unshift(summary);
  while (failedBatches.length > MAX_FAILED) failedBatches.pop();
}

function batchLog(level, message, context = {}) {
  const text = `${SAVE_BATCH_LOG_PREFIX} ${message}`;
  if (level === "error") logger.error(text, { stage: "nelcine-save-batch", ...context });
  else if (level === "warn") logger.warn(text, { stage: "nelcine-save-batch", ...context });
  else logger.debug(text, { stage: "nelcine-save-batch", ...context });
}

/**
 * Mark emitted before calling Hooks; never retry on listener failure.
 * @param {object} payload
 * @param {{ hooksCallAll?: Function, now?: () => number }} deps
 * @returns {{ emitted: boolean, reason?: string }}
 */
export function emitSaveBatchResolved(payload, deps = {}) {
  const transactionId = payload?.transactionId;
  if (!transactionId) return { emitted: false, reason: "missing-transaction-id" };
  if (emittedByTransactionId.has(transactionId)) {
    return { emitted: false, reason: "already-emitted" };
  }

  const now = deps.now ?? (() => Date.now());
  const summary = {
    transactionId,
    state: "emitted",
    targetCount: payload.targets?.length ?? 0,
    completedTargetCount: payload.targets?.length ?? 0,
    emittedAt: now(),
    truncated: payload.truncated === true,
    error: null,
  };
  rememberEmitted(summary);
  pendingByTransactionId.delete(transactionId);

  const callAll =
    deps.hooksCallAll ??
    (typeof Hooks !== "undefined" && typeof Hooks.callAll === "function"
      ? Hooks.callAll.bind(Hooks)
      : null);

  try {
    if (typeof callAll === "function") callAll(NELCINE_SAVE_BATCH_HOOK, payload);
  } catch (error) {
    summary.error = "hook-listener-failed";
    rememberEmitted(summary);
    batchLog("error", "External hook listener failed", {
      transactionId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: true, reason: "hook-listener-failed" };
  }

  if (typeof watcher === "function") {
    try {
      watcher({
        transactionId,
        targetCount: summary.targetCount,
        truncated: summary.truncated,
        saveType: payload.save?.type ?? null,
        // Never expose DC or actor identities to the watcher summary for players;
        // watchers themselves are GM-gated at the public API.
      });
    } catch {
      /* watcher failures are non-fatal */
    }
  }

  return { emitted: true };
}

/**
 * Live eligibility for the current client.
 * @param {object} args
 * @returns {{ eligible: boolean, reason?: string, runtime?: object, minimumTargets?: number }}
 */
export function canEmitSaveBatch(args = {}) {
  const runtime = detectNelcineSaveBatchRuntime();
  let settingEnabled = false;
  let minimumTargets = DEFAULT_MIN_TARGETS;
  try {
    settingEnabled = getSetting(SETTINGS.NELCINE_SAVE_BATCH_CINEMATICS) === true;
  } catch {
    settingEnabled = false;
  }
  try {
    minimumTargets = clampSaveBatchMinimumTargets(
      getSetting(SETTINGS.NELCINE_SAVE_BATCH_MINIMUM_TARGETS),
    );
  } catch {
    minimumTargets = DEFAULT_MIN_TARGETS;
  }

  const result = evaluateSaveBatchEligibility({
    settingEnabled,
    isGM: game.user?.isGM === true,
    nelcineActive: runtime.active,
    primaryGmApiAvailable: runtime.primaryGmApiAvailable,
    isPrimaryGM: runtime.isPrimaryGM === true,
    supportedWorkflow: args.supportedWorkflow === true,
    batchComplete: args.batchComplete === true,
    transactionId: args.transactionId,
    alreadyEmitted:
      emittedByTransactionId.has(args.transactionId) || args.alreadyEmitted === true,
    minimumTargets,
    targetCount: args.targetCount,
    saveType: args.saveType,
    hasSharedDamageRoll: args.hasSharedDamageRoll !== false,
    hasAuthoritativeDegrees: args.hasAuthoritativeDegrees === true,
  });
  return { ...result, runtime, minimumTargets };
}

function toolbeltTargetIsPresentable(record) {
  if (!record) return false;
  if (!TERMINAL_TOOLBELT_STATES.has(record.state)) return false;
  return normalizeDegreeOfSuccess(record.effectiveOutcome ?? record.nativeOutcome) != null;
}

/**
 * Collect READY/AWAITING_IMPACT targets for pre-HP batch preparation.
 * Does not require terminal application state.
 * @param {object} draft
 * @param {object|null} normalized
 * @param {string[]} [keys]
 * @returns {object[]}
 */
export function collectToolbeltPreparedBatchTargets(draft, normalized = null, keys = null) {
  const orderKeys = Array.isArray(keys) && keys.length
    ? keys
    : Array.isArray(draft?.targetOrder)
      ? draft.targetOrder
      : Object.keys(draft?.targets ?? {});
  const saveByKey = new Map(
    (normalized?.targets ?? []).map((target) => [target.toolbeltTargetKey, target]),
  );
  const rawSaves = normalized?.message
    ? (() => {
        try {
          const data = normalized.message.flags?.["pf2e-toolbelt"]?.targetHelper;
          const variants = Object.values(data?.saveVariants ?? {});
          const basic = variants.find((save) => save?.basic === true);
          return basic?.saves ?? {};
        } catch {
          return {};
        }
      })()
    : {};

  const targets = [];
  for (let index = 0; index < orderKeys.length; index += 1) {
    const key = orderKeys[index];
    const record = draft.targets?.[key];
    if (
      !record ||
      ![
        TOOLBELT_TARGET_STATES.READY,
        TOOLBELT_TARGET_STATES.AWAITING_IMPACT,
        TOOLBELT_TARGET_STATES.CLAIMED,
      ].includes(record.state)
    ) {
      continue;
    }
    if (normalizeDegreeOfSuccess(record.effectiveOutcome ?? record.nativeOutcome) == null) {
      continue;
    }

    const tokenUuid =
      typeof record.tokenUuid === "string" && record.tokenUuid ? record.tokenUuid : null;
    const actorUuid =
      typeof record.actorUuid === "string" && record.actorUuid ? record.actorUuid : null;
    if (!tokenUuid && !actorUuid) continue;

    const toolbeltSave = rawSaves?.[key];
    const saveTotal = Number.isFinite(Number(toolbeltSave?.roll))
      ? Number(toolbeltSave.roll)
      : null;

    targets.push({
      applicationId: record.applicationId,
      resultId: record.applicationId,
      targetKey: key,
      order: Number.isInteger(saveByKey.get(key)?.order) ? saveByKey.get(key).order : index,
      targetTokenUuid: tokenUuid,
      targetActorUuid: actorUuid,
      degreeOfSuccess: record.effectiveOutcome ?? record.nativeOutcome,
      multiplier: record.multiplier,
      save: {
        dieResult: Number.isFinite(toolbeltSave?.dieResult) ? toolbeltSave.dieResult : null,
        modifier: Number.isFinite(toolbeltSave?.modifier) ? toolbeltSave.modifier : null,
        total: saveTotal,
      },
      consequences: [],
    });
  }
  return targets;
}

/**
 * Build presentation targets from a completed Toolbelt transaction draft.
 * Does not mutate the draft.
 * @param {object} draft
 * @param {object} [normalized]
 * @returns {object[]}
 */
export function collectToolbeltBatchTargets(draft, normalized = null) {
  const orderKeys = Array.isArray(draft?.targetOrder)
    ? draft.targetOrder
    : Object.keys(draft?.targets ?? {});
  const saveByKey = new Map(
    (normalized?.targets ?? []).map((target) => [target.toolbeltTargetKey, target]),
  );
  const rawSaves = normalized?.message
    ? (() => {
        try {
          const data = normalized.message.flags?.["pf2e-toolbelt"]?.targetHelper;
          const variants = Object.values(data?.saveVariants ?? {});
          const basic = variants.find((save) => save?.basic === true);
          return basic?.saves ?? {};
        } catch {
          return {};
        }
      })()
    : {};

  const targets = [];
  for (let index = 0; index < orderKeys.length; index += 1) {
    const key = orderKeys[index];
    const record = draft.targets?.[key];
    if (!toolbeltTargetIsPresentable(record)) continue;

    const tokenUuid =
      typeof record.tokenUuid === "string" && record.tokenUuid ? record.tokenUuid : null;
    const actorUuid =
      typeof record.actorUuid === "string" && record.actorUuid ? record.actorUuid : null;
    if (!tokenUuid && !actorUuid) continue;

    const toolbeltSave = rawSaves?.[key];
    const saveTotal = Number.isFinite(Number(toolbeltSave?.roll))
      ? Number(toolbeltSave.roll)
      : null;

    const applied =
      record.state === TOOLBELT_TARGET_STATES.APPLIED ||
      record.state === TOOLBELT_TARGET_STATES.NO_DAMAGE
        ? appliedTotalFromRecord(
            record.state === TOOLBELT_TARGET_STATES.NO_DAMAGE ? 0 : record.actualHpDelta,
          )
        : undefined;

    targets.push({
      applicationId: record.applicationId,
      order: Number.isInteger(saveByKey.get(key)?.order) ? saveByKey.get(key).order : index,
      targetTokenUuid: tokenUuid,
      targetActorUuid: actorUuid,
      degreeOfSuccess: record.effectiveOutcome ?? record.nativeOutcome,
      multiplier: record.multiplier,
      appliedTotal: applied,
      save: {
        dieResult: Number.isFinite(toolbeltSave?.dieResult) ? toolbeltSave.dieResult : null,
        modifier: Number.isFinite(toolbeltSave?.modifier) ? toolbeltSave.modifier : null,
        total: saveTotal,
      },
      consequences: [],
    });
  }
  return targets;
}

/**
 * Attempt batch emission after Toolbelt process() reaches phase complete.
 * Never throws into the mechanical path.
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string }}
 */
export function tryEmitToolbeltSaveBatch({ draft, message, normalized } = {}) {
  try {
    if (!draft || draft.phase !== "complete") {
      return { emitted: false, reason: "batch-incomplete" };
    }
    const transactionId = resolveBatchTransactionId({ existingId: draft.integrationId });
    if (draft.nelcineSaveBatchEmitted === true || emittedByTransactionId.has(transactionId)) {
      return { emitted: false, reason: "already-emitted" };
    }

    const targets = collectToolbeltBatchTargets(draft, normalized);
    const saveType = normalizeSaveType(draft.saveType ?? normalized?.saveType);
    const eligibility = canEmitSaveBatch({
      supportedWorkflow: true,
      batchComplete: true,
      transactionId,
      targetCount: targets.length,
      saveType,
      hasSharedDamageRoll: true,
      hasAuthoritativeDegrees: targets.every(
        (target) => normalizeDegreeOfSuccess(target.degreeOfSuccess) != null,
      ),
      alreadyEmitted: false,
    });
    if (!eligibility.eligible) return { emitted: false, reason: eligibility.reason };

    const sourceTokenUuid =
      message?.token?.document?.uuid ??
      message?.token?.uuid ??
      null;
    const effectName =
      typeof message?.item?.name === "string" && message.item.name.trim()
        ? message.item.name.trim()
        : null;

    const built = buildSaveBatchPayload({
      transactionId,
      saveType,
      saveDc: Number.isFinite(normalized?.saveDC) ? normalized.saveDC : null,
      dcPublic: false,
      sourceTokenUuid,
      sourceActorUuid: draft.sourceActorUuid ?? null,
      itemUuid: draft.sourceItemUuid ?? null,
      effectName,
      damageMessage: message,
      rollIndex: draft.rollIndex ?? 0,
      targets,
    });
    if (!built.ok) {
      rememberFailed({
        transactionId,
        state: "failed",
        targetCount: targets.length,
        completedTargetCount: targets.length,
        emittedAt: null,
        truncated: false,
        error: built.reason,
      });
      if (
        ["duplicate-result-ids", "serialization-failure", "missing-transaction-id"].includes(
          built.reason,
        )
      ) {
        batchLog("error", "Batch construction failed", {
          transactionId,
          reason: built.reason,
          error: built.error,
        });
      }
      return { emitted: false, reason: built.reason };
    }

    draft.nelcineSaveBatchEmitted = true;
    return emitSaveBatchResolved(built.payload);
  } catch (error) {
    batchLog("error", "Unexpected batch bridge failure", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * Collect legacy resolver targets for presentation.
 * @param {object} resolver
 * @returns {object[]}
 */
export function collectLegacyBatchTargets(resolver) {
  const targets = [];
  for (let index = 0; index < (resolver?.targets ?? []).length; index += 1) {
    const entry = resolver.targets[index];
    const outcome = activeOutcome(entry);
    if (!outcome) continue;
    if (!TERMINAL_APPLICATION_STATES.has(entry.applicationState) && entry.applicationState !== "error") {
      continue;
    }
    const tokenUuid =
      typeof entry.targetTokenUuid === "string" && entry.targetTokenUuid
        ? entry.targetTokenUuid
        : null;
    const actorUuid =
      typeof entry.targetActorUuid === "string" && entry.targetActorUuid
        ? entry.targetActorUuid
        : null;
    if (!tokenUuid && !actorUuid) continue;

    const applied =
      entry.applicationState === "applied" || entry.applicationState === "no-damage"
        ? appliedTotalFromRecord(
            entry.applicationState === "no-damage" ? 0 : entry.appliedAmount,
          )
        : undefined;

    targets.push({
      applicationId: entry.applicationId,
      saveResolutionId: entry.targetEntryId,
      order: index,
      targetTokenUuid: tokenUuid,
      targetActorUuid: actorUuid,
      degreeOfSuccess: outcome,
      multiplier: entry.damageMultiplier,
      appliedTotal: applied,
      save: {
        dieResult: Number.isFinite(entry.saveDieResult) ? entry.saveDieResult : null,
        modifier: Number.isFinite(entry.saveModifier) ? entry.saveModifier : null,
        total: Number.isFinite(entry.saveTotal) ? entry.saveTotal : null,
      },
      consequences: [],
    });
  }
  return targets;
}

/**
 * Attempt batch emission after legacy resolveDamage reaches a terminal parent phase.
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string }}
 */
export function tryEmitLegacySaveBatch({ resolver, resolverMessage, damageMessage } = {}) {
  try {
    if (
      !resolver ||
      ![RESOLVER_PHASES.COMPLETE, RESOLVER_PHASES.PARTIAL].includes(resolver.phase)
    ) {
      return { emitted: false, reason: "batch-incomplete" };
    }
    const transactionId = resolveBatchTransactionId({ existingId: resolver.resolverId });
    if (resolver.nelcineSaveBatchEmitted === true || emittedByTransactionId.has(transactionId)) {
      return { emitted: false, reason: "already-emitted" };
    }

    const targets = collectLegacyBatchTargets(resolver);
    const saveType = normalizeSaveType(resolver.save?.type);
    const eligibility = canEmitSaveBatch({
      supportedWorkflow: true,
      batchComplete: true,
      transactionId,
      targetCount: targets.length,
      saveType,
      hasSharedDamageRoll: Boolean(resolver.damage?.messageId),
      hasAuthoritativeDegrees: targets.every(
        (target) => normalizeDegreeOfSuccess(target.degreeOfSuccess) != null,
      ),
    });
    if (!eligibility.eligible) return { emitted: false, reason: eligibility.reason };

    const built = buildSaveBatchPayload({
      transactionId,
      saveType,
      saveDc: Number.isFinite(resolver.save?.dc) ? resolver.save.dc : null,
      dcPublic: resolver.save?.dcPublic === true,
      sourceTokenUuid: resolver.sourceTokenUuid ?? null,
      sourceActorUuid: resolver.sourceActorUuid ?? null,
      itemUuid: resolver.spellItemUuid ?? null,
      effectName:
        typeof resolver.spellName === "string" && resolver.spellName.trim()
          ? resolver.spellName.trim()
          : null,
      damageMessage: damageMessage ?? null,
      damageSummary: resolver.damage?.summary ?? null,
      targets,
    });
    if (!built.ok) {
      rememberFailed({
        transactionId,
        state: "failed",
        targetCount: targets.length,
        completedTargetCount: targets.length,
        emittedAt: null,
        truncated: false,
        error: built.reason,
      });
      if (
        ["duplicate-result-ids", "serialization-failure", "missing-transaction-id"].includes(
          built.reason,
        )
      ) {
        batchLog("error", "Batch construction failed", {
          transactionId,
          reason: built.reason,
        });
      }
      return { emitted: false, reason: built.reason };
    }

    resolver.nelcineSaveBatchEmitted = true;
    if (resolverMessage && typeof resolverMessage.setFlag === "function") {
      // Best-effort memory note only; message persistence is owned by the resolver.
    }
    return emitSaveBatchResolved(built.payload);
  } catch (error) {
    batchLog("error", "Unexpected legacy batch bridge failure", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * Safe public status summary.
 * @returns {object}
 */
export function getSaveBatchIntegrationStatus() {
  const runtime = detectNelcineSaveBatchRuntime();
  let enabled = false;
  try {
    enabled = getSetting(SETTINGS.NELCINE_SAVE_BATCH_CINEMATICS) === true;
  } catch {
    enabled = false;
  }
  return {
    available: runtime.available === true,
    active: runtime.active === true,
    enabled,
    compatible: runtime.active === true,
    isPrimaryGM: runtime.primaryGmApiAvailable ? runtime.isPrimaryGM === true : null,
    pendingBatchCount: pendingByTransactionId.size,
    recentEmittedCount: emittedByTransactionId.size,
  };
}

/**
 * GM-only diagnostic batch summary.
 * @param {string} transactionId
 * @returns {object|null}
 */
export function getSaveBatchDiagnostic(transactionId) {
  if (game.user?.isGM !== true) return null;
  if (typeof transactionId !== "string" || !transactionId) return null;
  const pending = pendingByTransactionId.get(transactionId);
  if (pending) {
    return cloneSerializable({
      transactionId,
      state: pending.state ?? "pending",
      targetCount: pending.targetCount ?? 0,
      completedTargetCount: pending.completedTargetCount ?? 0,
      emittedAt: null,
      truncated: pending.truncated === true,
      error: pending.error ?? null,
    });
  }
  const emitted = emittedByTransactionId.get(transactionId);
  if (emitted) return cloneSerializable(emitted);
  const failed = failedBatches.find((entry) => entry.transactionId === transactionId);
  return failed ? cloneSerializable(failed) : null;
}

/**
 * Developer inspection surface.
 * @returns {object}
 */
export function inspectSaveBatches() {
  if (game.user?.isGM !== true) {
    return { pending: [], recent: [], failed: [] };
  }
  return {
    pending: [...pendingByTransactionId.values()].map((entry) =>
      cloneSerializable({
        transactionId: entry.transactionId,
        state: entry.state ?? "pending",
        targetCount: entry.targetCount ?? 0,
        completedTargetCount: entry.completedTargetCount ?? 0,
        error: entry.error ?? null,
      }),
    ),
    recent: [...emittedByTransactionId.values()].map((entry) => cloneSerializable(entry)),
    failed: failedBatches.map((entry) => cloneSerializable(entry)),
  };
}

/**
 * @returns {boolean}
 */
export function watchSaveBatchCinematics() {
  if (game.user?.isGM !== true) return false;
  if (watcher) return true;
  watcher = (summary) => {
    console.debug(SAVE_BATCH_LOG_PREFIX, "emitted", {
      transactionId: String(summary.transactionId ?? "").slice(-12),
      targetCount: summary.targetCount,
      truncated: summary.truncated === true,
      saveType: summary.saveType,
    });
  };
  return true;
}

/**
 * @returns {boolean}
 */
export function stopWatchingSaveBatchCinematics() {
  const had = Boolean(watcher);
  watcher = null;
  return had;
}

/**
 * Install game.nelflow public surfaces. Safe to call once.
 */
export function installSaveBatchPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.integrations.nelcineSaveBatch = Object.freeze({
    getStatus: () => getSaveBatchIntegrationStatus(),
    getBatch: (transactionId) => getSaveBatchDiagnostic(transactionId),
  });
  root.dev = root.dev ?? {};
  root.dev.inspectSaveBatches = () => inspectSaveBatches();
  root.dev.watchSaveBatchCinematics = () => watchSaveBatchCinematics();
  root.dev.stopWatchingSaveBatchCinematics = () => stopWatchingSaveBatchCinematics();
}

/** Test helper: clear emission / pending registries. */
export function clearSaveBatchBridgeState() {
  emittedByTransactionId.clear();
  pendingByTransactionId.clear();
  failedBatches.length = 0;
  watcher = null;
}

/**
 * Test helper: seed an emitted record (bounded).
 * @param {object} summary
 */
export function seedEmittedSaveBatch(summary) {
  rememberEmitted(summary);
}
