/**
 * Presentation-neutral authoritative healing feed (protocol 1).
 *
 * Observes PF2e `damage-taken` ChatMessages whose AppliedDamageFlag has
 * `isHealing: true`, then reports actual NORMAL HP restored from flag updates.
 *
 * Pre-application ownership is NOT advertised: native PF2e Actor#applyDamage
 * owns healing application from chat cards; NelFlow has no exact wrap point
 * without private patches.
 *
 * Never calculates healing from roll totals, max HP, or arbitrary Actor updates.
 * Never mutates HP, rolls, PF2e, or Toolbelt. Hooks.callAll is GM-local only.
 */

import { logger } from "./logger.js";
import { actualHealingFromAppliedDamage } from "./nelcine-effect-bridge.js";

export const HEALING_PRESENTATION_PROTOCOL = 1;
export const HEALING_APPLIED_PRESENTATION_HOOK = "nelflow.healingAppliedPresentation";
export const HEALING_APPLIED_SOURCE = "pf2e-applied-damage-flag";
export const HEALING_TEMP_HP_INCLUDED = false;

/** Supported workflows proven by PF2e Actor#applyDamage → damage-taken path. */
export const HEALING_SUPPORTED_WORKFLOWS = Object.freeze([
  "pf2e-chat-apply-healing", // Heal spell / healing rolls applied via chat buttons
  "pf2e-treat-wounds",
  "pf2e-battle-medicine",
  "pf2e-healing-consumable",
  "pf2e-focus-healing", // e.g. Lay on Hands when applied through applyDamage
  "pf2e-other-applyDamage-healing", // any other Actor#applyDamage healing path
]);

const LOG_PREFIX = "NelFlow | Healing presentation feed |";
const MAX_EMITTED = 128;

/** Dedicated applied registry — never shared with NelCine / damageApplied / Undo. */
const appliedPresentationEmittedByHealingResultId = new Map();

/** @type {((summary: object) => void)|null} */
let healingFeedWatcher = null;

let hooksRegistered = false;

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Deterministic identity for one exact target healing application message.
 * @param {{ messageId?: string|null, targetTokenUuid?: string|null, targetActorUuid?: string|null }} args
 * @returns {string|null}
 */
export function buildHealingResultId(args = {}) {
  const messageId = safeString(args.messageId);
  const tokenUuid = safeString(args.targetTokenUuid);
  const actorUuid = safeString(args.targetActorUuid);
  if (!messageId) return null;
  if (tokenUuid) return `healing:${messageId}:${tokenUuid}`;
  if (actorUuid) return `healing:${messageId}:${actorUuid}`;
  return `healing:${messageId}`;
}

export function hasHealingAppliedPresentationEmission(healingResultId) {
  return Boolean(healingResultId && appliedPresentationEmittedByHealingResultId.has(healingResultId));
}

/**
 * Exact token for a damage-taken healing message — never guess among duplicates.
 * @param {object} message
 * @param {string|null} targetActorUuid
 * @returns {{ tokenUuid: string|null, sceneId: string|null, reason: string }}
 */
export function resolveHealingTargetToken(message, targetActorUuid = null) {
  const scene = globalThis.canvas?.scene ?? null;
  const sceneId = safeString(scene?.id);

  // Prefer speaker token (PF2e getSpeaker({ token }) on applyDamage).
  const speaker = message?.speaker ?? null;
  const speakerTokenId = safeString(speaker?.token);
  const speakerSceneId = safeString(speaker?.scene) ?? sceneId;
  if (speakerTokenId && speakerSceneId) {
    const uuid = `Scene.${speakerSceneId}.Token.${speakerTokenId}`;
    if (!sceneId || speakerSceneId === sceneId) {
      return { tokenUuid: uuid, sceneId: speakerSceneId, reason: "speaker-token" };
    }
    return { tokenUuid: null, sceneId, reason: "token-off-scene" };
  }

  const tokenDoc = message?.token ?? null;
  const tokenUuid = safeString(tokenDoc?.uuid);
  if (tokenUuid) {
    return {
      tokenUuid,
      sceneId: safeString(tokenDoc?.parent?.id) ?? sceneId,
      reason: "message-token",
    };
  }

  // Unique active token for applied actor UUID only.
  const actorUuid = safeString(targetActorUuid) ?? safeString(message?.actor?.uuid);
  if (!actorUuid) {
    return { tokenUuid: null, sceneId, reason: "missing-actor" };
  }

  const placeables = globalThis.canvas?.tokens?.placeables;
  if (!Array.isArray(placeables) || !placeables.length) {
    return { tokenUuid: null, sceneId, reason: "no-canvas-tokens" };
  }

  const actorId = actorUuid.includes(".")
    ? actorUuid.slice(actorUuid.lastIndexOf(".") + 1)
    : actorUuid;
  const matches = [];
  for (const placeable of placeables) {
    const doc = placeable?.document ?? placeable;
    const uuid = safeString(doc?.uuid ?? placeable?.uuid);
    if (!uuid) continue;
    const actor = placeable?.actor;
    if (safeString(actor?.uuid) === actorUuid || safeString(actor?.id) === actorId) {
      matches.push(uuid);
    }
  }
  if (matches.length === 1) {
    return { tokenUuid: matches[0], sceneId, reason: "unique-actor-token" };
  }
  if (matches.length > 1) {
    return { tokenUuid: null, sceneId, reason: "ambiguous-actor-tokens" };
  }
  return { tokenUuid: null, sceneId, reason: "token-unresolved" };
}

/**
 * Optional rolled total when the damage-taken message itself carries rolls
 * (rare). Never invent from max HP or sheet math.
 * @param {object} message
 * @returns {number|null}
 */
export function extractOptionalRolledHealingTotal(message) {
  const messageRolls = message?.rolls;
  if (!Array.isArray(messageRolls) || !messageRolls.length) return null;
  const total = finiteNumber(messageRolls[0]?.total);
  if (total == null) return null;
  // Healing rolls are typically negative in PF2e DamageRoll totals when signed;
  // report positive magnitude for diagnostics.
  return Math.abs(Math.trunc(total));
}

export function evaluateHealingAppliedPresentationEligibility(ctx = {}) {
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.privateLeak === true) return { eligible: false, reason: "private-message" };
  if (!ctx.healingResultId) return { eligible: false, reason: "missing-healing-result-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  if (ctx.isHealingTaken !== true) return { eligible: false, reason: "not-healing-taken" };
  if (!ctx.targetTokenUuid) return { eligible: false, reason: "missing-target-token" };
  if (!Number.isFinite(ctx.applied) || ctx.applied < 0) {
    return { eligible: false, reason: "missing-authoritative-applied-healing" };
  }
  return { eligible: true };
}

/**
 * Build plain JSON applied payload.
 * @param {object} args
 * @returns {{ ok: true, payload: object }|{ ok: false, reason: string }}
 */
export function buildHealingAppliedPresentationPayload(args = {}) {
  const healingResultId =
    safeString(args.healingResultId) ??
    buildHealingResultId({
      messageId: args.messageId,
      targetTokenUuid: args.targetTokenUuid,
      targetActorUuid: args.targetActorUuid,
    });
  const targetTokenUuid = safeString(args.targetTokenUuid);
  const applied = finiteNumber(args.applied);
  if (!healingResultId) return { ok: false, reason: "missing-healing-result-id" };
  if (!targetTokenUuid) return { ok: false, reason: "missing-target-token" };
  if (applied == null || applied < 0) {
    return { ok: false, reason: "missing-authoritative-applied-healing" };
  }

  const healing = { applied: Math.trunc(applied) };
  const rolledTotal = finiteNumber(args.rolledTotal);
  if (rolledTotal != null && rolledTotal >= 0) {
    healing.rolledTotal = Math.trunc(rolledTotal);
  }

  const payload = {
    schemaVersion: 1,
    stage: "healingApplied",
    healingResultId,
    targetTokenUuid,
    healing,
    createdAt: Number.isFinite(args.createdAt) ? Number(args.createdAt) : Date.now(),
  };

  const optionalStrings = [
    ["sceneId", args.sceneId],
    ["sourceTokenUuid", args.sourceTokenUuid],
    ["sourceActorUuid", args.sourceActorUuid],
    ["targetActorUuid", args.targetActorUuid],
    ["actionName", args.actionName],
    ["itemUuid", args.itemUuid],
    ["messageId", args.messageId],
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

function resolveHooksCallAll(args) {
  return (
    args.hooksCallAll ??
    (typeof globalThis.Hooks?.callAll === "function" ? Hooks.callAll.bind(Hooks) : null)
  );
}

function rememberAppliedEmission(healingResultId) {
  if (!healingResultId) return;
  appliedPresentationEmittedByHealingResultId.set(healingResultId, Date.now());
  while (appliedPresentationEmittedByHealingResultId.size > MAX_EMITTED) {
    const oldest = appliedPresentationEmittedByHealingResultId.keys().next().value;
    appliedPresentationEmittedByHealingResultId.delete(oldest);
  }
}

function notifyWatcher(payload) {
  if (typeof healingFeedWatcher !== "function") return;
  try {
    healingFeedWatcher(payload);
  } catch {
    /* non-fatal */
  }
}

/**
 * Emit exactly once per authoritative healing application message.
 * @param {object} args
 * @returns {object}
 */
export function tryEmitHealingAppliedPresentation(args = {}) {
  try {
    const healingResultId =
      safeString(args.healingResultId) ??
      buildHealingResultId({
        messageId: args.messageId,
        targetTokenUuid: args.targetTokenUuid,
        targetActorUuid: args.targetActorUuid,
      });
    const applied = finiteNumber(args.applied);
    const gate = evaluateHealingAppliedPresentationEligibility({
      isGM: globalThis.game?.user?.isGM === true,
      privateLeak: args.privateLeak === true,
      healingResultId,
      alreadyEmitted: hasHealingAppliedPresentationEmission(healingResultId),
      isHealingTaken: args.isHealingTaken !== false,
      targetTokenUuid: args.targetTokenUuid,
      applied,
    });
    if (!gate.eligible) {
      return {
        emitted: false,
        reason: gate.reason,
        healingResultId: healingResultId ?? undefined,
      };
    }

    const built = buildHealingAppliedPresentationPayload({
      ...args,
      healingResultId,
      applied,
    });
    if (!built.ok) {
      return { emitted: false, reason: built.reason, healingResultId };
    }

    const callAll = resolveHooksCallAll(args);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable", healingResultId };
    }

    rememberAppliedEmission(healingResultId);
    try {
      callAll(HEALING_APPLIED_PRESENTATION_HOOK, built.payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Listener failed`, {
        stage: "healing-applied-presentation-feed",
        healingResultId,
        reason: error instanceof Error ? error.message : String(error),
      });
      notifyWatcher(built.payload);
      return {
        emitted: true,
        reason: "listener-failed",
        hook: HEALING_APPLIED_PRESENTATION_HOOK,
        healingResultId,
        payload: built.payload,
      };
    }
    notifyWatcher(built.payload);
    return {
      emitted: true,
      hook: HEALING_APPLIED_PRESENTATION_HOOK,
      healingResultId,
      payload: built.payload,
    };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected failure`, {
      stage: "healing-applied-presentation-feed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * Observe a ChatMessage and emit healingApplied when it is an exact PF2e
 * healing damage-taken application.
 * @param {object} message
 * @param {{ hooksCallAll?: Function }} [options]
 * @returns {object}
 */
export function handleHealingPresentationChatMessage(message, options = {}) {
  if (globalThis.game?.user?.isGM !== true) {
    return { emitted: false, reason: "not-gm" };
  }

  const flags = message?.flags?.pf2e;
  const applied = flags?.appliedDamage;
  if (flags?.context?.type !== "damage-taken" || applied?.isHealing !== true) {
    return { emitted: false, reason: "not-healing-taken" };
  }

  // Undo never creates a healing damage-taken message; still refuse damageUndo.
  if (message?.flags?.pf2e?.context?.options?.includes?.("damage-undo")) {
    return { emitted: false, reason: "undo-excluded" };
  }

  const actual = actualHealingFromAppliedDamage(applied);
  if (actual == null) {
    // Temp-HP-only or missing normal HP update — not normal healing.applied.
    return { emitted: false, reason: "no-normal-hp-restoration" };
  }

  const targetActorUuid =
    safeString(applied.uuid) ?? safeString(message?.actor?.uuid) ?? null;
  const tokenResolution = resolveHealingTargetToken(message, targetActorUuid);
  if (!tokenResolution.tokenUuid) {
    return {
      emitted: false,
      reason: tokenResolution.reason || "missing-target-token",
    };
  }

  const messageId = safeString(message?.id);
  const healingResultId = buildHealingResultId({
    messageId,
    targetTokenUuid: tokenResolution.tokenUuid,
    targetActorUuid,
  });

  const origin = flags?.origin ?? null;
  const resolvedItem = message?.item ?? null;
  const actionName =
    safeString(resolvedItem?.name) ??
    safeString(origin?.name) ??
    null;
  const itemUuid = safeString(origin?.uuid) ?? safeString(resolvedItem?.uuid);

  return tryEmitHealingAppliedPresentation({
    healingResultId,
    messageId,
    sceneId: tokenResolution.sceneId,
    sourceActorUuid: safeString(origin?.actor),
    sourceTokenUuid: safeString(origin?.token),
    targetTokenUuid: tokenResolution.tokenUuid,
    targetActorUuid,
    actionName,
    itemUuid,
    applied: actual,
    rolledTotal: extractOptionalRolledHealingTotal(message),
    isHealingTaken: true,
    hooksCallAll: options.hooksCallAll,
  });
}

export function getHealingPresentationStatus() {
  return {
    protocol: HEALING_PRESENTATION_PROTOCOL,
    producerAvailable: true,
    applyingHook: null,
    appliedHook: HEALING_APPLIED_PRESENTATION_HOOK,
    stages: {
      applying: false,
      applied: true,
    },
    supportedWorkflows: [...HEALING_SUPPORTED_WORKFLOWS],
    actualHealingSource: HEALING_APPLIED_SOURCE,
    tempHpIncluded: HEALING_TEMP_HP_INCLUDED,
    emittedCount: appliedPresentationEmittedByHealingResultId.size,
    note:
      "Pre-application ownership is unavailable for native PF2e chat healing; applied-only protocol.",
  };
}

export function watchHealingPresentationFeed() {
  healingFeedWatcher = (payload) => {
    try {
      if (payload?.stage === "healingApplied") {
        const name = payload.actionName ?? "Heal";
        const rolled =
          payload.healing?.rolledTotal != null ? ` rolled=${payload.healing.rolledTotal}` : "";
        console.log(
          `NelFlow | HEALING APPLIED target=${payload.targetTokenUuid} result=${payload.healingResultId}${rolled} applied=${payload.healing?.applied}`,
        );
      } else {
        console.log("NelFlow | HEALING PRESENTATION", payload);
      }
    } catch {
      /* ignore */
    }
  };
  return { watching: true };
}

export function stopWatchingHealingPresentationFeed() {
  healingFeedWatcher = null;
  return { watching: false };
}

/**
 * Register createChatMessage observer. Idempotent.
 */
export function registerHealingPresentationHooks() {
  if (hooksRegistered) return { registered: false, reason: "already-registered" };
  if (typeof globalThis.Hooks?.on !== "function") {
    return { registered: false, reason: "hooks-unavailable" };
  }
  hooksRegistered = true;
  Hooks.on("createChatMessage", (message) => {
    try {
      handleHealingPresentationChatMessage(message);
    } catch (error) {
      logger.warn(`${LOG_PREFIX} createChatMessage failed open`, {
        stage: "healing-presentation-feed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { registered: true };
}

export function installHealingPresentationFeedApi() {
  const root = (globalThis.game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};

  root.integrations.healingPresentation = Object.freeze({
    protocol: HEALING_PRESENTATION_PROTOCOL,
    appliedHook: HEALING_APPLIED_PRESENTATION_HOOK,
    available: true,
    stages: Object.freeze({
      applying: false,
      applied: true,
    }),
    getStatus: () => getHealingPresentationStatus(),
  });

  root.dev.getHealingPresentationStatus = () => getHealingPresentationStatus();
  root.dev.watchHealingPresentationFeed = () => watchHealingPresentationFeed();
  root.dev.stopWatchingHealingPresentationFeed = () => stopWatchingHealingPresentationFeed();
}

/** Test reset. */
export function resetHealingPresentationFeedForTests() {
  appliedPresentationEmittedByHealingResultId.clear();
  healingFeedWatcher = null;
  hooksRegistered = false;
}
