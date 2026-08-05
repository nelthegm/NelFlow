import { MODULE_ID, SETTINGS } from "./constants.js";
import { getSetting } from "./settings.js";
import {
  deduplicateTargetSnapshots,
  MULTI_TARGET_CAPTURE_FLAG,
  multiTargetModeAllows,
} from "./multi-target-strike-model.js";
import { logger } from "./logger.js";

let pending = null;
let initialized = false;

function isStrikeAttackControl(target) {
  return Boolean(target?.closest?.('[data-action="strike-attack"], [data-action="strike-attack2"], [data-action="strike-attack3"]'));
}

function captureCurrentTargets() {
  return deduplicateTargetSnapshots(Array.from(game.user?.targets ?? []));
}

function rememberClick(event) {
  if (!isStrikeAttackControl(event.target)) return;
  pending = { capturedAt: Date.now(), targets: captureCurrentTargets() };
}

function candidate(document) {
  const context = document?.flags?.pf2e?.context;
  const roll = document?.rolls?.find?.((entry) => entry?.options?.type === "attack-roll");
  return context?.type === "attack-roll" && roll?.options?.action === "strike";
}

export function captureMultiTargetStrike(document, userId) {
  if (userId !== game.user?.id || !candidate(document)) return false;
  const clickCapture = pending && Date.now() - pending.capturedAt <= 30_000 ? pending : null;
  pending = null;
  const actorType = document.actor?.type ?? document.speakerActor?.type ?? null;
  const originActor = document?.flags?.pf2e?.origin?.actor;
  const resolvedActorType = actorType ?? (
    originActor && typeof fromUuidSync === "function"
      ? fromUuidSync(originActor, { strict: false })?.type ?? null
      : null
  );
  if (!multiTargetModeAllows(getSetting(SETTINGS.SHARED_ROLL_MULTI_TARGET_STRIKES), resolvedActorType)) return false;
  const capturedAt = clickCapture?.capturedAt ?? Date.now();
  const targets = clickCapture?.targets ?? captureCurrentTargets();
  if (targets.length < 2) return false;
  document.updateSource({
    [`flags.${MODULE_ID}.${MULTI_TARGET_CAPTURE_FLAG}`]: {
      schemaVersion: 1,
      capturedAt,
      authorUserId: userId,
      targets,
    },
  });
  return true;
}

export class MultiTargetStrikeCapture {
  static initialize() {
    if (initialized) return;
    initialized = true;
    document.addEventListener("click", rememberClick, { capture: true });
    Hooks.on("preCreateChatMessage", (message, _data, _options, userId) => {
      try {
        captureMultiTargetStrike(message, userId);
      } catch (error) {
        logger.error("Multi-target capture failed open", {
          attackMessageId: message?.id ?? null,
          stage: "batch-target-capture",
          reason: error instanceof Error ? error.message : String(error),
        }, error);
      }
    });
  }
}
