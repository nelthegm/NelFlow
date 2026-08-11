/**
 * Presentation-neutral Strike feed (NelTactics compatibility).
 *
 * Stage 1 — attack check resolved:
 *   Hooks.callAll("nelflow.strikeAttackResolvedPresentation", payload)
 *
 * Stage 2 — damage / final resolved (existing):
 *   Hooks.callAll("nelflow.strikeResolvedPresentation", payload)
 *
 * Exactly-once guards are independent per stage.
 *
 * Does NOT mean "NelCine should play." NelCine continues to use
 * nelflow.strikeResolved / impact-sync only.
 *
 * Presentation only: never mutates HP, conditions, Undo, or rolls.
 */

import { logger } from "./logger.js";
import {
  buildStrikePresentationPayload,
  cloneSerializable,
  isSerializableStrikePayload,
} from "./nelcine-strike-delivery.js";

export const STRIKE_ATTACK_PRESENTATION_FEED_HOOK = "nelflow.strikeAttackResolvedPresentation";
export const STRIKE_PRESENTATION_FEED_HOOK = "nelflow.strikeResolvedPresentation";
/** @deprecated Alias for the Stage 2 / resolved hook. */
export const STRIKE_RESOLVED_PRESENTATION_FEED_HOOK = STRIKE_PRESENTATION_FEED_HOOK;

export const STRIKE_PRESENTATION_FEED_PROTOCOL = 2;

const LOG_PREFIX = "NelFlow | Strike presentation feed |";
const MAX_RECENT = 64;

/** @type {Map<string, { transactionId: string, emittedAt: number, degree: * }>} */
const attackEmittedByTransactionId = new Map();

/** @type {Map<string, { transactionId: string, emittedAt: number, degree: * }>} */
const resolvedEmittedByTransactionId = new Map();

/** @type {((summary: object) => void)|null} */
let feedWatcher = null;

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function hasStrikeAttackPresentationFeedEmission(transactionId) {
  if (!transactionId) return false;
  return attackEmittedByTransactionId.has(transactionId);
}

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function hasStrikePresentationFeedEmission(transactionId) {
  if (!transactionId) return false;
  return resolvedEmittedByTransactionId.has(transactionId);
}

/**
 * Pure eligibility for either stage of the neutral feed (no NelCine gates).
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateStrikePresentationFeedEligibility(ctx = {}) {
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.multiTarget === true) return { eligible: false, reason: "multi-target-unsupported" };
  if (!ctx.transactionId) return { eligible: false, reason: "missing-transaction-id" };
  if (ctx.alreadyEmitted === true) return { eligible: false, reason: "already-emitted" };
  if (ctx.hasAuthoritativeAttack !== true) {
    return { eligible: false, reason: "missing-authoritative-attack" };
  }
  return { eligible: true };
}

/**
 * Emit Stage 1 — authoritative attack check resolved (no damage required).
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string, hook?: string }}
 */
export function tryEmitStrikeAttackPresentationFeed(args = {}) {
  return emitFeedStage({
    args,
    stage: "attack",
    hook: STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
    emittedMap: attackEmittedByTransactionId,
    forceIncludeDamage: false,
  });
}

/**
 * Emit Stage 2 — existing final / damage presentation feed.
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string, hook?: string }}
 */
export function tryEmitStrikePresentationFeed(args = {}) {
  return emitFeedStage({
    args,
    stage: "resolved",
    hook: STRIKE_PRESENTATION_FEED_HOOK,
    emittedMap: resolvedEmittedByTransactionId,
    forceIncludeDamage: null,
  });
}

/**
 * @param {{
 *   args: object,
 *   stage: "attack"|"resolved",
 *   hook: string,
 *   emittedMap: Map<string, object>,
 *   forceIncludeDamage: boolean|null
 * }} opts
 */
function emitFeedStage({ args, stage, hook, emittedMap, forceIncludeDamage }) {
  try {
    const transactionId =
      typeof args.transactionId === "string" && args.transactionId.trim()
        ? args.transactionId.trim()
        : typeof args.payload?.transactionId === "string"
          ? args.payload.transactionId.trim()
          : null;

    const gate = evaluateStrikePresentationFeedEligibility({
      isGM: game.user?.isGM === true,
      multiTarget: args.multiTarget === true,
      transactionId,
      alreadyEmitted: emittedMap.has(transactionId),
      hasAuthoritativeAttack: args.hasAuthoritativeAttack !== false,
    });
    if (!gate.eligible) {
      return { emitted: false, reason: gate.reason };
    }

    let payload = null;
    if (args.payload && typeof args.payload === "object") {
      if (!isSerializableStrikePayload(args.payload)) {
        return { emitted: false, reason: "invalid-payload" };
      }
      payload = cloneSerializable(args.payload);
    } else {
      const buildArgs =
        forceIncludeDamage === false
          ? { ...args, includeDamage: false, damageSummary: undefined, damageMessage: null }
          : args;
      const built = buildStrikePresentationPayload(buildArgs);
      if (!built.ok) {
        return { emitted: false, reason: built.reason };
      }
      payload = built.payload;
    }

    // Optional stage marker — additive, ignored by older consumers.
    if (payload && typeof payload === "object" && !Object.hasOwn(payload, "stage")) {
      payload = { ...payload, stage };
    }

    // Attack stage must never invent damage.
    if (stage === "attack" && payload && Object.hasOwn(payload, "damage")) {
      const { damage: _damage, ...rest } = payload;
      payload = rest;
    }

    rememberEmission(emittedMap, transactionId, payload);

    const callAll =
      args.hooksCallAll ??
      (typeof Hooks !== "undefined" && typeof Hooks.callAll === "function"
        ? Hooks.callAll.bind(Hooks)
        : null);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable" };
    }

    try {
      callAll(hook, payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Listener failed`, {
        stage: `strike-presentation-feed-${stage}`,
        transactionId,
        reason: error instanceof Error ? error.message : String(error),
      });
      notifyWatcher(payload, transactionId, stage);
      return { emitted: true, reason: "listener-failed", hook };
    }

    notifyWatcher(payload, transactionId, stage);
    return { emitted: true, hook };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected failure`, {
      stage: `strike-presentation-feed-${stage}`,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * @param {Map<string, object>} map
 * @param {string} transactionId
 * @param {object} payload
 */
function rememberEmission(map, transactionId, payload) {
  map.set(transactionId, {
    transactionId,
    emittedAt: Date.now(),
    degree: payload?.attack?.degreeOfSuccess ?? null,
  });
  while (map.size > MAX_RECENT) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

const DEGREE_LABEL = {
  0: "criticalFailure",
  1: "failure",
  2: "success",
  3: "criticalSuccess",
};

/**
 * Best-effort token/actor name from a UUID — never throws, never dumps documents.
 * @param {string|null|undefined} uuid
 * @returns {string|null}
 */
function labelFromUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return null;
  try {
    const doc =
      typeof fromUuidSync === "function"
        ? fromUuidSync(uuid)
        : null;
    const name = doc?.name ?? doc?.actor?.name ?? null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} payload
 * @param {string} transactionId
 * @param {"attack"|"resolved"} stage
 */
function notifyWatcher(payload, transactionId, stage) {
  if (typeof feedWatcher !== "function") return;
  try {
    const attacker =
      labelFromUuid(payload?.attackerTokenUuid) ??
      labelFromUuid(payload?.attackerActorUuid);
    const target =
      labelFromUuid(payload?.targetTokenUuid) ??
      labelFromUuid(payload?.targetActorUuid);
    const degreeRaw = payload?.attack?.degreeOfSuccess;
    const degree =
      DEGREE_LABEL[degreeRaw] ??
      (typeof degreeRaw === "string" ? degreeRaw : null);
    feedWatcher({
      stage,
      transactionId,
      degree,
      attackerLabel: attacker,
      targetLabel: target,
      actionName: typeof payload?.actionName === "string" ? payload.actionName : null,
      dieResult: Number.isFinite(payload?.attack?.dieResult) ? payload.attack.dieResult : null,
      modifier: Number.isFinite(payload?.attack?.modifier) ? payload.attack.modifier : null,
      total: Number.isFinite(payload?.attack?.total) ? payload.attack.total : null,
      damageTotal:
        payload?.damage == null
          ? null
          : Number.isFinite(payload.damage?.total)
            ? payload.damage.total
            : null,
      hasDamageField: Object.hasOwn(payload ?? {}, "damage"),
    });
  } catch {
    /* watcher failures are non-fatal */
  }
}

/** @returns {boolean} */
export function watchStrikePresentationFeed() {
  if (game.user?.isGM !== true) return false;
  if (feedWatcher) return true;
  feedWatcher = (summary) => {
    const shortId = String(summary.transactionId ?? "").slice(-12);
    const from = summary.attackerLabel ?? null;
    const to = summary.targetLabel ?? null;
    const who =
      from && to
        ? `${from} → ${to}`
        : summary.actionName ?? "Strike";
    const degree = summary.degree ?? "?";
    const math =
      Number.isFinite(summary.dieResult) &&
      Number.isFinite(summary.modifier) &&
      Number.isFinite(summary.total)
        ? `${summary.dieResult} +${summary.modifier} = ${summary.total}`
        : null;

    if (summary.stage === "attack") {
      console.debug(
        [`STRIKE ATTACK ${shortId}`, who, math, degree]
          .filter((line) => line != null && line !== "")
          .join("\n"),
      );
      return;
    }

    const damageLine =
      summary.hasDamageField === false || summary.damageTotal == null
        ? "damage none"
        : `damage ${summary.damageTotal}`;
    console.debug(
      [`STRIKE RESOLVED ${shortId}`, who, damageLine]
        .filter((line) => line != null && line !== "")
        .join("\n"),
    );
  };
  return true;
}

/** @returns {boolean} */
export function stopWatchingStrikePresentationFeed() {
  const had = Boolean(feedWatcher);
  feedWatcher = null;
  return had;
}

/** Test helper */
export function clearStrikePresentationFeedEmissions() {
  attackEmittedByTransactionId.clear();
  resolvedEmittedByTransactionId.clear();
  feedWatcher = null;
}

/** Test helper */
export function seedStrikeAttackPresentationFeedEmission(transactionId) {
  if (!transactionId) return;
  attackEmittedByTransactionId.set(transactionId, {
    transactionId,
    emittedAt: Date.now(),
    degree: null,
  });
}

/** Test helper */
export function seedStrikePresentationFeedEmission(transactionId) {
  if (!transactionId) return;
  resolvedEmittedByTransactionId.set(transactionId, {
    transactionId,
    emittedAt: Date.now(),
    degree: null,
  });
}

/**
 * Install game.nelflow.integrations.strikePresentation (+ optional getStatus).
 * Safe to call once from ready.
 */
export function installStrikePresentationFeedApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};

  const status = () => ({
    protocol: STRIKE_PRESENTATION_FEED_PROTOCOL,
    hook: STRIKE_PRESENTATION_FEED_HOOK,
    attackHook: STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
    resolvedHook: STRIKE_PRESENTATION_FEED_HOOK,
    available: true,
    stages: { attack: true, damage: true },
    recentAttackEmissions: attackEmittedByTransactionId.size,
    recentResolvedEmissions: resolvedEmittedByTransactionId.size,
    recentEmissions: resolvedEmittedByTransactionId.size,
  });

  root.integrations.strikePresentation = Object.freeze({
    protocol: STRIKE_PRESENTATION_FEED_PROTOCOL,
    hook: STRIKE_PRESENTATION_FEED_HOOK,
    attackHook: STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
    resolvedHook: STRIKE_PRESENTATION_FEED_HOOK,
    available: true,
    stages: Object.freeze({ attack: true, damage: true }),
    getStatus: status,
  });

  root.dev.watchStrikePresentationFeed = () => watchStrikePresentationFeed();
  root.dev.stopWatchingStrikePresentationFeed = () => stopWatchingStrikePresentationFeed();
}
