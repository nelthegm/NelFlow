/**
 * Presentation-neutral basic-save target result feed (NelTactics compatibility).
 *
 * Emits Hooks.callAll("nelflow.basicSaveTargetResolvedPresentation", payload)
 * exactly once per authoritative Toolbelt target save result — as soon as the
 * target becomes READY, before HP application / NelCine / batch completion.
 *
 * Toolbelt owns save execution. NelFlow only observes durable results.
 * Presentation only: never rolls saves, mutates Toolbelt flags, or applies HP.
 */

import { logger } from "./logger.js";
import { applicationId } from "./toolbelt-basic-save-model.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";

export const BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK =
  "nelflow.basicSaveTargetResolvedPresentation";
export const BASIC_SAVE_PRESENTATION_PROTOCOL = 1;

const LOG_PREFIX = "NelFlow | Basic save presentation feed |";
const MAX_RECENT = 128;

/** @type {Map<string, { targetResultId: string, emittedAt: number }>} */
const emittedByTargetResultId = new Map();

/** @type {((summary: object) => void)|null} */
let feedWatcher = null;

/**
 * Capability statement for which roll fields this feed can publish when Toolbelt
 * provides them on the durable save instance.
 */
export const BASIC_SAVE_ROLL_FIELDS_AVAILABLE = Object.freeze({
  dieResult: true,
  modifier: true,
  total: true,
  degreeOfSuccess: true,
});

/**
 * @param {string} targetResultId
 * @returns {boolean}
 */
export function hasBasicSaveTargetPresentationEmission(targetResultId) {
  if (!targetResultId) return false;
  return emittedByTargetResultId.has(targetResultId);
}

/**
 * Stable identity for one authoritative Toolbelt save instance.
 * Includes saveFingerprint so Hero Point / rerolls publish as a new result.
 * @param {{ integrationId?: string, applicationId?: string, toolbeltTargetKey?: string, saveFingerprint?: string|null }} args
 * @returns {string|null}
 */
export function buildBasicSaveTargetResultId(args = {}) {
  const appId =
    typeof args.applicationId === "string" && args.applicationId.trim()
      ? args.applicationId.trim()
      : typeof args.integrationId === "string" && typeof args.toolbeltTargetKey === "string"
        ? applicationId(args.integrationId, args.toolbeltTargetKey)
        : null;
  if (!appId) return null;
  const fingerprint =
    typeof args.saveFingerprint === "string" && args.saveFingerprint.trim()
      ? args.saveFingerprint.trim()
      : "unknown";
  return `${appId}:fp:${fingerprint}`;
}

/**
 * Pure eligibility (no Toolbelt / NelCine gates beyond data shape).
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateBasicSaveTargetPresentationEligibility(ctx = {}) {
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (!ctx.targetResultId) return { eligible: false, reason: "missing-target-result-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  if (ctx.isBasicSave !== true) return { eligible: false, reason: "not-basic-save" };
  if (ctx.private === true) return { eligible: false, reason: "private-save" };
  if (!ctx.targetTokenUuid) return { eligible: false, reason: "missing-target-token" };
  if (!ctx.degreeOfSuccess) return { eligible: false, reason: "missing-degree" };
  if (!ctx.saveType) return { eligible: false, reason: "missing-save-type" };
  return { eligible: true };
}

/**
 * Build plain-data payload. Omits optional roll fields when unavailable.
 * @param {object} args
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 */
export function buildBasicSaveTargetPresentationPayload(args = {}) {
  const targetResultId = buildBasicSaveTargetResultId(args);
  if (!targetResultId) return { ok: false, reason: "missing-target-result-id" };
  if (!args.targetTokenUuid) return { ok: false, reason: "missing-target-token" };
  if (!args.degreeOfSuccess) return { ok: false, reason: "missing-degree" };
  if (!args.saveType) return { ok: false, reason: "missing-save-type" };

  const save = {
    type: args.saveType,
    basic: true,
  };
  if (Number.isFinite(args.saveDC)) {
    save.dc = Number(args.saveDC);
  }

  /** @type {Record<string, unknown>} */
  const roll = {
    degreeOfSuccess: args.degreeOfSuccess,
  };
  if (Number.isFinite(args.dieResult)) roll.dieResult = Number(args.dieResult);
  if (Number.isFinite(args.modifier)) roll.modifier = Number(args.modifier);
  if (Number.isFinite(args.total)) roll.total = Number(args.total);

  /** @type {Record<string, unknown>} */
  const payload = {
    schemaVersion: 1,
    stage: "targetResolved",
    batchId: args.integrationId ?? args.batchId ?? null,
    targetResultId,
    targetTokenUuid: args.targetTokenUuid,
    targetActorUuid: args.targetActorUuid ?? null,
    save,
    roll,
    createdAt: Number.isFinite(args.createdAt) ? args.createdAt : Date.now(),
  };

  if (typeof args.sceneId === "string" && args.sceneId) payload.sceneId = args.sceneId;
  if (typeof args.sourceTokenUuid === "string" && args.sourceTokenUuid) {
    payload.sourceTokenUuid = args.sourceTokenUuid;
  }
  if (typeof args.sourceActorUuid === "string" && args.sourceActorUuid) {
    payload.sourceActorUuid = args.sourceActorUuid;
  }
  if (typeof args.actionName === "string" && args.actionName) payload.actionName = args.actionName;
  if (typeof args.itemUuid === "string" && args.itemUuid) payload.itemUuid = args.itemUuid;
  if (typeof args.rerolled === "string" && args.rerolled) payload.rerolled = args.rerolled;

  try {
    JSON.stringify(payload);
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
}

/**
 * Emit once when a Toolbelt basic-save target becomes READY (or rerolls).
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string, hook?: string, targetResultId?: string }}
 */
export function tryEmitBasicSaveTargetPresentation(args = {}) {
  try {
    const targetResultId = buildBasicSaveTargetResultId(args);
    const gate = evaluateBasicSaveTargetPresentationEligibility({
      isGM: game.user?.isGM === true,
      targetResultId,
      alreadyEmitted: hasBasicSaveTargetPresentationEmission(targetResultId),
      isBasicSave: args.isBasicSave !== false,
      private: args.private === true,
      targetTokenUuid: args.targetTokenUuid ?? null,
      degreeOfSuccess: args.degreeOfSuccess ?? null,
      saveType: args.saveType ?? null,
    });
    if (!gate.eligible) {
      return { emitted: false, reason: gate.reason, targetResultId: targetResultId ?? undefined };
    }

    const built = buildBasicSaveTargetPresentationPayload({ ...args, targetResultId });
    if (!built.ok) {
      return { emitted: false, reason: built.reason, targetResultId };
    }

    rememberEmission(targetResultId);

    const callAll =
      args.hooksCallAll ??
      (typeof Hooks !== "undefined" && typeof Hooks.callAll === "function"
        ? Hooks.callAll.bind(Hooks)
        : null);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable", targetResultId };
    }

    try {
      callAll(BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK, built.payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Listener failed`, {
        stage: "basic-save-presentation-feed",
        targetResultId,
        reason: error instanceof Error ? error.message : String(error),
      });
      notifyWatcher(built.payload);
      return {
        emitted: true,
        reason: "listener-failed",
        hook: BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
        targetResultId,
      };
    }

    notifyWatcher(built.payload);
    return {
      emitted: true,
      hook: BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
      targetResultId,
    };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected failure`, {
      stage: "basic-save-presentation-feed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * Convenience wrapper used by ToolbeltBasicSaveService at READY transitions.
 * @param {object} draft
 * @param {object} record
 * @param {object} target normalized Toolbelt target
 * @param {object} normalized normalizeDamageMessage result
 */
export function emitBasicSaveTargetPresentationFromReady({ draft, record, target, normalized }) {
  return tryEmitBasicSaveTargetPresentation({
    integrationId: draft?.integrationId ?? null,
    applicationId: record?.applicationId ?? null,
    toolbeltTargetKey: target?.toolbeltTargetKey ?? record?.toolbeltTargetKey ?? null,
    saveFingerprint: target?.saveFingerprint ?? record?.toolbeltStateFingerprint ?? null,
    sceneId: target?.sceneId ?? record?.sceneId ?? null,
    sourceActorUuid: draft?.sourceActorUuid ?? normalized?.sourceActorUuid ?? null,
    sourceTokenUuid: null,
    targetTokenUuid: target?.tokenUuid ?? record?.tokenUuid ?? null,
    targetActorUuid: target?.actorUuid ?? record?.actorUuid ?? null,
    actionName: draft?.sourceActionSlug ?? null,
    itemUuid: draft?.sourceItemUuid ?? normalized?.sourceItemUuid ?? null,
    saveType: target?.saveType ?? draft?.saveType ?? normalized?.saveType ?? null,
    saveDC: Number.isFinite(normalized?.saveDC) ? normalized.saveDC : null,
    isBasicSave: target?.isBasicSave !== false,
    private: target?.private === true,
    degreeOfSuccess: target?.degreeOfSuccess ?? record?.nativeOutcome ?? null,
    dieResult: target?.dieResult ?? null,
    modifier: target?.modifier ?? null,
    total: target?.total ?? null,
    rerolled: target?.rerolled ?? null,
  });
}

function rememberEmission(targetResultId) {
  emittedByTargetResultId.set(targetResultId, {
    targetResultId,
    emittedAt: Date.now(),
  });
  while (emittedByTargetResultId.size > MAX_RECENT) {
    const oldest = emittedByTargetResultId.keys().next().value;
    emittedByTargetResultId.delete(oldest);
  }
}

function labelFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  try {
    const doc = typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null;
    const name = doc?.name ?? doc?.actor?.name ?? null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

function notifyWatcher(payload) {
  if (typeof feedWatcher !== "function") return;
  try {
    feedWatcher({
      batchId: payload.batchId ?? null,
      targetResultId: payload.targetResultId ?? null,
      targetLabel: labelFromUuid(payload.targetTokenUuid) ?? labelFromUuid(payload.targetActorUuid),
      saveType: payload.save?.type ?? null,
      saveDC: Number.isFinite(payload.save?.dc) ? payload.save.dc : null,
      dieResult: Number.isFinite(payload.roll?.dieResult) ? payload.roll.dieResult : null,
      modifier: Number.isFinite(payload.roll?.modifier) ? payload.roll.modifier : null,
      total: Number.isFinite(payload.roll?.total) ? payload.roll.total : null,
      degree: payload.roll?.degreeOfSuccess ?? null,
    });
  } catch {
    /* non-fatal */
  }
}

/** @returns {boolean} */
export function watchBasicSavePresentationFeed() {
  if (game.user?.isGM !== true) return false;
  if (feedWatcher) return true;
  feedWatcher = (summary) => {
    const target = summary.targetLabel ?? "target";
    const saveType = summary.saveType ?? "save";
    const dcLine = Number.isFinite(summary.saveDC)
      ? `${capitalize(saveType)} DC ${summary.saveDC}`
      : capitalize(saveType);
    const math =
      Number.isFinite(summary.dieResult) &&
      Number.isFinite(summary.modifier) &&
      Number.isFinite(summary.total)
        ? `${summary.dieResult} +${summary.modifier} = ${summary.total}`
        : Number.isFinite(summary.total)
          ? `total: ${summary.total}`
          : null;
    const naturalNote =
      Number.isFinite(summary.dieResult) && Number.isFinite(summary.modifier)
        ? null
        : "natural/modifier: unavailable";
    console.debug(
      [
        "BASIC SAVE TARGET RESULT",
        `batch: ${String(summary.batchId ?? "").slice(-24)}`,
        `target: ${target}`,
        dcLine,
        math,
        naturalNote,
        summary.degree ?? null,
      ]
        .filter((line) => line != null && line !== "")
        .join("\n"),
    );
  };
  return true;
}

/** @returns {boolean} */
export function stopWatchingBasicSavePresentationFeed() {
  const had = Boolean(feedWatcher);
  feedWatcher = null;
  return had;
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Test helper */
export function clearBasicSavePresentationEmissions() {
  emittedByTargetResultId.clear();
  feedWatcher = null;
}

/** Test helper */
export function seedBasicSaveTargetPresentationEmission(targetResultId) {
  if (!targetResultId) return;
  rememberEmission(targetResultId);
}

export function getBasicSavePresentationStatus() {
  let toolbeltVersion = null;
  let toolbeltSupported = false;
  let toolbeltActive = false;
  let toolbeltEnabled = false;
  try {
    const status = ToolbeltTargetHelperAdapter.status();
    toolbeltVersion = status?.version ?? null;
    toolbeltSupported = status?.supported === true;
    toolbeltActive = status?.active === true;
    toolbeltEnabled = status?.enabled === true;
  } catch {
    /* status probe must never break the contract */
  }
  const producerAvailable = toolbeltActive && toolbeltEnabled && toolbeltSupported;
  return {
    available: true,
    protocol: BASIC_SAVE_PRESENTATION_PROTOCOL,
    targetResolvedHook: BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
    hook: BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
    toolbeltVersion,
    toolbeltSupported,
    producerAvailable,
    observedTargets: emittedByTargetResultId.size,
    emittedResults: emittedByTargetResultId.size,
    rollFieldsAvailable: { ...BASIC_SAVE_ROLL_FIELDS_AVAILABLE },
  };
}

/**
 * Install game.nelflow.integrations.basicSavePresentation (+ dev helpers).
 */
export function installBasicSavePresentationFeedApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};

  const stages = Object.freeze({ targetResolved: true });

  root.integrations.basicSavePresentation = Object.freeze({
    protocol: BASIC_SAVE_PRESENTATION_PROTOCOL,
    targetResolvedHook: BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
    available: true,
    stages,
    getStatus: () => getBasicSavePresentationStatus(),
  });

  root.dev.watchBasicSavePresentationFeed = () => watchBasicSavePresentationFeed();
  root.dev.stopWatchingBasicSavePresentationFeed = () => stopWatchingBasicSavePresentationFeed();
  root.dev.getBasicSavePresentationStatus = () => getBasicSavePresentationStatus();
}
