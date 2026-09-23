/**
 * Shield Block gate for Strike auto-apply.
 *
 * When a target has Raise a Shield active (system.attributes.shield.raised),
 * pause before PF2e applyDamage and ask the token's controlling user whether
 * to Shield Block. PF2e remains authoritative for shield absorption via
 * shieldBlockRequest — NelFlow does not reimplement Shield Block math.
 *
 * Scope: Strike auto-apply only (PC / NPC / multi-target). Spell attacks and
 * save damage paths must not enable this gate.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { electProcessingGm } from "./toolbelt-target-helper-adapter.js";

export const SHIELD_BLOCK_SOCKET_ACTION = "shield-block-prompt";
export const SHIELD_BLOCK_RESPONSE_ACTION = "shield-block-response";
export const SHIELD_BLOCK_PROMPT_TIMEOUT_MS = 45_000;

const SOCKET_NAMESPACE = `module.${MODULE_ID}`;

/** @type {Map<string, { resolve: (value: { block: boolean, reason: string }) => void, timer: *, clear?: Function }>} */
const pendingByRequestId = new Map();

let initialized = false;

function localize(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch {
    return key;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

/**
 * Authoritative PF2e raised-shield signal (Raise a Shield effect overrides this path).
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function isShieldRaised(actor) {
  return actor?.system?.attributes?.shield?.raised === true;
}

/**
 * Prefer an active non-GM OWNER of the target actor; else active character owner;
 * else the processing GM.
 * @param {Token|TokenDocument|null|undefined} targetToken
 * @returns {string|null}
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

  const processing = electProcessingGm(game.users ?? [], null);
  return processing ?? game.user?.id ?? null;
}

/**
 * Local DialogV2 choice. Returns block:false on close/cancel.
 * @param {{ targetName?: string|null, applicationId?: string|null }} [args]
 * @returns {Promise<{ block: boolean, reason: string }>}
 */
export async function promptShieldBlockLocally(args = {}) {
  const targetName =
    typeof args.targetName === "string" && args.targetName.trim()
      ? args.targetName.trim()
      : localize("Nelflow.ShieldBlock.UnknownTarget");

  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== "function") {
    logger.warn("Shield Block prompt unavailable; applying without block", {
      stage: "shield-block-gate",
      reason: "dialog-unavailable",
      applicationId: args.applicationId ?? null,
    });
    return { block: false, reason: "dialog-unavailable" };
  }

  try {
    const action = await DialogV2.wait({
      window: { title: localize("Nelflow.ShieldBlock.Title") },
      content: `<p>${localize("Nelflow.ShieldBlock.Body", { target: escapeHtml(targetName) })}</p>
<p class="notes">${localize("Nelflow.ShieldBlock.UndoNote")}</p>`,
      modal: true,
      rejectClose: false,
      buttons: [
        {
          action: "block",
          label: localize("Nelflow.ShieldBlock.Block"),
          icon: "fa-solid fa-shield-halved",
          default: true,
        },
        {
          action: "no-block",
          label: localize("Nelflow.ShieldBlock.NoBlock"),
          icon: "fa-solid fa-forward",
        },
      ],
    });
    if (action === "block") return { block: true, reason: "user-block" };
    return { block: false, reason: action === "no-block" ? "user-no-block" : "dialog-closed" };
  } catch (error) {
    logger.warn("Shield Block dialog failed open; applying without block", {
      stage: "shield-block-gate",
      reason: error instanceof Error ? error.message : String(error),
      applicationId: args.applicationId ?? null,
    });
    return { block: false, reason: "dialog-failed" };
  }
}

function settlePending(requestId, result) {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) return;
  pendingByRequestId.delete(requestId);
  if (pending.timer != null && typeof pending.clear === "function") {
    pending.clear(pending.timer);
  }
  pending.resolve(result);
}

/**
 * Ask remote chooser via socket; timeout applies without block.
 * @param {{ requestId: string, chooserUserId: string, targetTokenUuid: string|null, targetName: string, applicationId: string|null, timeoutMs: number }} args
 * @returns {Promise<{ block: boolean, reason: string }>}
 */
function requestRemoteShieldBlockChoice(args) {
  return new Promise((resolve) => {
    const schedule = globalThis.setTimeout?.bind?.(globalThis);
    const clear = globalThis.clearTimeout?.bind?.(globalThis);
    const timer =
      typeof schedule === "function"
        ? schedule(() => {
            settlePending(args.requestId, { block: false, reason: "timeout" });
            logger.debug("Shield Block prompt timed out; applying without block", {
              stage: "shield-block-gate",
              applicationId: args.applicationId,
              requestId: args.requestId,
            });
          }, args.timeoutMs)
        : null;

    pendingByRequestId.set(args.requestId, {
      resolve,
      timer,
      clear,
    });

    try {
      game.socket?.emit?.(SOCKET_NAMESPACE, {
        action: SHIELD_BLOCK_SOCKET_ACTION,
        requestId: args.requestId,
        chooserUserId: args.chooserUserId,
        targetTokenUuid: args.targetTokenUuid,
        targetName: args.targetName,
        applicationId: args.applicationId,
      });
    } catch (error) {
      settlePending(args.requestId, { block: false, reason: "socket-emit-failed" });
      logger.warn("Shield Block socket emit failed; applying without block", {
        stage: "shield-block-gate",
        reason: error instanceof Error ? error.message : String(error),
        applicationId: args.applicationId,
      });
    }
  });
}

async function handleIncomingPrompt(raw) {
  if (raw?.action !== SHIELD_BLOCK_SOCKET_ACTION) return;
  if (raw.chooserUserId !== game.user?.id) return;
  const requestId = typeof raw.requestId === "string" ? raw.requestId : null;
  if (!requestId) return;

  const choice = await promptShieldBlockLocally({
    targetName: raw.targetName,
    applicationId: raw.applicationId,
  });

  try {
    game.socket?.emit?.(SOCKET_NAMESPACE, {
      action: SHIELD_BLOCK_RESPONSE_ACTION,
      requestId,
      block: choice.block === true,
      reason: choice.reason,
    });
  } catch (error) {
    logger.warn("Shield Block response emit failed", {
      stage: "shield-block-gate",
      reason: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

function handleIncomingResponse(raw) {
  if (raw?.action !== SHIELD_BLOCK_RESPONSE_ACTION) return;
  const requestId = typeof raw.requestId === "string" ? raw.requestId : null;
  if (!requestId || !pendingByRequestId.has(requestId)) return;
  settlePending(requestId, {
    block: raw.block === true,
    reason: typeof raw.reason === "string" ? raw.reason : "remote-response",
  });
}

/**
 * Resolve whether to pass shieldBlockRequest into PF2e applyDamage.
 * @param {{ targetToken: *, targetActor?: *, applicationId?: string|null, timeoutMs?: number }} args
 * @returns {Promise<{ block: boolean, reason: string, prompted: boolean }>}
 */
export async function resolveShieldBlockForApplication(args = {}) {
  const targetActor = args.targetActor ?? args.targetToken?.actor ?? null;
  if (getSetting(SETTINGS.PROMPT_SHIELD_BLOCK) !== true) {
    return { block: false, reason: "setting-off", prompted: false };
  }
  if (!isShieldRaised(targetActor)) {
    return { block: false, reason: "shield-not-raised", prompted: false };
  }

  const targetToken = args.targetToken;
  const targetName =
    targetToken?.name ??
    targetToken?.document?.name ??
    targetActor?.name ??
    localize("Nelflow.ShieldBlock.UnknownTarget");
  const targetTokenUuid =
    targetToken?.document?.uuid ?? targetToken?.uuid ?? null;
  const applicationId =
    typeof args.applicationId === "string" ? args.applicationId : null;
  const timeoutMs = Number.isFinite(args.timeoutMs)
    ? Number(args.timeoutMs)
    : SHIELD_BLOCK_PROMPT_TIMEOUT_MS;

  const chooserUserId = resolveShieldBlockChooserUserId(targetToken);
  if (!chooserUserId) {
    return { block: false, reason: "no-chooser", prompted: false };
  }

  if (chooserUserId === game.user?.id) {
    const local = await promptShieldBlockLocally({ targetName, applicationId });
    return { ...local, prompted: true };
  }

  const requestId = `${applicationId ?? "strike"}:shield-block:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  ui.notifications?.info?.(
    localize("Nelflow.ShieldBlock.Waiting", { target: targetName }),
    { localize: false },
  );
  const remote = await requestRemoteShieldBlockChoice({
    requestId,
    chooserUserId,
    targetTokenUuid,
    targetName,
    applicationId,
    timeoutMs,
  });
  return { ...remote, prompted: true };
}

/** Install socket listeners once at ready. */
export function initializeShieldBlockGate() {
  if (initialized) return;
  initialized = true;
  game.socket?.on?.(SOCKET_NAMESPACE, (raw) => {
    try {
      void handleIncomingPrompt(raw);
      handleIncomingResponse(raw);
    } catch (error) {
      logger.error(
        "Shield Block socket handler failed open",
        {
          stage: "shield-block-gate",
          reason: error instanceof Error ? error.message : String(error),
        },
        error,
      );
    }
  });
}

/** Test helper */
export function clearShieldBlockGatePending() {
  for (const [requestId, pending] of pendingByRequestId) {
    if (pending.timer != null && typeof pending.clear === "function") {
      pending.clear(pending.timer);
    }
    pending.resolve({ block: false, reason: "cleared" });
    pendingByRequestId.delete(requestId);
  }
  initialized = false;
}
