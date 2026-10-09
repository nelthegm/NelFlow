/**
 * Shield Block gate for Strike auto-apply.
 *
 * When a target has Raise a Shield active (system.attributes.shield.raised),
 * NelFlow defers auto-apply so PF2e's native damage-card Shield Block toggle
 * (`data-action="shield-block"`) and Apply Damage remain interactive.
 *
 * PF2e Actor#applyDamage({ shieldBlockRequest }) does not show a player dialog;
 * it immediately applies shield hardness when the boolean is true. The usable
 * interactive workflow is therefore the native chat-card toggle + Apply.
 *
 * Scope: Strike auto-apply only (PC / NPC / multi-target). Spell attacks and
 * save damage paths must not enable this gate.
 */

import { SETTINGS } from "./constants.js";
import { getSetting } from "./settings.js";

export const SHIELD_BLOCK_SOCKET_ACTION = "shield-block-prompt";
export const SHIELD_BLOCK_RESPONSE_ACTION = "shield-block-response";
export const SHIELD_BLOCK_PROMPT_TIMEOUT_MS = 45_000;

/**
 * Authoritative PF2e raised-shield signal (Raise a Shield effect overrides this path).
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function isShieldRaised(actor) {
  return actor?.system?.attributes?.shield?.raised === true;
}

/**
 * Resolve whether Strike auto-apply must defer to PF2e's native Shield Block UI.
 * @param {{ targetToken: *, targetActor?: *, applicationId?: string|null }} args
 * @returns {Promise<{
 *   block: boolean,
 *   reason: string,
 *   prompted: boolean,
 *   deferToNative: boolean,
 * }>}
 */
export async function resolveShieldBlockForApplication(args = {}) {
  const targetActor = args.targetActor ?? args.targetToken?.actor ?? null;
  if (getSetting(SETTINGS.PROMPT_SHIELD_BLOCK) !== true) {
    return { block: false, reason: "setting-off", prompted: false, deferToNative: false };
  }
  if (!isShieldRaised(targetActor)) {
    return { block: false, reason: "shield-not-raised", prompted: false, deferToNative: false };
  }

  // Keep the native damage card interactive. Do not open a replacement Dialog
  // or wait on sockets — that hung stacks when the player never received UI.
  return {
    block: false,
    reason: "defer-to-native-shield-block",
    prompted: false,
    deferToNative: true,
  };
}

/** Install socket listeners — retained as no-op ready hook for compatibility. */
export function initializeShieldBlockGate() {
  /* Dialog/socket prompt removed in 0.14.22; native PF2e card owns Shield Block. */
}

/** Test helper */
export function clearShieldBlockGatePending() {
  /* no pending Dialog/socket state */
}

/**
 * Legacy helper retained for tests that still resolve chooser identity.
 * Prefer active non-GM OWNER of the target actor; else character owner; else GM.
 */
export function resolveShieldBlockChooserUserId(targetToken) {
  const actor = targetToken?.actor ?? targetToken?.document?.actor ?? null;
  if (!actor || !game.users) {
    return game.user?.id ?? null;
  }

  const ownershipLevels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS;
  const ownerLevel = Number.isFinite(ownershipLevels?.OWNER) ? ownershipLevels.OWNER : 3;

  /** @type {string[]} */
  const playerOwnerIds = [];
  const ownership = actor.ownership ?? {};
  for (const [userId, level] of Object.entries(ownership)) {
    if (userId === "default") continue;
    if (Number(level) < ownerLevel) continue;
    const user = game.users.get?.(userId);
    if (user?.active === true && user.isGM !== true) playerOwnerIds.push(userId);
  }
  if (playerOwnerIds.length) return playerOwnerIds[0];

  const characterOwner = [...(game.users ?? [])].find(
    (user) => user.active === true && user.character?.id && user.character.id === actor.id,
  );
  if (characterOwner?.id) return characterOwner.id;

  const gm = [...(game.users ?? [])].find((user) => user.active === true && user.isGM === true);
  return gm?.id ?? game.user?.id ?? null;
}

/** @deprecated Dialog path removed; kept for source-compat tests that import the symbol. */
export async function promptShieldBlockLocally() {
  return { block: false, reason: "defer-to-native-shield-block" };
}
