import { MODULE_ID, TRANSACTION_STATES } from "./constants.js";
import {
  CHARACTER_STRIKE_CORRELATION_SCHEMA_VERSION,
  CHARACTER_STRIKE_INTENT_MAX_AGE_MS,
  PLAYER_STRIKE_TRANSACTION_TYPE,
  validateCharacterStrikeCorrelation,
  validatePlayerStrikeAttack,
  validatePlayerStrikeSnapshot,
} from "./player-strike-model.js";
import {
  normalizePlayerStrikeAttack,
  normalizePlayerStrikeDamage,
} from "./player-strike-adapter.js";
import { TransactionStore } from "./transaction-store.js";

const intents = new Map();
const boundRoots = new WeakSet();

function randomNonce() {
  const foundryId = globalThis.foundry?.utils?.randomID?.(24);
  if (foundryId) return foundryId;
  return globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 24) ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
}

function requestedVariant(button) {
  if (button?.dataset?.action !== "strike-damage") return null;
  if (button.dataset.outcome === "success") return "damage";
  if (button.dataset.outcome === "critical-success") return "critical";
  return null;
}

function userOwnsActor(actor, user) {
  if (!actor || !user?.active) return false;
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return actor.testUserPermission?.(user, owner) === true;
}

function publicIntent(intent) {
  if (!intent) return null;
  const { expirationTimer: _expirationTimer, ...metadata } = intent;
  return metadata;
}

function removeIntent(transactionId, expectedNonce = null) {
  const intent = intents.get(transactionId);
  if (!intent || (expectedNonce && intent.intentNonce !== expectedNonce)) return false;
  if (intent.expirationTimer) globalThis.clearTimeout?.(intent.expirationTimer);
  intents.delete(transactionId);
  return true;
}

export function buildCharacterStrikeIntent({
  transaction,
  attackEvidence,
  requestedVariant: variant,
  clickingUserId,
  createdAt = Date.now(),
  intentNonce = randomNonce(),
  combat = null,
} = {}) {
  if (
    transaction?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE ||
    transaction.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE ||
    !["damage", "critical"].includes(variant) ||
    !clickingUserId
  ) return null;
  return {
    version: CHARACTER_STRIKE_CORRELATION_SCHEMA_VERSION,
    transactionId: transaction.id,
    sourceMessageId: transaction.attackMessageId,
    intentNonce,
    requestedVariant: variant,
    authorUserId: clickingUserId,
    createdAt,
    sourceActorUuid: attackEvidence.sourceActorUuid,
    sourceTokenUuid: attackEvidence.sourceTokenUuid ?? null,
    sourceItemUuid: attackEvidence.sourceItemUuid,
    strikeIdentifier: attackEvidence.strikeIdentifier,
    actionIndex: attackEvidence.actionIndex,
    altUsage: attackEvidence.altUsage ?? null,
    attackOutcome: attackEvidence.outcome,
    sceneId: attackEvidence.sceneId ?? null,
    combatId: combat?.id ?? null,
    combatRound: Number.isInteger(combat?.round) ? combat.round : null,
    combatTurn: Number.isInteger(combat?.turn) ? combat.turn : null,
  };
}

/** Capture a causal hint during the capture phase; PF2e's own target listener still executes normally. */
export function recordCharacterStrikeIntent(message, button, {
  now = Date.now(),
  nonce = randomNonce(),
} = {}) {
  const variant = requestedVariant(button);
  if (!variant) return null;
  const resolved = TransactionStore.resolveCanonical(message);
  const transaction = resolved?.transaction;
  if (
    resolved?.attackMessage?.id !== message.id ||
    transaction?.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE
  ) return null;
  const normalized = normalizePlayerStrikeAttack(message);
  const clicker = game.users?.get(game.user?.id) ?? game.user;
  if (
    !normalized ||
    !validatePlayerStrikeAttack(normalized.evidence).ok ||
    !validatePlayerStrikeSnapshot(transaction.snapshot, normalized.evidence).ok ||
    !userOwnsActor(normalized.actor, clicker)
  ) return null;

  const intent = buildCharacterStrikeIntent({
    transaction,
    attackEvidence: normalized.evidence,
    requestedVariant: variant,
    clickingUserId: game.user.id,
    createdAt: now,
    intentNonce: nonce,
    combat: game.combat ?? null,
  });
  if (!intent) return null;
  // A single browser can causally initiate only one next outgoing Strike
  // damage message. Superseding its older unconsumed hint avoids theoretical
  // matches from cancelled dialogs while leaving other users' intents isolated.
  for (const pending of [...intents.values()]) {
    if (pending.authorUserId === intent.authorUserId) {
      removeIntent(pending.transactionId, pending.intentNonce);
    }
  }
  removeIntent(transaction.id);
  const expirationTimer = globalThis.setTimeout?.(() => {
    removeIntent(transaction.id, intent.intentNonce);
  }, CHARACTER_STRIKE_INTENT_MAX_AGE_MS);
  expirationTimer?.unref?.();
  intents.set(transaction.id, { ...intent, expirationTimer });
  return publicIntent(intents.get(transaction.id));
}

export function bindCharacterStrikeIntentCapture(message, html) {
  if (!html || boundRoots.has(html)) return false;
  const resolved = TransactionStore.resolveCanonical(message);
  if (resolved?.attackMessage?.id !== message.id) return false;
  boundRoots.add(html);
  html.addEventListener("click", (event) => {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const button = target?.closest?.('button[data-action="strike-damage"]');
    if (!button || !html.contains(button)) return;
    recordCharacterStrikeIntent(message, button);
  }, { capture: true });
  return true;
}

/** Stamp the outgoing native damage document synchronously during preCreateChatMessage. */
export function captureCharacterStrikeDamageCorrelation(document, userId, { now = Date.now() } = {}) {
  if (userId !== game.user?.id) return null;
  const normalized = normalizePlayerStrikeDamage(document);
  if (!normalized || normalized.evidence.authorUserId !== game.user.id) return null;

  const matches = [];
  for (const intent of intents.values()) {
    const attackMessage = game.messages?.get(intent.sourceMessageId);
    const transaction = TransactionStore.get(attackMessage);
    if (
      !attackMessage ||
      transaction?.id !== intent.transactionId ||
      transaction.state !== TRANSACTION_STATES.WAITING_FOR_DAMAGE
    ) {
      removeIntent(intent.transactionId, intent.intentNonce);
      continue;
    }
    const validation = validateCharacterStrikeCorrelation(
      transaction,
      normalized.evidence,
      publicIntent(intent),
      { now },
    );
    if (validation.ok) matches.push({ intent, validation });
    else if (validation.reason === "player-strike-direct-intent-expired") {
      removeIntent(intent.transactionId, intent.intentNonce);
    }
  }
  // More than one matching live click is a real conflict: leave the native
  // message untouched so the elected GM can use structured fallback safely.
  if (matches.length !== 1) return null;
  const metadata = publicIntent(matches[0].intent);
  document.updateSource({ [`flags.${MODULE_ID}.characterStrikeCorrelation`]: metadata });
  removeIntent(metadata.transactionId, metadata.intentNonce);
  return metadata;
}

export function characterStrikeIntentDiagnostic(transactionId, { now = Date.now() } = {}) {
  const intent = intents.get(transactionId);
  if (!intent) return null;
  const ageMs = Math.max(0, now - intent.createdAt);
  if (ageMs > CHARACTER_STRIKE_INTENT_MAX_AGE_MS) {
    removeIntent(transactionId, intent.intentNonce);
    return null;
  }
  return { ...publicIntent(intent), ageMs, expirationState: "fresh" };
}

export function clearCharacterStrikeIntents() {
  for (const transactionId of [...intents.keys()]) removeIntent(transactionId);
}
