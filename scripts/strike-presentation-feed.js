/**
 * Presentation-neutral Strike feed (NelTactics compatibility).
 *
 * Emits Hooks.callAll("nelflow.strikeResolvedPresentation", payload) exactly
 * once per Strike transaction — independent of NelCine install/active/settings.
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

export const STRIKE_PRESENTATION_FEED_HOOK = "nelflow.strikeResolvedPresentation";
export const STRIKE_PRESENTATION_FEED_PROTOCOL = 1;

const LOG_PREFIX = "NelFlow | Strike presentation feed |";
const MAX_RECENT = 64;

/** @type {Map<string, { transactionId: string, emittedAt: number, degree: * }>} */
const emittedByTransactionId = new Map();

/** @type {((summary: object) => void)|null} */
let feedWatcher = null;

/**
 * @param {string} transactionId
 * @returns {boolean}
 */
export function hasStrikePresentationFeedEmission(transactionId) {
  if (!transactionId) return false;
  return emittedByTransactionId.has(transactionId);
}

/**
 * Pure eligibility for the neutral feed (no NelCine gates).
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
 * Emit the presentation-neutral Strike feed once per transaction.
 * Accepts the same args as buildStrikePresentationPayload, or a prebuilt
 * `payload` (e.g. impact-sync raw payload).
 *
 * @param {object} args
 * @returns {{ emitted: boolean, reason?: string, hook?: string }}
 */
export function tryEmitStrikePresentationFeed(args = {}) {
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
      alreadyEmitted: hasStrikePresentationFeedEmission(transactionId),
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
      const built = buildStrikePresentationPayload(args);
      if (!built.ok) {
        return { emitted: false, reason: built.reason };
      }
      payload = built.payload;
    }

    // Mark before external listeners so throwing consumers cannot retry.
    rememberEmission(transactionId, payload);

    const callAll =
      args.hooksCallAll ??
      (typeof Hooks !== "undefined" && typeof Hooks.callAll === "function"
        ? Hooks.callAll.bind(Hooks)
        : null);
    if (typeof callAll !== "function") {
      return { emitted: false, reason: "hooks-unavailable" };
    }

    try {
      callAll(STRIKE_PRESENTATION_FEED_HOOK, payload);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Listener failed`, {
        stage: "strike-presentation-feed",
        transactionId,
        reason: error instanceof Error ? error.message : String(error),
      });
      // Still count as emitted — exactly-once already marked.
      notifyWatcher(payload, transactionId);
      return { emitted: true, reason: "listener-failed", hook: STRIKE_PRESENTATION_FEED_HOOK };
    }

    notifyWatcher(payload, transactionId);
    return { emitted: true, hook: STRIKE_PRESENTATION_FEED_HOOK };
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected failure`, {
      stage: "strike-presentation-feed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "internal-exception" };
  }
}

/**
 * @param {string} transactionId
 * @param {object} payload
 */
function rememberEmission(transactionId, payload) {
  emittedByTransactionId.set(transactionId, {
    transactionId,
    emittedAt: Date.now(),
    degree: payload?.attack?.degreeOfSuccess ?? null,
  });
  while (emittedByTransactionId.size > MAX_RECENT) {
    const oldest = emittedByTransactionId.keys().next().value;
    emittedByTransactionId.delete(oldest);
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
 */
function notifyWatcher(payload, transactionId) {
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
        ? `${summary.dieResult} + ${summary.modifier} = ${summary.total}`
        : null;
    const damageLine =
      summary.hasDamageField === false || summary.damageTotal == null
        ? "damage none"
        : `damage ${summary.damageTotal}`;
    console.debug(
      [
        `STRIKE FEED ${shortId}`,
        who,
        degree,
        math,
        damageLine,
      ]
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
  emittedByTransactionId.clear();
  feedWatcher = null;
}

/** Test helper */
export function seedStrikePresentationFeedEmission(transactionId) {
  if (!transactionId) return;
  emittedByTransactionId.set(transactionId, {
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

  root.integrations.strikePresentation = Object.freeze({
    protocol: STRIKE_PRESENTATION_FEED_PROTOCOL,
    hook: STRIKE_PRESENTATION_FEED_HOOK,
    available: true,
    getStatus: () => ({
      protocol: STRIKE_PRESENTATION_FEED_PROTOCOL,
      hook: STRIKE_PRESENTATION_FEED_HOOK,
      available: true,
      recentEmissions: emittedByTransactionId.size,
    }),
  });

  root.dev.watchStrikePresentationFeed = () => watchStrikePresentationFeed();
  root.dev.stopWatchingStrikePresentationFeed = () => stopWatchingStrikePresentationFeed();
}
