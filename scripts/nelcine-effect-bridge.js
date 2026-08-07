/**
 * NelCine healing & condition presentation bridge (0.11.0 / Slice 3B).
 * Presentation only — never delays or mutates healing/conditions.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";

export const NELCINE_MODULE_ID = "nelcine";
export const EFFECT_KINDS = Object.freeze({
  HEALING: "healing",
  CONDITION_GAIN: "condition-gain",
  CONDITION_REMOVE: "condition-remove",
  BENEFICIAL: "beneficial",
  HARMFUL: "harmful",
});

const MAX_RECENT = 40;
const MAX_EMITTED = 80;
const CONDITION_TYPE = "condition";

/** @type {Map<string, number>} */
const emittedKeys = new Map();
/** @type {Map<string, number|null>} previous valued-condition values (preUpdate) */
const pendingConditionValues = new Map();
/** @type {object[]} */
const recentEvents = [];
/** @type {((summary: object) => void)|null} */
let watcher = null;
let hooksRegistered = false;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Actual HP healing from PF2e AppliedDamageFlag updates.
 * update.value = preUpdate - newValue; healing yields a negative delta.
 * @param {object|null|undefined} appliedDamage
 * @returns {number|null}
 */
export function actualHealingFromAppliedDamage(appliedDamage) {
  if (!appliedDamage || appliedDamage.isHealing !== true) return null;
  const updates = Array.isArray(appliedDamage.updates) ? appliedDamage.updates : [];
  let total = 0;
  let found = false;
  for (const entry of updates) {
    const path = safeString(entry?.path);
    if (!path || !/attributes\.hp\.value$/.test(path)) continue;
    const delta = Number(entry.value);
    if (!Number.isFinite(delta)) continue;
    // pre - new: healing increases HP → negative difference
    total += Math.max(0, -delta);
    found = true;
  }
  if (!found) return null;
  return total;
}

/**
 * @param {object} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateEffectPresentationEligibility(ctx = {}) {
  if (ctx.gameReady !== true) return { eligible: false, reason: "game-not-ready" };
  if (ctx.masterEnabled !== true) return { eligible: false, reason: "master-disabled" };
  if (ctx.kindEnabled !== true) return { eligible: false, reason: "kind-disabled" };
  if (ctx.isGM !== true) return { eligible: false, reason: "not-gm" };
  if (ctx.isAuthoritativeEmitter !== true) {
    return { eligible: false, reason: "not-authoritative-emitter" };
  }
  if (ctx.nelcineActive !== true) return { eligible: false, reason: "nelcine-inactive" };
  if (ctx.hasBroadcastApi !== true) return { eligible: false, reason: "missing-broadcast-api" };
  return { eligible: true };
}

/**
 * @returns {object}
 */
export function detectNelcineEffectRuntime() {
  const mod = game.modules?.get?.(NELCINE_MODULE_ID);
  const active = mod?.active === true;
  const api = game.nelcine ?? null;
  const broadcast =
    typeof api?.integrations?.nelflow?.broadcastEffect === "function"
      ? api.integrations.nelflow.broadcastEffect.bind(api.integrations.nelflow)
      : null;
  const normalize =
    typeof api?.integrations?.nelflow?.normalizeEffect === "function"
      ? api.integrations.nelflow.normalizeEffect.bind(api.integrations.nelflow)
      : null;
  const primaryGmApiAvailable = typeof api?.sync?.isPrimaryGM === "function";
  const isPrimaryGM = primaryGmApiAvailable ? Boolean(api.sync.isPrimaryGM()) : null;
  return {
    active,
    version: typeof mod?.version === "string" ? mod.version : null,
    broadcast,
    normalize,
    hasBroadcastApi: typeof broadcast === "function",
    primaryGmApiAvailable,
    isPrimaryGM,
  };
}

function readEffectSettings() {
  let masterEnabled = true;
  let healingEnabled = true;
  let conditionsEnabled = true;
  try {
    masterEnabled = getSetting(SETTINGS.NELCINE_EFFECT_CINEMATICS) !== false;
  } catch {
    masterEnabled = true;
  }
  try {
    healingEnabled = getSetting(SETTINGS.NELCINE_HEALING_CINEMATICS) !== false;
  } catch {
    healingEnabled = true;
  }
  try {
    conditionsEnabled = getSetting(SETTINGS.NELCINE_CONDITION_CINEMATICS) !== false;
  } catch {
    conditionsEnabled = true;
  }
  return { masterEnabled, healingEnabled, conditionsEnabled };
}

/**
 * Primary GM (or elected sole active GM) for generic observation.
 * @returns {boolean}
 */
export function isAuthoritativeEffectEmitter() {
  if (game.user?.isGM !== true) return false;
  const runtime = detectNelcineEffectRuntime();
  if (runtime.primaryGmApiAvailable) return runtime.isPrimaryGM === true;
  const elected = electProcessingGm(game.users ?? [], game.user.id);
  return elected === game.user.id;
}

/**
 * @param {string} key
 * @returns {boolean} true if this is the first claim
 */
export function claimEffectPresentationKey(key) {
  if (typeof key !== "string" || !key) return false;
  if (emittedKeys.has(key)) return false;
  emittedKeys.set(key, Date.now());
  while (emittedKeys.size > MAX_EMITTED) {
    const oldest = emittedKeys.keys().next().value;
    emittedKeys.delete(oldest);
  }
  return true;
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
 * Build a display-safe effect payload. Never includes HP snapshots or documents.
 * @param {object} input
 * @returns {object|null}
 */
export function buildEffectPayload(input = {}) {
  const effectKind = safeString(input.effectKind);
  if (!effectKind || !Object.values(EFFECT_KINDS).includes(effectKind)) return null;
  const transactionId = safeString(input.transactionId);
  if (!transactionId) return null;

  const payload = {
    schemaVersion: 1,
    transactionId,
    type: "effect",
    effectKind,
    source: null,
    target: null,
    action: null,
    value: null,
    condition: null,
    detail: null,
    sceneId: safeString(input.sceneId),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };

  if (input.source && typeof input.source === "object") {
    payload.source = {
      tokenUuid: safeString(input.source.tokenUuid),
      actorUuid: safeString(input.source.actorUuid),
    };
  }
  if (input.target && typeof input.target === "object") {
    payload.target = {
      tokenUuid: safeString(input.target.tokenUuid),
      actorUuid: safeString(input.target.actorUuid),
    };
  }
  if (input.action && typeof input.action === "object") {
    const name = safeString(input.action.name);
    if (name) {
      payload.action = {
        name,
        img: safeString(input.action.img),
      };
    }
  }
  if (Number.isFinite(input.value)) payload.value = Number(input.value);
  if (input.condition && typeof input.condition === "object") {
    const slug = safeString(input.condition.slug);
    const name = safeString(input.condition.name);
    if (slug || name) {
      payload.condition = {
        slug,
        name: name ?? slug,
        img: safeString(input.condition.img),
        value: Number.isFinite(input.condition.value) ? Number(input.condition.value) : null,
      };
    }
  }
  if (safeString(input.detail)) payload.detail = safeString(input.detail);

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
  return payload;
}

/**
 * @param {object} args
 * @returns {Promise<{ emitted: boolean, reason?: string }>}
 */
export async function emitEffectPresentation({
  dedupeKey,
  payload,
  logLabel = null,
} = {}) {
  const settings = readEffectSettings();
  const runtime = detectNelcineEffectRuntime();
  const kind = payload?.effectKind;
  const kindEnabled =
    kind === EFFECT_KINDS.HEALING
      ? settings.healingEnabled
      : kind === EFFECT_KINDS.CONDITION_GAIN || kind === EFFECT_KINDS.CONDITION_REMOVE
        ? settings.conditionsEnabled
        : settings.masterEnabled;

  const gate = evaluateEffectPresentationEligibility({
    gameReady: game.ready === true,
    masterEnabled: settings.masterEnabled,
    kindEnabled,
    isGM: game.user?.isGM === true,
    isAuthoritativeEmitter: isAuthoritativeEffectEmitter(),
    nelcineActive: runtime.active,
    hasBroadcastApi: runtime.hasBroadcastApi,
  });
  if (!gate.eligible) {
    rememberRecent({
      kind,
      transactionId: payload?.transactionId ?? null,
      targetName: null,
      actionName: payload?.action?.name ?? null,
      conditionSlug: payload?.condition?.slug ?? null,
      conditionValue: payload?.condition?.value ?? null,
      value: payload?.value ?? null,
      emittedAt: Date.now(),
      outcome: "suppressed",
      reason: gate.reason,
    });
    return { emitted: false, reason: gate.reason };
  }

  if (!claimEffectPresentationKey(dedupeKey)) {
    rememberRecent({
      kind,
      transactionId: payload?.transactionId ?? null,
      targetName: null,
      actionName: payload?.action?.name ?? null,
      conditionSlug: payload?.condition?.slug ?? null,
      conditionValue: payload?.condition?.value ?? null,
      value: payload?.value ?? null,
      emittedAt: Date.now(),
      outcome: "suppressed",
      reason: "duplicate",
    });
    return { emitted: false, reason: "duplicate" };
  }

  try {
    if (typeof runtime.normalize === "function") {
      try {
        runtime.normalize(payload);
      } catch {
        /* normalize is optional validation */
      }
    }
    await runtime.broadcast(payload);
    rememberRecent({
      kind,
      transactionId: payload.transactionId,
      targetName: logLabel?.targetName ?? null,
      actionName: payload.action?.name ?? null,
      conditionSlug: payload.condition?.slug ?? null,
      conditionValue: payload.condition?.value ?? null,
      value: payload.value ?? null,
      emittedAt: Date.now(),
      outcome: "emitted",
      reason: null,
    });
    return { emitted: true };
  } catch (error) {
    logger.warn("NelCine effect presentation failed", {
      stage: "nelcine-effect",
      reason: error instanceof Error ? error.message : String(error),
    });
    rememberRecent({
      kind,
      transactionId: payload?.transactionId ?? null,
      targetName: logLabel?.targetName ?? null,
      actionName: payload?.action?.name ?? null,
      conditionSlug: payload?.condition?.slug ?? null,
      conditionValue: payload?.condition?.value ?? null,
      value: payload?.value ?? null,
      emittedAt: Date.now(),
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { emitted: false, reason: "broadcast-failed" };
  }
}

/**
 * Handle a completed PF2e damage-taken healing message.
 * @param {ChatMessage} message
 * @returns {Promise<{ emitted: boolean, reason?: string }>}
 */
export async function presentHealingFromDamageTakenMessage(message) {
  const flags = message?.flags?.pf2e;
  const applied = flags?.appliedDamage;
  if (flags?.context?.type !== "damage-taken" || applied?.isHealing !== true) {
    return { emitted: false, reason: "not-healing-taken" };
  }

  const actual = actualHealingFromAppliedDamage(applied);
  if (actual === 0) {
    rememberRecent({
      kind: EFFECT_KINDS.HEALING,
      transactionId: message.id,
      targetName: null,
      actionName: null,
      conditionSlug: null,
      conditionValue: null,
      value: 0,
      emittedAt: Date.now(),
      outcome: "suppressed",
      reason: "zero-heal",
    });
    return { emitted: false, reason: "zero-heal" };
  }
  if (actual == null) {
    return { emitted: false, reason: "unknown-heal-amount" };
  }

  const origin = flags.origin ?? null;
  const tokenDoc =
    typeof message.speaker?.token === "string"
      ? canvas?.scene?.tokens?.get?.(message.speaker.token) ?? null
      : message.token ?? null;
  const actor = message.actor ?? tokenDoc?.actor ?? null;
  // Prefer resolved item name when PF2e exposes it; never invent from chat HTML.
  const resolvedItem = message.item ?? null;
  const actionName = safeString(resolvedItem?.name) ?? "Heal";
  const actionImg = safeString(resolvedItem?.img);

  const payload = buildEffectPayload({
    transactionId: `healing:${message.id}`,
    effectKind: EFFECT_KINDS.HEALING,
    value: actual,
    source: {
      actorUuid: safeString(origin?.actor),
      tokenUuid: null,
    },
    target: {
      actorUuid: safeString(applied.uuid) ?? safeString(actor?.uuid),
      tokenUuid: safeString(tokenDoc?.uuid),
    },
    action: {
      name: actionName,
      img: actionImg,
    },
    sceneId: safeString(tokenDoc?.parent?.id) ?? safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };

  return emitEffectPresentation({
    dedupeKey: `healing:${message.id}`,
    payload,
    logLabel: { targetName: safeString(tokenDoc?.name) ?? safeString(actor?.name) },
  });
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isPf2eConditionItem(item) {
  return item?.type === CONDITION_TYPE && !item?.pack;
}

/**
 * @param {Item} item
 * @returns {{ slug: string|null, name: string|null, img: string|null, value: number|null }}
 */
export function conditionDisplayFields(item) {
  const slug = safeString(item?.system?.slug) ?? safeString(item?.slug);
  const name = safeString(item?.name) ?? slug;
  const img = safeString(item?.img);
  // Prefer system.value.value; do not coerce null → 0 (unvalued conditions).
  const rawValue = item?.system?.value?.value;
  const value =
    rawValue === null || rawValue === undefined
      ? null
      : Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : null;
  return { slug, name, img, value };
}

function conditionActorEligible(actor) {
  if (!actor || actor.pack) return false;
  if (actor.isToken === true && !actor.token) return false;
  return true;
}

/**
 * @param {Item} item
 * @param {"condition-gain"|"condition-remove"} effectKind
 * @param {{ previousValue?: number|null, forceValue?: number|null }} [opts]
 */
export async function presentConditionChange(item, effectKind, opts = {}) {
  if (!isPf2eConditionItem(item)) return { emitted: false, reason: "not-condition" };
  const actor = item.actor;
  if (!conditionActorEligible(actor)) return { emitted: false, reason: "actor-ineligible" };

  const fields = conditionDisplayFields(item);
  if (!fields.slug && !fields.name) return { emitted: false, reason: "missing-condition-identity" };

  const value =
    effectKind === EFFECT_KINDS.CONDITION_REMOVE
      ? null
      : Number.isFinite(opts.forceValue)
        ? Number(opts.forceValue)
        : fields.value;

  const tokenDoc = actor.getActiveTokens?.(true, true)?.[0]?.document ?? actor.token ?? null;
  const transactionId =
    effectKind === EFFECT_KINDS.CONDITION_REMOVE
      ? `condition-remove:${actor.uuid}:${fields.slug}:${item.id}`
      : `condition-gain:${actor.uuid}:${fields.slug}:${item.id}:${value ?? "x"}`;

  const payload = buildEffectPayload({
    transactionId,
    effectKind,
    condition: {
      slug: fields.slug,
      name: fields.name,
      img: fields.img,
      value,
    },
    action: {
      name: fields.name ?? fields.slug,
      img: fields.img,
    },
    target: {
      actorUuid: safeString(actor.uuid),
      tokenUuid: safeString(tokenDoc?.uuid),
    },
    source: null,
    sceneId: safeString(tokenDoc?.parent?.id) ?? safeString(canvas?.scene?.id),
    detail: effectKind === EFFECT_KINDS.CONDITION_REMOVE ? "removed" : null,
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };

  return emitEffectPresentation({
    dedupeKey: transactionId,
    payload,
    logLabel: { targetName: safeString(tokenDoc?.name) ?? safeString(actor.name) },
  });
}

/**
 * Valued condition update: increase → gain cinematic; decrease → suppress.
 * @param {Item} item
 * @param {object} changes
 * @param {object} [options]
 */
export async function presentConditionValueUpdate(item, changes, options = {}) {
  if (!isPf2eConditionItem(item)) return { emitted: false, reason: "not-condition" };
  const nextRaw = changes?.system?.value?.value ?? changes?.system?.value;
  if (nextRaw === undefined && !Number.isFinite(options.nextValue)) {
    return { emitted: false, reason: "no-value-change" };
  }
  const next = Number.isFinite(options.nextValue)
    ? Number(options.nextValue)
    : Number(nextRaw);
  const prev = Number(options.previousValue);
  if (!Number.isFinite(next) || !Number.isFinite(prev)) {
    return { emitted: false, reason: "non-finite-value" };
  }
  if (next === prev) return { emitted: false, reason: "unchanged" };
  if (next < prev) {
    rememberRecent({
      kind: EFFECT_KINDS.CONDITION_GAIN,
      transactionId: item.id,
      targetName: null,
      actionName: null,
      conditionSlug: item.system?.slug ?? null,
      conditionValue: next,
      value: null,
      emittedAt: Date.now(),
      outcome: "suppressed",
      reason: "condition-decrement",
    });
    return { emitted: false, reason: "condition-decrement" };
  }
  // Increase: present as condition-gain with new authoritative value.
  return presentConditionChange(item, EFFECT_KINDS.CONDITION_GAIN, { forceValue: next });
}

function onCreateChatMessage(message) {
  void presentHealingFromDamageTakenMessage(message).catch((error) => {
    logger.warn("Healing presentation failed open", {
      stage: "nelcine-effect-heal",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

function onCreateItem(item, _data, options = {}) {
  if (game.ready !== true) return;
  if (options?.pack || item?.pack) return;
  if (!isPf2eConditionItem(item)) return;
  if (!isAuthoritativeEffectEmitter()) return;
  void presentConditionChange(item, EFFECT_KINDS.CONDITION_GAIN).catch((error) => {
    logger.warn("Condition-gain presentation failed open", {
      stage: "nelcine-effect-condition",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

function onPreUpdateItem(item, changes, options = {}) {
  if (game.ready !== true) return;
  if (options?.pack || item?.pack) return;
  if (!isPf2eConditionItem(item)) return;
  const nextRaw = changes?.system?.value?.value ?? changes?.system?.value;
  if (nextRaw === undefined) return;
  const key = safeString(item.uuid) ?? safeString(item.id);
  if (!key) return;
  const prevRaw = item.system?.value?.value;
  const prev = Number(prevRaw);
  pendingConditionValues.set(key, Number.isFinite(prev) ? prev : null);
}

function onUpdateItem(item, changes, options = {}) {
  if (game.ready !== true) return;
  if (options?.pack || item?.pack) return;
  if (!isPf2eConditionItem(item)) return;
  if (!isAuthoritativeEffectEmitter()) return;
  const key = safeString(item.uuid) ?? safeString(item.id);
  const previousValue = key != null ? pendingConditionValues.get(key) : undefined;
  if (key) pendingConditionValues.delete(key);
  const nextRaw = changes?.system?.value?.value ?? changes?.system?.value;
  if (nextRaw === undefined && previousValue === undefined) return;
  const next =
    nextRaw !== undefined
      ? Number(nextRaw)
      : Number(item.system?.value?.value);
  void presentConditionValueUpdate(item, changes, {
    previousValue,
    nextValue: next,
  }).catch((error) => {
    logger.warn("Condition-update presentation failed open", {
      stage: "nelcine-effect-condition",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

function onDeleteItem(item, options = {}) {
  if (game.ready !== true) return;
  if (options?.pack || item?.pack) return;
  if (!isPf2eConditionItem(item)) return;
  if (!isAuthoritativeEffectEmitter()) return;
  void presentConditionChange(item, EFFECT_KINDS.CONDITION_REMOVE).catch((error) => {
    logger.warn("Condition-remove presentation failed open", {
      stage: "nelcine-effect-condition",
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Register Foundry hooks once.
 */
export function registerNelcineEffectHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  if (typeof Hooks === "undefined") return;
  Hooks.on("createChatMessage", onCreateChatMessage);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("preUpdateItem", onPreUpdateItem);
  Hooks.on("updateItem", onUpdateItem);
  Hooks.on("deleteItem", onDeleteItem);
}

export function getEffectIntegrationStatus() {
  const settings = readEffectSettings();
  const runtime = detectNelcineEffectRuntime();
  return {
    available: runtime.active === true,
    active: runtime.active === true,
    masterEnabled: settings.masterEnabled,
    healingEnabled: settings.healingEnabled,
    conditionsEnabled: settings.conditionsEnabled,
    nelcineVersion: runtime.version,
    hasBroadcastApi: runtime.hasBroadcastApi,
    isAuthoritativeEmitter: isAuthoritativeEffectEmitter(),
  };
}

export function getRecentEffectEvents() {
  if (game.user?.isGM !== true) return [];
  return recentEvents.map((entry) => ({ ...entry }));
}

export function watchEffectCinematics() {
  if (game.user?.isGM !== true) return false;
  if (watcher) return true;
  watcher = (entry) => {
    const kind = entry.kind;
    if (entry.outcome === "suppressed") {
      console.debug("NelFlow | Effect | SUPPRESSED", entry.reason, {
        kind,
        condition: entry.conditionSlug,
        value: entry.value,
      });
      return;
    }
    if (kind === EFFECT_KINDS.HEALING) {
      console.debug(
        "NelFlow | Effect | HEAL",
        entry.value != null ? `+${entry.value}` : null,
        entry.targetName ? `→ ${entry.targetName}` : null,
      );
      return;
    }
    if (kind === EFFECT_KINDS.CONDITION_GAIN) {
      console.debug(
        "NelFlow | Effect | CONDITION +",
        entry.conditionSlug,
        entry.conditionValue,
        entry.targetName ? `→ ${entry.targetName}` : null,
      );
      return;
    }
    if (kind === EFFECT_KINDS.CONDITION_REMOVE) {
      console.debug(
        "NelFlow | Effect | CONDITION -",
        entry.conditionSlug,
        entry.targetName ? `→ ${entry.targetName}` : null,
      );
    }
  };
  return true;
}

export function stopWatchingEffectCinematics() {
  const had = Boolean(watcher);
  watcher = null;
  return had;
}

/**
 * Dev preview: presentation only, no mechanics.
 * @param {object} event
 */
export async function previewResolvedHealingEvent(event = {}) {
  if (game.user?.isGM !== true) return { emitted: false, reason: "not-gm" };
  const payload = buildEffectPayload({
    transactionId: safeString(event.transactionId) ?? `healing:preview:${Date.now()}`,
    effectKind: EFFECT_KINDS.HEALING,
    value: Number.isFinite(event.value) ? Number(event.value) : null,
    action: { name: safeString(event.actionName) ?? "Heal", img: safeString(event.img) },
    target: {
      actorUuid: safeString(event.targetActorUuid),
      tokenUuid: safeString(event.targetTokenUuid),
    },
    source: {
      actorUuid: safeString(event.sourceActorUuid),
      tokenUuid: safeString(event.sourceTokenUuid),
    },
    sceneId: safeString(event.sceneId) ?? safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };
  if (payload.value === 0) return { emitted: false, reason: "zero-heal" };
  return emitEffectPresentation({
    dedupeKey: payload.transactionId,
    payload,
    logLabel: { targetName: safeString(event.targetName) },
  });
}

/**
 * Dev preview: presentation only, no mechanics.
 * @param {object} event
 */
export async function previewResolvedConditionEvent(event = {}) {
  if (game.user?.isGM !== true) return { emitted: false, reason: "not-gm" };
  const effectKind =
    event.effectKind === EFFECT_KINDS.CONDITION_REMOVE
      ? EFFECT_KINDS.CONDITION_REMOVE
      : EFFECT_KINDS.CONDITION_GAIN;
  const payload = buildEffectPayload({
    transactionId:
      safeString(event.transactionId) ??
      `condition-preview:${effectKind}:${Date.now()}`,
    effectKind,
    condition: {
      slug: safeString(event.slug),
      name: safeString(event.name) ?? safeString(event.slug),
      img: safeString(event.img),
      value: Number.isFinite(event.value) ? Number(event.value) : null,
    },
    action: {
      name: safeString(event.name) ?? safeString(event.slug) ?? "Condition",
      img: safeString(event.img),
    },
    target: {
      actorUuid: safeString(event.targetActorUuid),
      tokenUuid: safeString(event.targetTokenUuid),
    },
    detail: effectKind === EFFECT_KINDS.CONDITION_REMOVE ? "removed" : null,
    sceneId: safeString(event.sceneId) ?? safeString(canvas?.scene?.id),
  });
  if (!payload) return { emitted: false, reason: "payload-invalid" };
  return emitEffectPresentation({
    dedupeKey: payload.transactionId,
    payload,
    logLabel: { targetName: safeString(event.targetName) },
  });
}

export function installEffectPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.integrations.nelcineEffects = Object.freeze({
    getStatus: () => getEffectIntegrationStatus(),
    getRecent: () => getRecentEffectEvents(),
  });
  root.dev = root.dev ?? {};
  root.dev.watchEffectCinematics = () => watchEffectCinematics();
  root.dev.stopWatchingEffectCinematics = () => stopWatchingEffectCinematics();
  root.dev.previewResolvedHealingEvent = (event) => previewResolvedHealingEvent(event);
  root.dev.previewResolvedConditionEvent = (event) => previewResolvedConditionEvent(event);
}

export function clearEffectBridgeState() {
  emittedKeys.clear();
  pendingConditionValues.clear();
  recentEvents.length = 0;
  watcher = null;
}

// Keep MODULE_ID available for future durable flags without forcing persistence now.
void MODULE_ID;
