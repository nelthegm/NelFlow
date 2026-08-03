import {
  MODULE_ID,
  PLAYER_STRIKE_AUTO_APPLY_MODES,
  SETTINGS,
  TRANSACTION_STATES,
} from "./constants.js";
import {
  PLAYER_STRIKE_CAPTURE_SCHEMA_VERSION,
  PLAYER_STRIKE_TRANSACTION_TYPE,
} from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";

const TARGET_COUNT_OPTION = "nelflow:player-strike:target-count:";

function pf2eFlags(message) {
  return message?.flags?.pf2e ?? {};
}

function safeCorrelationString(value, max = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function normalizeCharacterStrikeCorrelation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value == null ? null : {};
  return {
    version: Number.isInteger(value.version) ? value.version : null,
    transactionId: safeCorrelationString(value.transactionId, 128),
    sourceMessageId: safeCorrelationString(value.sourceMessageId, 64),
    intentNonce: safeCorrelationString(value.intentNonce, 64),
    requestedVariant: ["damage", "critical"].includes(value.requestedVariant) ? value.requestedVariant : null,
    authorUserId: safeCorrelationString(value.authorUserId, 64),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : null,
    sourceActorUuid: safeCorrelationString(value.sourceActorUuid),
    sourceTokenUuid: value.sourceTokenUuid == null ? null : safeCorrelationString(value.sourceTokenUuid),
    sourceItemUuid: safeCorrelationString(value.sourceItemUuid),
    strikeIdentifier: safeCorrelationString(value.strikeIdentifier),
    actionIndex: Number.isInteger(value.actionIndex) ? value.actionIndex : null,
    altUsage: value.altUsage == null ? null : safeCorrelationString(value.altUsage, 64),
    attackOutcome: safeCorrelationString(value.attackOutcome, 32),
    sceneId: value.sceneId == null ? null : safeCorrelationString(value.sceneId, 64),
    combatId: value.combatId == null ? null : safeCorrelationString(value.combatId, 64),
    combatRound: Number.isInteger(value.combatRound) ? value.combatRound : null,
    combatTurn: Number.isInteger(value.combatTurn) ? value.combatTurn : null,
    localIntentState: ["pending", "bound", "finalized"].includes(value.localIntentState)
      ? value.localIntentState
      : null,
    boundDamageMessageId: safeCorrelationString(value.boundDamageMessageId, 64),
    boundAt: Number.isFinite(value.boundAt) ? value.boundAt : null,
  };
}

export function playerStrikeAuthorId(message) {
  return message?.author?.id ?? message?.user?.id ?? message?._source?.user ?? null;
}

function actionIndex(actor, item) {
  const actions = actor?.system?.actions;
  if (!Array.isArray(actions) || !item?.id) return null;
  const index = actions.findIndex((action) =>
    action?.item?.id === item.id && action?.item?.slug === item.slug,
  );
  return index >= 0 ? index : null;
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

export function isPlayerStrikeCandidate(message) {
  const context = pf2eFlags(message).context;
  const roll = message?.rolls?.find((candidate) => candidate?.options?.type === "attack-roll");
  return context?.type === "attack-roll" && roll?.options?.action === "strike";
}

export function normalizePlayerStrikeAttack(message) {
  if (!isPlayerStrikeCandidate(message)) return null;
  const flags = pf2eFlags(message);
  const context = flags.context;
  const roll = message.rolls.find((candidate) => candidate?.options?.type === "attack-roll");
  const actor = message.actor ?? message.speakerActor ?? null;
  const identifier = roll?.options?.identifier ?? context?.identifier ?? null;
  // PF2e's getter has a rendered-card fallback when no identifier exists. Never
  // enter that branch: missing structured identity is a manual transaction.
  const attack = identifier ? message._attack ?? null : null;
  const item = attack?.item ?? message.item ?? null;
  const authorUserId = playerStrikeAuthorId(message);
  const author = game.users?.get(authorUserId) ?? null;
  const observation = TransactionStore.get(message);
  const capture = observation?.transactionType === PLAYER_STRIKE_TRANSACTION_TYPE && observation.role === "observation"
    ? observation
    : null;
  const targetToken = tokenDocument(context?.target?.token);
  const sourceToken = tokenDocument(context?.origin?.token);
  const index = actionIndex(actor, item);
  const optionTargetCount = targetCountFromOptions(context);
  const capturedTargetCount = Number.isInteger(capture?.targetCount) ? capture.targetCount : null;
  const targetCount = capturedTargetCount != null && optionTargetCount != null && capturedTargetCount !== optionTargetCount
    ? null
    : capturedTargetCount ?? optionTargetCount;
  return {
    message,
    actor,
    attack,
    item,
    evidence: {
      actorType: actor?.type ?? null,
      actionType: attack?.type ?? null,
      itemType: item?.type ?? null,
      damaging: roll?.options?.damaging === true,
      authorIsGm: author?.isGM === true,
      authorRole: authorRole(author),
      authorActive: author?.active === true,
      authorOwnsSource: ownsSource(actor, author),
      sourceActorUuid: actor?.uuid ?? null,
      sourceTokenUuid: context?.origin?.token ?? message.token?.uuid ?? null,
      sourceItemUuid: item?.uuid ?? null,
      strikeIdentifier: identifier,
      actionIndex: index,
      altUsage: item?.altUsageType ?? null,
      attackMessageId: message.id,
      attackRollId: roll?.id ?? roll?._id ?? null,
      targetActorUuid: context?.target?.actor ?? null,
      targetTokenUuid: context?.target?.token ?? null,
      sceneId: targetToken?.parent?.id ?? null,
      targetCount,
      targetDisposition: targetToken?.disposition ?? null,
      sourceDisposition: sourceToken?.disposition ?? null,
      outcome: context?.outcome ?? null,
      mapIncreases: Number.isInteger(context?.mapIncreases) ? context.mapIncreases : 0,
      authorUserId,
    },
  };
}

export function normalizePlayerStrikeDamage(message) {
  if (!message?.isDamageRoll) return null;
  const flags = pf2eFlags(message);
  const context = flags.context;
  const strike = flags.strike;
  const roll = message.rolls?.find((candidate) => Array.isArray(candidate?.instances));
  if (context?.type !== "damage-roll" || !strike || !roll) return null;
  return {
    message,
    roll,
    correlation: normalizeCharacterStrikeCorrelation(
      message.flags?.[MODULE_ID]?.characterStrikeCorrelation ?? null,
    ),
    evidence: {
      damageMessageId: message.id ?? message._source?._id ?? null,
      isNativeDamageRoll: true,
      contextType: context.type,
      sourceActorUuid: flags.origin?.actor ?? message.actor?.uuid ?? null,
      sourceTokenUuid: context.origin?.token ?? message.token?.uuid ?? null,
      sourceItemUuid: flags.origin?.uuid ?? message.item?.uuid ?? null,
      targetActorUuid: context.target?.actor ?? null,
      targetTokenUuid: context.target?.token ?? null,
      authorUserId: playerStrikeAuthorId(message),
      actionIndex: Number.isInteger(strike.index) ? strike.index : null,
      altUsage: strike.altUsage ?? null,
      mapIncreases: Number.isInteger(context.mapIncreases) ? context.mapIncreases : 0,
      outcome: context.outcome ?? null,
      isHealing: Number(roll.total) < 0 || roll.kinds?.has?.("healing") === true,
      hasPersistentDamage: roll.options?.evaluatePersistent === true ||
        roll.instances.some((instance) => instance?.persistent === true || instance?.category === "persistent"),
    },
  };
}

export function capturePlayerStrikeObservation(document, userId) {
  if (userId !== game.user?.id) return;
  if (getSetting(SETTINGS.PLAYER_STRIKE_AUTO_APPLY) === PLAYER_STRIKE_AUTO_APPLY_MODES.OFF) return;
  if (!isPlayerStrikeCandidate(document) || document.actor?.type !== "character") return;
  const context = pf2eFlags(document).context;
  let targetCount = targetCountFromOptions(context);
  if (targetCount == null) targetCount = Number(game.user?.targets?.size ?? 0);
  const options = [...(context.options ?? [])].filter((option) => !option.startsWith(TARGET_COUNT_OPTION));
  options.push(`${TARGET_COUNT_OPTION}${targetCount}`);
  document.updateSource({
    "flags.pf2e.context.options": options,
    [`flags.${MODULE_ID}.transaction`]: {
      schemaVersion: PLAYER_STRIKE_CAPTURE_SCHEMA_VERSION,
      transactionType: PLAYER_STRIKE_TRANSACTION_TYPE,
      role: "observation",
      state: TRANSACTION_STATES.DETECTED,
      attackMessageId: document.id,
      targetCount,
    },
  });
}
