import {
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_SCHEMA_VERSION,
} from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";

const updateQueues = new Map();

function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function markerMatches(marker, combat, combatant) {
  return (
    marker?.combatId === combat.id &&
    marker.round === combat.round &&
    marker.combatantId === combatant.id
  );
}

function makeTurnMarker(combat, combatant) {
  const modifiedTime = combat._stats?.modifiedTime ?? Date.now();
  return {
    combatId: combat.id,
    round: combat.round,
    combatantId: combatant.id,
    turnIndex: combat.turn,
    markerId: stableHash(
      `${combat.id}|${combat.round}|${combatant.id}|${combat.turn}|${modifiedTime}`,
    ),
  };
}

function sourceVisibility(message) {
  const whisper = Array.from(message._source?.whisper ?? message.whisper ?? []).sort();
  const blind = Boolean(message._source?.blind ?? message.blind);
  return {
    blind,
    whisper,
    key: `${blind ? "blind" : "visible"}:${whisper.join(",") || "public"}`,
  };
}

function currentCombatFor(transaction) {
  const combat = game.combat;
  const combatant = combat?.combatant;
  const snapshot = transaction.snapshot;
  if (
    !combat?.started ||
    !combatant ||
    combat.round == null ||
    combat.turn == null ||
    (combatant.actor?.uuid !== snapshot.sourceActorUuid &&
      combatant.token?.uuid !== snapshot.sourceTokenUuid)
  ) {
    return null;
  }
  return { combat, combatant };
}

async function ensureTurnMarker(combat, combatant) {
  const existing = combat.getFlag(MODULE_ID, "turnMarker");
  if (markerMatches(existing, combat, combatant)) return existing;

  const marker = makeTurnMarker(combat, combatant);
  try {
    await combat.setFlag(MODULE_ID, "turnMarker", marker);
    return combat.getFlag(MODULE_ID, "turnMarker") ?? marker;
  } catch (error) {
    logger.warn("Unable to persist combat turn marker; using a deterministic fallback", {
      combatId: combat.id,
      combatantId: combatant.id,
      round: combat.round,
      stage: "turn-marker",
      reason: error instanceof Error ? error.message : String(error),
    });
    return marker;
  }
}

async function stackIdentity(attackMessage, transaction) {
  const visibility = sourceVisibility(attackMessage);
  const active = currentCombatFor(transaction);
  if (!active) {
    const key = [
      "standalone",
      transaction.id,
      transaction.snapshot.processingUserId,
      visibility.key,
    ].join("|");
    return {
      id: stableHash(key),
      key,
      kind: "standalone",
      visibility,
      identity: {
        combatId: null,
        round: null,
        combatantId: null,
        turnIndex: null,
        turnMarkerId: transaction.id,
        authorUserId: transaction.snapshot.processingUserId,
        visibilityKey: visibility.key,
      },
    };
  }

  const marker = await ensureTurnMarker(active.combat, active.combatant);
  const identity = {
    combatId: active.combat.id,
    round: marker.round,
    combatantId: marker.combatantId,
    turnIndex: marker.turnIndex,
    turnMarkerId: marker.markerId,
    authorUserId: transaction.snapshot.processingUserId,
    visibilityKey: visibility.key,
  };
  const key = [
    "combat-turn",
    identity.combatId,
    identity.round,
    identity.combatantId,
    identity.turnIndex,
    identity.turnMarkerId,
    identity.authorUserId,
    identity.visibilityKey,
  ].join("|");
  return { id: stableHash(key), key, kind: "combat-turn", visibility, identity };
}

function makeRow(transaction) {
  const snapshot = transaction.snapshot;
  return {
    id: transaction.id,
    transactionId: transaction.id,
    attackMessageId: transaction.attackMessageId,
    attackCreatedAt: snapshot.attackCreatedAt ?? snapshot.timestamp,
    sequence: 0,
    strikeName: snapshot.strikeName ?? game.i18n.localize("Nelflow.Stack.UnknownStrike"),
    strikeIcon: snapshot.strikeIcon ?? "icons/svg/sword.svg",
    mapIncreases: snapshot.mapIncreases ?? 0,
    mapPenalty: snapshot.mapPenalty ?? null,
    targetName: transaction.targetName ?? snapshot.targetName ?? snapshot.targetActorUuid,
    targetActorUuid: snapshot.targetActorUuid,
    targetTokenUuid: snapshot.targetTokenUuid,
    outcome: snapshot.outcome,
    supplementalActions: snapshot.supplementalActions ?? null,
    damageSummary: transaction.damageSummary ?? null,
    appliedAmount: transaction.appliedAmount,
    transactionState: transaction.state,
    autoApplyRequested: transaction.autoApplyRequested ?? false,
    undoBlocked: transaction.undoBlocked ?? false,
    presentationError: transaction.presentationError ?? null,
    damageMessageId: transaction.damageMessageId,
    applicationMessageId: transaction.applicationMessageId,
    updatedAt: transaction.updatedAt,
  };
}

function sortRows(rows) {
  return rows
    .sort(
      (left, right) =>
        (left.attackCreatedAt ?? 0) - (right.attackCreatedAt ?? 0) ||
        left.attackMessageId.localeCompare(right.attackMessageId),
    )
    .map((row, index) => ({ ...row, sequence: index + 1 }));
}

function actorProjection(transaction) {
  const snapshot = transaction.snapshot;
  return {
    actorUuid: snapshot.sourceActorUuid,
    tokenUuid: snapshot.sourceTokenUuid,
    name: snapshot.sourceName ?? game.i18n.localize("Nelflow.Stack.UnknownCombatant"),
    img: snapshot.sourceIcon ?? "icons/svg/mystery-man.svg",
  };
}

async function createStackMessage(attackMessage, transaction, descriptor) {
  const ChatMessageClass = CONFIG.ChatMessage.documentClass;
  const data = {
    _id: descriptor.id,
    user: game.user.id,
    speaker: foundry.utils.deepClone(attackMessage._source?.speaker ?? {}),
    content: game.i18n.localize("Nelflow.Stack.StoredContent"),
    whisper: descriptor.visibility.whisper,
    blind: descriptor.visibility.blind,
    flags: {
      [MODULE_ID]: {
        stack: {
          schemaVersion: STACK_SCHEMA_VERSION,
          id: descriptor.id,
          key: descriptor.key,
          kind: descriptor.kind,
          identity: descriptor.identity,
          actor: actorProjection(transaction),
          rows: [makeRow(transaction)],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    },
  };

  try {
    return await ChatMessageClass.create(data, { keepId: true });
  } catch (error) {
    const existing = game.messages.get(descriptor.id);
    if (existing?.getFlag(MODULE_ID, "stack")?.key === descriptor.key) return existing;
    throw error;
  }
}

function enqueue(key, operation) {
  const previous = updateQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  updateQueues.set(key, current);
  void current.then(
    () => {
      if (updateQueues.get(key) === current) updateQueues.delete(key);
    },
    () => {
      if (updateQueues.get(key) === current) updateQueues.delete(key);
    },
  );
  return current;
}

export class TurnStackService {
  static initialize() {
    Hooks.on("combatTurnChange", (combat, prior, current) => {
      if (!game.user.isActiveGM) return;

      const existing = combat.getFlag(MODULE_ID, "turnMarker");
      const sameTurn =
        prior?.round === current?.round &&
        prior?.combatantId === current?.combatantId &&
        existing?.combatantId === current?.combatantId &&
        existing?.round === current?.round;
      if (sameTurn) return;

      const combatant = combat.combatant;
      if (!combatant || combat.round == null || combat.turn == null) return;
      void combat.setFlag(MODULE_ID, "turnMarker", makeTurnMarker(combat, combatant)).catch((error) => {
        logger.error(
          "Unable to persist combat turn change",
          {
            combatId: combat.id,
            combatantId: combatant.id,
            round: combat.round,
            stage: "combatTurnChange",
            reason: error instanceof Error ? error.message : String(error),
          },
          error,
        );
      });
    });
  }

  static enabled() {
    return getSetting(SETTINGS.COMPACT_TURN_STACKS) === COMPACT_STACK_MODES.NPC_STRIKES;
  }

  /**
   * Project one canonical transaction into one deterministic row. Only the GM
   * who claimed the transaction may create or mutate its stack projection.
   */
  static async syncTransaction(attackMessage, transaction) {
    if (
      !this.enabled() ||
      !game.user.isGM ||
      attackMessage.author?.id !== game.user.id ||
      transaction.snapshot?.processingUserId !== game.user.id
    ) {
      return null;
    }

    const canonical = TransactionStore.get(attackMessage);
    if (canonical?.id === transaction.id) transaction = canonical;

    let descriptor = transaction.stackRef;
    if (!descriptor) {
      descriptor = await stackIdentity(attackMessage, transaction);
      transaction = await TransactionStore.update(attackMessage, {
        stackRef: foundry.utils.deepClone(descriptor),
      });
    }
    return enqueue(descriptor.key, async () => {
      let stackMessage = game.messages.get(descriptor.id);
      if (stackMessage) {
        const stored = stackMessage.getFlag(MODULE_ID, "stack");
        if (stored?.key !== descriptor.key) {
          throw new Error(`Stack message ID collision for ${descriptor.id}`);
        }
      } else {
        stackMessage = await createStackMessage(attackMessage, transaction, descriptor);
      }

      const stack = stackMessage.getFlag(MODULE_ID, "stack");
      const rows = [...(stack.rows ?? [])];
      const row = makeRow(transaction);
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);

      const next = {
        ...stack,
        schemaVersion: STACK_SCHEMA_VERSION,
        actor: stack.actor ?? actorProjection(transaction),
        rows: sortRows(rows),
        updatedAt: Date.now(),
      };
      await stackMessage.update({ [`flags.${MODULE_ID}.stack`]: next });
      return stackMessage;
    });
  }
}
