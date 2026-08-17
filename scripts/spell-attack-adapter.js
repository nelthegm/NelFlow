/**
 * Normalize PF2e spell-attack and spell-attack DamageRoll ChatMessages.
 * Target capture is attack-time only (context.target + stamped count).
 */

import { MODULE_ID, TRANSACTION_STATES } from "./constants.js";
import {
  SPELL_ATTACK_CAPTURE_SCHEMA_VERSION,
  SPELL_ATTACK_TRANSACTION_TYPE,
} from "./spell-attack-model.js";
import { TransactionStore } from "./transaction-store.js";

const TARGET_COUNT_OPTION = "nelflow:spell-attack:target-count:";

function pf2eFlags(message) {
  return message?.flags?.pf2e ?? {};
}

function authorId(message) {
  return message?.author?.id ?? message?.user?.id ?? message?._source?.user ?? null;
}

function ownsSource(actor, user) {
  if (!actor || !user) return false;
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return actor.testUserPermission?.(user, owner) === true;
}

function authorRole(user) {
  if (!user) return null;
  const roles = globalThis.CONST?.USER_ROLES ?? {};
  if (user.role === roles.GAMEMASTER) return "gamemaster";
  if (user.role === roles.ASSISTANT) return "assistant-gm";
  if (user.role === roles.TRUSTED) return "trusted-player";
  if (user.role === roles.PLAYER) return "player";
  return user.isGM ? "gm" : "player";
}

function tokenDocument(uuid) {
  if (!uuid || typeof fromUuidSync !== "function") return null;
  const document = fromUuidSync(uuid, { strict: false });
  return document?.actor ? document : null;
}

function targetCountFromOptions(context) {
  const marker = (context?.options ?? []).find((option) => option.startsWith(TARGET_COUNT_OPTION));
  const count = Number(marker?.slice(TARGET_COUNT_OPTION.length));
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function isSpellItem(item) {
  if (!item) return false;
  if (item.type === "spell") return true;
  if (typeof item.isOfType === "function" && item.isOfType("spell")) return true;
  return false;
}

export function isSpellAttackCandidate(message) {
  const context = pf2eFlags(message).context;
  if (context?.type !== "attack-roll") return false;
  const roll = message?.rolls?.find((candidate) => candidate?.options?.type === "attack-roll");
  if (!roll) return false;
  if (roll.options?.action === "strike") return false;
  const item = message.item ?? null;
  if (!isSpellItem(item)) return false;
  const action = roll.options?.action ?? null;
  const isSpellAttack =
    action === "cast-a-spell" ||
    item.isAttack === true ||
    (context.options ?? []).includes("action:cast-a-spell") ||
    (context.options ?? []).some((o) => String(o).includes("spell-attack"));
  return isSpellAttack === true;
}

export function normalizeSpellAttack(message) {
  if (!isSpellAttackCandidate(message)) return null;
  const flags = pf2eFlags(message);
  const context = flags.context;
  const roll = message.rolls.find((candidate) => candidate?.options?.type === "attack-roll");
  const actor = message.actor ?? message.speakerActor ?? null;
  const item = message.item ?? null;
  const authorUserId = authorId(message);
  const author = game.users?.get(authorUserId) ?? null;
  const observation = TransactionStore.get(message);
  const capture =
    observation?.transactionType === SPELL_ATTACK_TRANSACTION_TYPE && observation.role === "observation"
      ? observation
      : null;
  const targetToken = tokenDocument(context?.target?.token);
  const optionTargetCount = targetCountFromOptions(context);
  const capturedTargetCount = Number.isInteger(capture?.targetCount) ? capture.targetCount : null;
  const targetCount =
    capturedTargetCount != null && optionTargetCount != null && capturedTargetCount !== optionTargetCount
      ? null
      : capturedTargetCount ?? optionTargetCount ?? (context?.target?.token ? 1 : 0);

  return {
    message,
    actor,
    item,
    evidence: {
      contextType: "attack-roll",
      isStrike: false,
      isSpell: true,
      isSpellAttack: true,
      authorIsGm: author?.isGM === true,
      authorRole: authorRole(author),
      authorActive: author?.active === true,
      authorOwnsSource: ownsSource(actor, author),
      sourceActorUuid: actor?.uuid ?? null,
      sourceTokenUuid: context?.origin?.token ?? message.token?.uuid ?? null,
      sourceItemUuid: item?.uuid ?? flags.origin?.uuid ?? null,
      actionName: item?.name ?? null,
      attackMessageId: message.id,
      attackRollId: roll?.id ?? roll?._id ?? null,
      targetActorUuid: context?.target?.actor ?? null,
      targetTokenUuid: context?.target?.token ?? null,
      sceneId: targetToken?.parent?.id ?? null,
      targetCount,
      outcome: context?.outcome ?? null,
      authorUserId,
    },
  };
}

export function normalizeSpellAttackDamage(message) {
  if (!message?.isDamageRoll) return null;
  const flags = pf2eFlags(message);
  const context = flags.context;
  const roll = message.rolls?.find((candidate) => Array.isArray(candidate?.instances));
  if (context?.type !== "damage-roll" || !roll) return null;
  if (flags.strike) return null;
  const originItemUuid = flags.origin?.uuid ?? message.item?.uuid ?? null;
  const originItem = message.item ?? null;
  if (originItem && !isSpellItem(originItem)) return null;
  if (context.sourceType !== "attack") return null;

  return {
    message,
    roll,
    evidence: {
      damageMessageId: message.id ?? message._source?._id ?? null,
      isNativeDamageRoll: true,
      contextType: context.type,
      sourceType: context.sourceType ?? null,
      isStrikeDamage: false,
      sourceActorUuid: flags.origin?.actor ?? message.actor?.uuid ?? null,
      sourceTokenUuid: context.origin?.token ?? message.token?.uuid ?? null,
      sourceItemUuid: originItemUuid,
      targetActorUuid: context.target?.actor ?? null,
      targetTokenUuid: context.target?.token ?? null,
      authorUserId: authorId(message),
      outcome: context.outcome ?? null,
      isHealing: Number(roll.total) < 0 || roll.kinds?.has?.("healing") === true,
      rolledTotal: Number.isFinite(roll.total) ? Number(roll.total) : null,
      formula: typeof roll.formula === "string" ? roll.formula : null,
    },
  };
}

export function captureSpellAttackObservation(document, userId) {
  if (userId !== game.user?.id) return;
  if (!isSpellAttackCandidate(document)) return;
  const context = pf2eFlags(document).context;
  let targetCount = targetCountFromOptions(context);
  if (targetCount == null) targetCount = Number(game.user?.targets?.size ?? 0);
  const options = [...(context.options ?? [])].filter((option) => !option.startsWith(TARGET_COUNT_OPTION));
  options.push(`${TARGET_COUNT_OPTION}${targetCount}`);
  document.updateSource({
    "flags.pf2e.context.options": options,
    [`flags.${MODULE_ID}.transaction`]: {
      schemaVersion: SPELL_ATTACK_CAPTURE_SCHEMA_VERSION,
      transactionType: SPELL_ATTACK_TRANSACTION_TYPE,
      role: "observation",
      state: TRANSACTION_STATES.DETECTED,
      attackMessageId: document.id,
      targetCount,
    },
  });
}