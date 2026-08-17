/**
 * Presentation-neutral spell-attack damage feed (protocol 1).
 * Stages: damageRolled (pre-apply) + damageApplied (post-snapshot).
 * No attack-roll presentation — generic-check consumers already cover attack rolls.
 */

import { deriveActualStrikeHpLoss } from "./strike-presentation-feed.js";
import {
  buildSpellAttackDamageAppliedResultId,
  buildSpellAttackDamageRolledResultId,
} from "./spell-attack-model.js";

export const SPELL_ATTACK_PRESENTATION_PROTOCOL = 1;
export const SPELL_ATTACK_DAMAGE_ROLLED_HOOK = "nelflow.spellAttackDamageRolledPresentation";
export const SPELL_ATTACK_DAMAGE_APPLIED_HOOK = "nelflow.spellAttackDamageAppliedPresentation";

const rolledEmitted = new Map();
const appliedEmitted = new Map();
const MAX = 128;

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function remember(map, key, payload) {
  if (!key) return;
  map.set(key, { at: Date.now(), payload });
  while (map.size > MAX) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function emitHook(hook, payload) {
  if (typeof globalThis.Hooks?.callAll !== "function") return;
  try {
    Hooks.callAll(hook, payload);
  } catch {
    /* fail open */
  }
}

export function buildSpellAttackDamageRolledPayload(args = {}) {
  const transactionId = safeString(args.transactionId);
  const targetTokenUuid = safeString(args.targetTokenUuid);
  const total = Number.isFinite(args.rolledTotal)
    ? Number(args.rolledTotal)
    : Number.isFinite(args.damage?.total)
      ? Number(args.damage.total)
      : null;
  if (!transactionId) return { ok: false, reason: "missing-transaction-id" };
  if (!targetTokenUuid) return { ok: false, reason: "missing-target-token" };
  if (total == null) return { ok: false, reason: "missing-rolled-total" };

  const damageResultId =
    safeString(args.damageResultId) ?? buildSpellAttackDamageRolledResultId(transactionId);

  /** @type {Record<string, unknown>} */
  const payload = {
    schemaVersion: 1,
    stage: "damageRolled",
    transactionId,
    damageResultId,
    targetTokenUuid,
    damage: { total },
    createdAt: Number.isFinite(args.createdAt) ? Number(args.createdAt) : Date.now(),
  };
  if (typeof args.formula === "string" && args.formula) payload.damage.formula = args.formula;

  for (const [key, value] of [
    ["sceneId", args.sceneId],
    ["sourceTokenUuid", args.sourceTokenUuid],
    ["sourceActorUuid", args.sourceActorUuid],
    ["targetActorUuid", args.targetActorUuid],
    ["itemUuid", args.itemUuid],
    ["actionName", args.actionName],
  ]) {
    const s = safeString(value);
    if (s) payload[key] = s;
  }

  const attack = {};
  if (safeString(args.outcome)) attack.degreeOfSuccess = safeString(args.outcome);
  if (args.critical === true || args.critical === false) attack.critical = args.critical;
  else if (args.outcome === "criticalSuccess") attack.critical = true;
  if (Object.keys(attack).length) payload.attack = attack;

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
}

export function buildSpellAttackDamageAppliedPayload(args = {}) {
  const transactionId = safeString(args.transactionId);
  const targetTokenUuid = safeString(args.targetTokenUuid);
  let applied = Number.isFinite(args.applied) ? Number(args.applied) : null;
  if (applied == null && Number.isFinite(args.damage?.applied)) {
    applied = Number(args.damage.applied);
  }
  if (applied == null && args.preApplication && args.postApplication) {
    applied = deriveActualStrikeHpLoss({
      preApplication: args.preApplication,
      postApplication: args.postApplication,
    });
  }
  if (!transactionId) return { ok: false, reason: "missing-transaction-id" };
  if (!targetTokenUuid) return { ok: false, reason: "missing-target-token" };
  if (applied == null || applied < 0) return { ok: false, reason: "missing-applied" };

  const damageResultId =
    safeString(args.damageResultId) ?? buildSpellAttackDamageAppliedResultId(transactionId);

  /** @type {Record<string, unknown>} */
  const payload = {
    schemaVersion: 1,
    stage: "damageApplied",
    transactionId,
    damageResultId,
    targetTokenUuid,
    damage: { applied },
    createdAt: Number.isFinite(args.createdAt) ? Number(args.createdAt) : Date.now(),
  };
  const rolled = Number.isFinite(args.rolledTotal) ? Number(args.rolledTotal) : null;
  if (rolled != null) payload.damage.rolledTotal = rolled;

  for (const [key, value] of [
    ["sceneId", args.sceneId],
    ["sourceTokenUuid", args.sourceTokenUuid],
    ["sourceActorUuid", args.sourceActorUuid],
    ["targetActorUuid", args.targetActorUuid],
    ["itemUuid", args.itemUuid],
    ["actionName", args.actionName],
  ]) {
    const s = safeString(value);
    if (s) payload[key] = s;
  }

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, reason: "serialization-failure" };
  }
  return { ok: true, payload };
}

export function tryEmitSpellAttackDamageRolledPresentation(args = {}) {
  const built = buildSpellAttackDamageRolledPayload(args);
  if (!built.ok) return { emitted: false, reason: built.reason };
  const key = built.payload.damageResultId;
  if (rolledEmitted.has(key)) return { emitted: false, reason: "duplicate" };
  remember(rolledEmitted, key, built.payload);
  emitHook(SPELL_ATTACK_DAMAGE_ROLLED_HOOK, built.payload);
  return { emitted: true, hook: SPELL_ATTACK_DAMAGE_ROLLED_HOOK, payload: built.payload };
}

export function tryEmitSpellAttackDamageAppliedPresentation(args = {}) {
  const built = buildSpellAttackDamageAppliedPayload(args);
  if (!built.ok) return { emitted: false, reason: built.reason };
  const key = built.payload.damageResultId;
  if (appliedEmitted.has(key)) return { emitted: false, reason: "duplicate" };
  remember(appliedEmitted, key, built.payload);
  emitHook(SPELL_ATTACK_DAMAGE_APPLIED_HOOK, built.payload);
  return { emitted: true, hook: SPELL_ATTACK_DAMAGE_APPLIED_HOOK, payload: built.payload };
}

export function installSpellAttackPresentationFeedApi() {
  const root = (globalThis.game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.dev = root.dev ?? {};

  root.integrations.spellAttackPresentation = Object.freeze({
    protocol: SPELL_ATTACK_PRESENTATION_PROTOCOL,
    damageRolledHook: SPELL_ATTACK_DAMAGE_ROLLED_HOOK,
    damageAppliedHook: SPELL_ATTACK_DAMAGE_APPLIED_HOOK,
    available: true,
    stages: Object.freeze({
      damageRolled: true,
      damageApplied: true,
    }),
  });
}

export function resetSpellAttackPresentationFeedForTests() {
  rolledEmitted.clear();
  appliedEmitted.clear();
}