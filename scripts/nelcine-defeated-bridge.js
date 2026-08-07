/**
 * NelCine NPC Defeated presentation bridge (0.14.0).
 * Presentation only — never changes HP, Combatant.defeated, or combat state.
 *
 * Authoritative boundary: updateCombatant defeated false → true
 * (PF2e applyDamage → toggleDefeated, or manual tracker toggle).
 */

import { SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";

export const NELCINE_MODULE_ID = "nelcine";
export const DEFEATED_CAUSE_TYPES = Object.freeze({
  STRIKE: "strike",
  SAVE: "save",
  DAMAGE: "damage",
  EFFECT: "effect",
  GENERIC: "generic",
});

const MAX_RECENT = 40;
const MAX_EMITTED = 80;
const MAX_LETHAL = 48;
/** Wait briefly so NelFlow APPLIED/lethal notes can settle before cause lookup. */
export const DEFEAT_CAUSE_LOOKUP_MS = 120;
/** Lethal application notes older than this are ignored. */
export const LETHAL_CAUSE_TTL_MS = 8000;

/** @type {Map<string, number>} combatId:combatantId → emittedAt while defeated */
const defeatedEmitState = new Map();
/** @type {Map<string, object>} actorUuid|tokenUuid → lethal note */
const lethalByTarget = new Map();
/** @type {object[]} */
const recentEvents = [];
/** @type {((summary: object) => void)|null} */
let watcher = null;
let hooksRegistered = false;

const nativeSchedule = globalThis.setTimeout.bind(globalThis);
/** @type {(handler: () => void, ms?: number) => unknown} */
let schedule = nativeSchedule;

/**
 * @param {(handler: () => void, ms?: number) => unknown} [fn]
 */
export function setDefeatedSchedule(fn) {
  schedule = typeof fn === "function" ? fn : nativeSchedule;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rememberRecent(entry) {
  recentEvents.unshift(entry);
  while (recentEvents.length > MAX_RECENT) recentEvents.pop();
  if (typeof watcher === "function") {
    try {
      watcher(entry);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * @returns {boolean}
 */
export function isAuthoritativeDefeatedEmitter() {
  if (game.user?.isGM !== true) return false;
  const api = game.nelcine;
  if (typeof api?.sync?.isPrimaryGM === "function") return Boolean(api.sync.isPrimaryGM());
  const elected = electProcessingGm(game.users ?? [], game.user.id);
  return elected === game.user.id;
}

/**
 * @returns {object}
 */
export function detectNelcineDefeatedRuntime() {
  const mod = game.modules?.get?.(NELCINE_MODULE_ID);
  const active = mod?.active === true;
  const api = game.nelcine ?? null;
  const broadcast =
    typeof api?.integrations?.nelflow?.broadcastDefeated === "function"
      ? api.integrations.nelflow.broadcastDefeated.bind(api.integrations.nelflow)
      : null;
  const normalize =
    typeof api?.integrations?.nelflow?.normalizeDefeated === "function"
      ? api.integrations.nelflow.normalizeDefeated.bind(api.integrations.nelflow)
      : null;
  return {
    active,
    version: typeof mod?.version === "string" ? mod.version : null,
    broadcast,
    normalize,
    hasBroadcastApi: typeof broadcast === "function",
  };
}

function readDefeatedSettingEnabled() {
  try {
    return getSetting(SETTINGS.NELCINE_DEFEATED_CINEMATICS) !== false;
  } catch {
    return true;
  }
}

/**
 * Record a NelFlow damage application that left the target at 0 HP.
 * Used for exact cause.transactionId correlation on subsequent defeat.
 *
 * @param {object} input
 */
export function noteLethalApplication(input = {}) {
  const actorUuid = safeString(input.actorUuid);
  const tokenUuid = safeString(input.tokenUuid);
  const transactionId = safeString(input.transactionId);
  const causeType = safeString(input.causeType);
  if (!transactionId || !causeType) return false;
  if (!actorUuid && !tokenUuid) return false;
  if (!Object.values(DEFEATED_CAUSE_TYPES).includes(causeType)) return false;
  const postHp = Number(input.postHp);
  if (Number.isFinite(postHp) && postHp > 0) return false;

  const note = {
    actorUuid,
    tokenUuid,
    transactionId,
    causeType,
    sourceActorUuid: safeString(input.sourceActorUuid),
    sourceTokenUuid: safeString(input.sourceTokenUuid),
    sourceName: safeString(input.sourceName),
    sourceImg: safeString(input.sourceImg),
    notedAt: Date.now(),
  };
  if (actorUuid) lethalByTarget.set(`actor:${actorUuid}`, note);
  if (tokenUuid) lethalByTarget.set(`token:${tokenUuid}`, note);
  while (lethalByTarget.size > MAX_LETHAL) {
    const oldest = lethalByTarget.keys().next().value;
    lethalByTarget.delete(oldest);
  }
  return true;
}

/**
 * Helper for application paths: note cause when post HP is exactly 0.
 */
export function noteLethalApplicationIfZeroHp({
  actor,
  token,
  transactionId,
  causeType,
  postApplication,
  sourceActor = null,
  sourceToken = null,
} = {}) {
  const postHp = postApplication?.hp;
  if (!Number.isFinite(postHp) || postHp > 0) return false;
  return noteLethalApplication({
    actorUuid: actor?.uuid ?? null,
    tokenUuid: token?.uuid ?? null,
    transactionId,
    causeType,
    postHp,
    sourceActorUuid: sourceActor?.uuid ?? null,
    sourceTokenUuid: sourceToken?.uuid ?? null,
    sourceName: sourceToken?.name ?? sourceActor?.name ?? null,
    sourceImg: sourceToken?.texture?.src ?? sourceActor?.img ?? null,
  });
}

function pruneLethalNotes(now = Date.now()) {
  for (const [key, note] of lethalByTarget) {
    if (now - note.notedAt > LETHAL_CAUSE_TTL_MS) lethalByTarget.delete(key);
  }
}

/**
 * Exact lookup only — no timestamp-only guessing across unrelated targets.
 * @param {{ actorUuid?: string|null, tokenUuid?: string|null }} target
 */
export function findLethalCauseForTarget(target = {}) {
  pruneLethalNotes();
  const actorUuid = safeString(target.actorUuid);
  const tokenUuid = safeString(target.tokenUuid);
  const byToken = tokenUuid ? lethalByTarget.get(`token:${tokenUuid}`) : null;
  const byActor = actorUuid ? lethalByTarget.get(`actor:${actorUuid}`) : null;
  const note = byToken ?? byActor ?? null;
  if (!note) return null;
  if (tokenUuid && note.tokenUuid && note.tokenUuid !== tokenUuid) return null;
  if (actorUuid && note.actorUuid && note.actorUuid !== actorUuid) return null;
  return {
    type: note.causeType,
    transactionId: note.transactionId,
    source: {
      actorUuid: note.sourceActorUuid,
      tokenUuid: note.sourceTokenUuid,
      name: note.sourceName,
      img: note.sourceImg,
    },
  };
}

/**
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function isNpcCreatureActor(actor) {
  if (!actor) return false;
  if (typeof actor.isOfType === "function") return actor.isOfType("npc") === true;
  return actor.type === "npc";
}

/**
 * @param {Combatant} combatant
 * @param {object} changed
 */
export function evaluateNpcDefeatTransition(combatant, changed = {}) {
  if (game.ready !== true) return { eligible: false, reason: "game-not-ready" };
  if (!("defeated" in changed)) return { eligible: false, reason: "not-defeated-change" };
  if (changed.defeated === false) return { eligible: false, reason: "undefeated", reset: true };
  if (changed.defeated !== true) return { eligible: false, reason: "not-defeated-true" };

  const combat = combatant?.combat ?? combatant?.parent ?? null;
  if (!combat) return { eligible: false, reason: "no-combat" };
  if (!game.combat || safeString(game.combat.id) !== safeString(combat.id)) {
    return { eligible: false, reason: "outside-active-combat" };
  }

  const actor = combatant.actor ?? null;
  if (!isNpcCreatureActor(actor)) {
    return {
      eligible: false,
      reason: actor?.type === "character" ? "player-character" : "non-npc",
    };
  }

  const tokenDoc = combatant.token ?? null;
  if (!tokenDoc && !actor) return { eligible: false, reason: "missing-target-identity" };

  return {
    eligible: true,
    combatId: safeString(combat.id),
    combatantId: safeString(combatant.id),
    actorUuid: safeString(actor?.uuid),
    tokenUuid: safeString(tokenDoc?.uuid),
    targetName: safeString(tokenDoc?.name) ?? safeString(actor?.name),
    targetImg: safeString(tokenDoc?.texture?.src) ?? safeString(actor?.img),
    sceneId: safeString(tokenDoc?.parent?.id) ?? safeString(combat.sceneId) ?? safeString(canvas?.scene?.id),
  };
}

function emitStateKey(combatId, combatantId) {
  return `${combatId}:${combatantId}`;
}

/**
 * @param {object} input
 * @returns {object|null}
 */
export function buildDefeatedPayload(input = {}) {
  const transactionId = safeString(input.transactionId);
  const targetActorUuid = safeString(input.target?.actorUuid);
  const targetTokenUuid = safeString(input.target?.tokenUuid);
  if (!transactionId) return null;
  if (!targetActorUuid && !targetTokenUuid) return null;

  const payload = {
    schemaVersion: 1,
    type: "defeated",
    transactionId,
    target: {
      actorUuid: targetActorUuid,
      tokenUuid: targetTokenUuid,
      name: safeString(input.target?.name),
      img: safeString(input.target?.img),
    },
    source: null,
    cause: null,
    sceneId: safeString(input.sceneId),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };

  if (input.source && typeof input.source === "object") {
    payload.source = {
      actorUuid: safeString(input.source.actorUuid),
      tokenUuid: safeString(input.source.tokenUuid),
      name: safeString(input.source.name),
      img: safeString(input.source.img),
    };
  }

  const causeType = safeString(input.cause?.type);
  const causeTx = safeString(input.cause?.transactionId);
  if (causeType && causeTx && Object.values(DEFEATED_CAUSE_TYPES).includes(causeType)) {
    payload.cause = { type: causeType, transactionId: causeTx };
  }

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
  return payload;
}

/**
 * @param {Combatant} combatant
 * @param {object} changed
 * @param {{ waitMs?: number }} [opts]
 */
export async function presentNpcDefeatFromCombatant(combatant, changed, opts = {}) {
  const evaluation = evaluateNpcDefeatTransition(combatant, changed);
  if (evaluation.reset === true) {
    const combat = combatant?.combat ?? combatant?.parent;
    const key = emitStateKey(safeString(combat?.id), safeString(combatant?.id));
    if (key !== ":") defeatedEmitState.delete(key);
    return { emitted: false, reason: "undefeated" };
  }
  if (!evaluation.eligible) {
    rememberRecent({
      transactionId: null,
      combatId: evaluation.combatId ?? null,
      combatantId: evaluation.combatantId ?? null,
      targetName: evaluation.targetName ?? null,
      causeType: null,
      causeTransactionId: null,
      outcome: "suppressed",
      reason: evaluation.reason,
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: evaluation.reason };
  }

  if (!readDefeatedSettingEnabled()) {
    rememberRecent({
      transactionId: null,
      combatId: evaluation.combatId,
      combatantId: evaluation.combatantId,
      targetName: evaluation.targetName,
      causeType: null,
      causeTransactionId: null,
      outcome: "suppressed",
      reason: "setting-disabled",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "setting-disabled" };
  }

  if (!isAuthoritativeDefeatedEmitter()) {
    return { emitted: false, reason: "not-authoritative-emitter" };
  }

  const runtime = detectNelcineDefeatedRuntime();
  if (!runtime.active) return { emitted: false, reason: "nelcine-inactive" };
  if (!runtime.hasBroadcastApi) return { emitted: false, reason: "missing-broadcast-api" };

  const stateKey = emitStateKey(evaluation.combatId, evaluation.combatantId);
  if (defeatedEmitState.has(stateKey)) {
    rememberRecent({
      transactionId: null,
      combatId: evaluation.combatId,
      combatantId: evaluation.combatantId,
      targetName: evaluation.targetName,
      causeType: null,
      causeTransactionId: null,
      outcome: "duplicate",
      reason: "duplicate",
      emittedAt: Date.now(),
    });
    return { emitted: false, reason: "duplicate" };
  }
  // Claim before external call / wait.
  defeatedEmitState.set(stateKey, Date.now());
  while (defeatedEmitState.size > MAX_EMITTED) {
    const oldest = defeatedEmitState.keys().next().value;
    defeatedEmitState.delete(oldest);
  }

  const waitMs = Number.isFinite(opts.waitMs) ? Number(opts.waitMs) : DEFEAT_CAUSE_LOOKUP_MS;
  if (waitMs > 0) {
    await new Promise((resolve) => {
      schedule(resolve, waitMs);
    });
  }

  // Resolve token UUID if missing from combatant.tokenId
  let tokenUuid = evaluation.tokenUuid;
  if (!tokenUuid && combatant?.tokenId) {
    try {
      const scene = combatant.combat?.scene ?? canvas?.scene;
      const token = scene?.tokens?.get?.(combatant.tokenId);
      tokenUuid = safeString(token?.uuid);
    } catch {
      tokenUuid = null;
    }
  }

  const lethal = findLethalCauseForTarget({
    actorUuid: evaluation.actorUuid,
    tokenUuid,
  });

  const defeatedTransactionId = `defeated:${evaluation.combatId}:${evaluation.combatantId}:${Date.now()}`;
  const payload = buildDefeatedPayload({
    transactionId: defeatedTransactionId,
    target: {
      actorUuid: evaluation.actorUuid,
      tokenUuid,
      name: evaluation.targetName,
      img: evaluation.targetImg,
    },
    source: lethal?.source?.actorUuid || lethal?.source?.tokenUuid ? lethal.source : null,
    cause: lethal
      ? { type: lethal.type, transactionId: lethal.transactionId }
      : null,
    sceneId: evaluation.sceneId,
  });
  if (!payload) {
    defeatedEmitState.delete(stateKey);
    return { emitted: false, reason: "payload-invalid" };
  }

  try {
    if (typeof runtime.normalize === "function") {
      try {
        runtime.normalize(payload);
      } catch {
        /* optional */
      }
    }
    await runtime.broadcast(payload);
    rememberRecent({
      transactionId: payload.transactionId,
      combatId: evaluation.combatId,
      combatantId: evaluation.combatantId,
      targetName: payload.target.name,
      causeType: payload.cause?.type ?? null,
      causeTransactionId: payload.cause?.transactionId ?? null,
      outcome: "emitted",
      reason: null,
      emittedAt: Date.now(),
    });
    return { emitted: true, payload };
  } catch (error) {
    logger.warn("NelCine defeated presentation failed", {
      stage: "nelcine-defeated",
      reason: error instanceof Error ? error.message : String(error),
    });
    rememberRecent({
      transactionId: payload.transactionId,
      combatId: evaluation.combatId,
      combatantId: evaluation.combatantId,
      targetName: payload.target.name,
      causeType: payload.cause?.type ?? null,
      causeTransactionId: payload.cause?.transactionId ?? null,
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
      emittedAt: Date.now(),
    });
    // Keep emit state so duplicate hooks after a failed broadcast do not spam;
    // undefeated clears eligibility.
    return { emitted: false, reason: "broadcast-failed" };
  }
}

function onUpdateCombatant(combatant, changed, _options, _userId) {
  if (game.ready !== true) return;
  if (!("defeated" in (changed ?? {}))) return;
  void presentNpcDefeatFromCombatant(combatant, changed).catch((error) => {
    logger.warn("Defeated presentation failed open", {
      stage: "nelcine-defeated",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

export function registerNelcineDefeatedHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  if (typeof Hooks === "undefined") return;
  Hooks.on("updateCombatant", onUpdateCombatant);
}

export function getDefeatedIntegrationStatus() {
  const runtime = detectNelcineDefeatedRuntime();
  return {
    available: runtime.active === true,
    active: runtime.active === true,
    enabled: readDefeatedSettingEnabled(),
    npcOnly: true,
    nelcineVersion: runtime.version,
    hasBroadcastApi: runtime.hasBroadcastApi,
    isAuthoritativeEmitter: isAuthoritativeDefeatedEmitter(),
  };
}

export function getRecentDefeatedEvents() {
  if (game.user?.isGM !== true) return [];
  return recentEvents.map((entry) => ({ ...entry }));
}

export function watchDefeatedCinematics() {
  if (game.user?.isGM !== true) return false;
  if (watcher) return true;
  watcher = (entry) => {
    if (entry.outcome === "emitted") {
      console.debug(
        "NelFlow | Defeated | DEFEATED",
        entry.targetName,
        entry.causeType ? `← ${entry.causeType}` : "← manual",
        entry.causeTransactionId ?? null,
      );
      return;
    }
    console.debug("NelFlow | Defeated | SUPPRESSED", entry.reason, entry.targetName);
  };
  return true;
}

export function stopWatchingDefeatedCinematics() {
  const had = Boolean(watcher);
  watcher = null;
  return had;
}

/**
 * Presentation-only preview — does not mutate combat/HP.
 */
export async function previewResolvedNpcDefeat(event = {}) {
  if (game.user?.isGM !== true) return { emitted: false, reason: "not-gm" };
  if (!readDefeatedSettingEnabled()) return { emitted: false, reason: "setting-disabled" };
  if (!isAuthoritativeDefeatedEmitter()) return { emitted: false, reason: "not-authoritative-emitter" };
  const runtime = detectNelcineDefeatedRuntime();
  if (!runtime.active) return { emitted: false, reason: "nelcine-inactive" };
  if (!runtime.hasBroadcastApi) return { emitted: false, reason: "missing-broadcast-api" };

  const payload = buildDefeatedPayload({
    transactionId: safeString(event.transactionId) ?? `defeated:preview:${Date.now()}`,
    target: {
      actorUuid: safeString(event.targetActorUuid),
      tokenUuid: safeString(event.targetTokenUuid),
      name: safeString(event.targetName) ?? "NPC",
      img: safeString(event.targetImg),
    },
    source: event.sourceActorUuid
      ? {
          actorUuid: safeString(event.sourceActorUuid),
          tokenUuid: safeString(event.sourceTokenUuid),
          name: safeString(event.sourceName),
          img: safeString(event.sourceImg),
        }
      : null,
    cause:
      event.causeType && event.causeTransactionId
        ? { type: safeString(event.causeType), transactionId: safeString(event.causeTransactionId) }
        : null,
    sceneId: safeString(event.sceneId) ?? safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };
  try {
    await runtime.broadcast(payload);
    rememberRecent({
      transactionId: payload.transactionId,
      combatId: null,
      combatantId: null,
      targetName: payload.target.name,
      causeType: payload.cause?.type ?? null,
      causeTransactionId: payload.cause?.transactionId ?? null,
      outcome: "emitted",
      reason: "preview",
      emittedAt: Date.now(),
    });
    return { emitted: true, payload };
  } catch (error) {
    return { emitted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function installDefeatedPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.integrations.nelcineDefeated = Object.freeze({
    getStatus: () => getDefeatedIntegrationStatus(),
    getRecent: () => getRecentDefeatedEvents(),
  });
  root.dev = root.dev ?? {};
  root.dev.watchDefeatedCinematics = () => watchDefeatedCinematics();
  root.dev.stopWatchingDefeatedCinematics = () => stopWatchingDefeatedCinematics();
  root.dev.previewResolvedNpcDefeat = (event) => previewResolvedNpcDefeat(event);
}

export function clearDefeatedBridgeState() {
  defeatedEmitState.clear();
  lethalByTarget.clear();
  recentEvents.length = 0;
  watcher = null;
}
