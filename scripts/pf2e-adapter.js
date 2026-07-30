import { DEGREE_OF_SUCCESS, MODULE_ID } from "./constants.js";
import { logger } from "./logger.js";

const pendingCaptures = new Map();
let hooksRegistered = false;

function captureKey(transactionId, role) {
  return `${transactionId}:${role}`;
}

function transactionMarker(capture) {
  return {
    id: capture.transactionId,
    attackMessageId: capture.attackMessageId,
    role: capture.role,
  };
}

function messageFlags(message) {
  return message?.flags?.pf2e ?? {};
}

function captureMatches(capture, document) {
  const flags = messageFlags(document);
  const context = flags.context;
  const expectedType = capture.role === "damage" ? "damage-roll" : "damage-taken";
  if (context?.type !== expectedType) return false;
  if (flags.origin?.uuid !== capture.itemUuid) return false;

  if (capture.role === "damage") {
    return (
      context.target?.token === capture.targetTokenUuid &&
      flags.origin?.actor === capture.sourceActorUuid
    );
  }

  const speakerToken = document.speaker?.token ?? document._source?.speaker?.token;
  return (
    speakerToken === capture.targetTokenId &&
    flags.origin?.actor === capture.sourceActorUuid &&
    flags.appliedDamage?.uuid === capture.targetActorUuid &&
    flags.appliedDamage?.isHealing === false
  );
}

function onPreCreateChatMessage(document, _data, _options, userId) {
  if (userId !== game.user.id) return;

  const matches = Array.from(pendingCaptures.values()).filter(
    (capture) =>
      capture.role === "damage" && !capture.message && captureMatches(capture, document),
  );
  if (!matches.length) return;

  // Damage-message capture is part of Slice 1 mechanics and retains its
  // established pre-create marker behavior.
  const capture = matches[0];
  document.updateSource({
    flags: {
      [MODULE_ID]: {
        transaction: transactionMarker(capture),
      },
    },
  });
}

function onCreateChatMessage(message) {
  const marker = message.flags?.[MODULE_ID]?.transaction;
  if (marker?.id && marker.role) {
    const capture = pendingCaptures.get(captureKey(marker.id, marker.role));
    if (capture) capture.message = message;
  }

  // PF2e's application method does not return its ChatMessage. Collect every
  // structurally matching candidate during the awaited native call and accept
  // it only if the set is unique when that call finishes.
  for (const capture of pendingCaptures.values()) {
    if (
      capture.role === "application" &&
      captureMatches(capture, message) &&
      !capture.candidates.some((candidate) => candidate.id === message.id)
    ) {
      capture.candidates.push(message);
    }
  }
}

function createCapture({ transactionId, attackMessageId, role, sourceActorUuid, itemUuid, targetToken }) {
  const capture = {
    transactionId,
    attackMessageId,
    role,
    sourceActorUuid,
    itemUuid,
    targetTokenUuid: targetToken.document.uuid,
    targetTokenId: targetToken.document.id,
    targetActorUuid: targetToken.actor.uuid,
    candidates: [],
    message: null,
  };
  pendingCaptures.set(captureKey(transactionId, role), capture);
  return capture;
}

function finishCapture(capture) {
  pendingCaptures.delete(captureKey(capture.transactionId, capture.role));
  if (capture.role === "application") {
    return capture.candidates.length === 1 ? capture.candidates[0] : null;
  }
  if (capture.message) return capture.message;
  return game.messages.find(
    (candidate) =>
      candidate.flags?.[MODULE_ID]?.transaction?.id === capture.transactionId &&
      candidate.flags?.[MODULE_ID]?.transaction?.role === capture.role,
  ) ?? null;
}

function createSkipDialogEvent() {
  const showDialogs = Boolean(game.user?.settings?.showDamageDialogs);
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: showDialogs,
  };
}

function selectedTargets() {
  return Array.from(game.user?.targets ?? []);
}

function getRollOutcome(roll, context) {
  const contextOutcome = context?.outcome;
  if (!DEGREE_OF_SUCCESS.includes(contextOutcome)) return null;

  const numericOutcome = roll?.options?.degreeOfSuccess;
  if (Number.isInteger(numericOutcome) && DEGREE_OF_SUCCESS[numericOutcome] !== contextOutcome) {
    return null;
  }
  return contextOutcome;
}

function getStrikeIdentifier(roll, context) {
  const identifier = roll?.options?.identifier ?? context?.identifier;
  return typeof identifier === "string" && identifier.split(".").length >= 3 ? identifier : null;
}

function actualMapPenalty(message) {
  const modifiers = messageFlags(message).modifiers;
  if (!Array.isArray(modifiers)) return null;
  const modifier = modifiers.find(
    (candidate) =>
      candidate?.slug === "multiple-attack-penalty" &&
      candidate.enabled !== false &&
      candidate.ignored !== true,
  );
  return Number.isFinite(modifier?.modifier) ? modifier.modifier : null;
}

async function extractEphemeralTargetEffects({ origin, target, item, domains, options }) {
  if (!(origin && target)) return [];
  const factories = domains.flatMap(
    (domain) => origin.synthetics?.ephemeralEffects?.[domain]?.target ?? [],
  );
  if (!factories.length) return [];

  const fullOptions = [
    ...options,
    ...(origin.getRollOptions?.(domains) ?? []),
    ...(target.getSelfRollOptions?.("target") ?? []),
  ];
  const resolvables = item?.isOfType?.("spell")
    ? { spell: item }
    : item
      ? { weapon: item }
      : {};

  const effects = (await Promise.all(
    factories.map((factory) => factory({ test: fullOptions, resolvables })),
  )).filter(Boolean);

  for (const effect of effects) {
    if (effect.type !== "effect") continue;
    effect.system.context = {
      origin: {
        actor: origin.uuid,
        token: null,
        item: null,
        spellcasting: null,
        rollOptions: [],
      },
      target: { actor: target.uuid, token: null },
      roll: null,
    };
    effect.system.duration = {
      value: -1,
      unit: "unlimited",
      expiry: null,
      sustained: false,
    };
  }

  return effects;
}

/**
 * PF2e 8.x / Foundry 14 adapter.
 *
 * Every access to PF2e-prepared actor actions, message flags, contextual clones,
 * and native damage methods is intentionally isolated in this file.
 */
export class PF2eAdapter {
  /** Register the message-capture hooks used to correlate native roll calls with their messages. */
  static initialize() {
    if (hooksRegistered) return;
    hooksRegistered = true;
    Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
    Hooks.on("createChatMessage", onCreateChatMessage);
  }

  /** Check the target runtime before any PF2e-specific access occurs. */
  static isEnvironmentSupported() {
    return game.system?.id === "pf2e" && Number(game.release?.generation) === 14;
  }

  /** Return the currently selected targets without retaining a live Set reference. */
  static selectedTargets() {
    return selectedTargets();
  }

  /** Identify a likely NPC Strike without assuming the prepared Strike can be resolved. */
  static isNpcStrikeCandidate(message) {
    const context = messageFlags(message).context;
    const roll = message.rolls?.find((candidate) => candidate?.options?.type === "attack-roll");
    const actor = message.actor ?? message.speakerActor ?? null;
    return (
      context?.type === "attack-roll" &&
      roll?.options?.action === "strike" &&
      roll?.options?.damaging === true &&
      actor?.isOfType?.("npc") === true
    );
  }

  /**
   * Resolve and validate a completed NPC Strike from a PF2e attack message.
   * Returns null if any identity or final-outcome signal is missing or contradictory.
   */
  static inspectStrikeMessage(message) {
    const flags = messageFlags(message);
    const context = flags.context;
    const roll = message.rolls?.find((candidate) => candidate?.options?.type === "attack-roll");
    const actor = message.actor ?? message.speakerActor ?? null;
    const attack = message._attack ?? null;
    const item = attack?.item ?? null;
    const outcome = getRollOutcome(roll, context);
    const identifier = getStrikeIdentifier(roll, context);

    const valid =
      context?.type === "attack-roll" &&
      roll?.options?.action === "strike" &&
      roll?.options?.damaging === true &&
      actor?.isOfType?.("npc") === true &&
      attack?.type === "strike" &&
      item?.actor?.uuid === actor.uuid &&
      flags.origin?.uuid === item.uuid &&
      context.origin?.actor === actor.uuid &&
      Boolean(identifier);
    if (!valid) return null;

    return {
      actor,
      attack,
      context,
      identifier,
      item,
      outcome,
      roll,
      sourceTokenUuid: context.origin?.token ?? message.token?.uuid ?? null,
      targetActorUuid: context.target?.actor ?? null,
      targetTokenUuid: context.target?.token ?? null,
      mapIncreases: Number.isInteger(context.mapIncreases) ? context.mapIncreases : 0,
      mapPenalty: actualMapPenalty(message),
    };
  }

  /** Resolve the recorded target and ensure it is the one selected at attack-message creation time. */
  static resolveRecordedTarget(strike, selectedTarget) {
    const targetToken = selectedTarget?.document;
    if (
      !targetToken?.actor ||
      targetToken.uuid !== strike.targetTokenUuid ||
      targetToken.actor.uuid !== strike.targetActorUuid ||
      !targetToken.object
    ) {
      return null;
    }
    return targetToken.object;
  }

  /** Ensure the damage function required by the final outcome exists. */
  static hasNativeDamageMethod(strike) {
    const method = strike.outcome === "criticalSuccess" ? "critical" : "damage";
    return typeof strike.attack?.[method] === "function";
  }

  /**
   * Invoke the resolved Strike's native normal or critical damage function.
   * A pre-create marker correlates the awaited roll call to the exact damage message,
   * avoiding DOM clicks, timeouts, and "latest message" guesses.
   */
  static async rollStrikeDamage({ attackMessage, strike, targetToken, transactionId }) {
    const method = strike.outcome === "criticalSuccess" ? "critical" : "damage";
    const rollDamage = strike.attack?.[method];
    if (typeof rollDamage !== "function") return null;

    const capture = createCapture({
      transactionId,
      attackMessageId: attackMessage.id,
      role: "damage",
      sourceActorUuid: strike.actor.uuid,
      itemUuid: strike.item.uuid,
      targetToken,
    });

    try {
      const roll = await rollDamage({
        target: targetToken,
        checkContext: strike.context,
        mapIncreases: strike.context.mapIncreases,
        event: createSkipDialogEvent(),
      });
      const damageMessage = finishCapture(capture);
      if (!roll || !damageMessage?.isDamageRoll) return null;
      return { roll, damageMessage };
    } finally {
      pendingCaptures.delete(captureKey(transactionId, "damage"));
    }
  }

  /**
   * Summarize PF2e's structured DamageRoll instances. This never consults chat
   * card HTML or reconstructs damage from item data.
   */
  static summarizeDamageRoll(roll) {
    if (!roll || !Array.isArray(roll.instances) || !Number.isFinite(roll.total)) return null;
    const totals = new Map();
    for (const instance of roll.instances) {
      const type = typeof instance?.type === "string" ? instance.type : null;
      if (!type || !Number.isFinite(instance.total)) continue;
      const key = `${instance.persistent ? "persistent:" : ""}${type}`;
      totals.set(key, (totals.get(key) ?? 0) + instance.total);
    }
    return {
      total: roll.total,
      components: Array.from(totals, ([key, total]) => {
        const persistent = key.startsWith("persistent:");
        return {
          type: persistent ? key.slice("persistent:".length) : key,
          total,
          persistent,
        };
      }),
    };
  }

  /**
   * Apply one PF2e DamageRoll to one recorded token using the same contextual-clone
   * and Actor#applyDamage pathway as PF2e's chat-log damage controls.
   */
  static async applyDamageToRecordedTarget({
    attackMessage,
    damageMessage,
    strike,
    targetToken,
    transactionId,
  }) {
    const roll = damageMessage.rolls?.at(0);
    const targetActor = targetToken.actor;
    const originActor = damageMessage.actor;
    const item = damageMessage.item;
    const context = messageFlags(damageMessage).context;

    if (
      !damageMessage.isDamageRoll ||
      !roll?.instances ||
      !targetActor ||
      targetActor.uuid !== strike.targetActorUuid ||
      typeof targetActor.getContextualClone !== "function" ||
      typeof targetActor.applyDamage !== "function" ||
      !originActor ||
      originActor.uuid !== strike.actor.uuid ||
      !item ||
      item.uuid !== strike.item.uuid ||
      context?.type !== "damage-roll"
    ) {
      return null;
    }

    const messageRollOptions = [...(context.options ?? [])];
    const originRollOptions = messageRollOptions
      .filter((option) => option.startsWith("self:"))
      .map((option) => option.replace(/^self\b/, "origin"));
    const effectRollOptions = item.isOfType?.("affliction", "condition", "effect")
      ? item.getRollOptions("item")
      : [];

    if (targetActor.alliance && originActor.alliance) {
      const disposition = targetActor.alliance === originActor.alliance ? "ally" : "enemy";
      messageRollOptions.push(`origin:${disposition}`);
    }
    if (!messageRollOptions.some((option) => option.startsWith("target"))) {
      messageRollOptions.push(...targetActor.getSelfRollOptions("target"));
    }

    const domains = ["damage-received"];
    const ephemeralEffects = await extractEphemeralTargetEffects({
      origin: originActor,
      target: targetActor,
      item,
      domains,
      options: messageRollOptions,
    });
    const contextClone = targetActor.getContextualClone(originRollOptions, ephemeralEffects);
    if (typeof contextClone?.applyDamage !== "function") return null;

    const rollOptions = new Set([
      ...messageRollOptions.filter((option) => !/^(?:self|target)(?::|$)/.test(option)),
      ...effectRollOptions,
      ...originRollOptions,
      ...contextClone.getSelfRollOptions(),
    ]);
    const capture = createCapture({
      transactionId,
      attackMessageId: attackMessage.id,
      role: "application",
      sourceActorUuid: strike.actor.uuid,
      itemUuid: strike.item.uuid,
      targetToken,
    });

    try {
      await contextClone.applyDamage({
        damage: roll,
        token: targetToken,
        item,
        skipIWR: false,
        rollOptions,
        shieldBlockRequest: false,
        outcome: context.outcome,
      });
      return {
        applicationMessage: finishCapture(capture),
      };
    } finally {
      pendingCaptures.delete(captureKey(transactionId, "application"));
    }
  }

  /** Read the two resources Slice 1 is allowed to restore. */
  static healthSnapshot(actor) {
    const hp = actor?.system?.attributes?.hp;
    if (!Number.isFinite(hp?.value) || !Number.isFinite(hp?.temp)) return null;
    return {
      hp: hp.value,
      tempHp: hp.temp,
    };
  }

  /** Resolve a snapshotted token UUID without consulting current selection or targets. */
  static async resolveToken(tokenUuid) {
    const tokenDocument = await fromUuid(tokenUuid);
    return tokenDocument?.object ?? null;
  }

  /** Restore only HP and temporary HP after the caller has completed all guards. */
  static async restoreHealth(actor, snapshot) {
    return actor.update({
      "system.attributes.hp.value": snapshot.hp,
      "system.attributes.hp.temp": snapshot.tempHp,
    });
  }

  /** Produce debug-safe message metadata without serializing actor or item documents. */
  static diagnosticSummary(message, strike = null) {
    const flags = messageFlags(message);
    const context = flags.context;
    const roll = message.rolls?.at(0);
    return {
      messageId: message.id,
      messageStyle: message.style,
      rollType: roll?.options?.type ?? context?.type ?? null,
      originUuid: flags.origin?.uuid ?? null,
      originActorUuid: flags.origin?.actor ?? context?.origin?.actor ?? null,
      actorUuid: message.actor?.uuid ?? null,
      tokenUuid: message.token?.uuid ?? context?.origin?.token ?? null,
      itemUuid: strike?.item?.uuid ?? flags.origin?.uuid ?? null,
      strikeIdentifier: strike?.identifier ?? roll?.options?.identifier ?? null,
      outcome: strike?.outcome ?? context?.outcome ?? null,
      contextKeys: context ? Object.keys(context).sort() : [],
      nativeDamageMethodResolved: strike ? this.hasNativeDamageMethod(strike) : false,
    };
  }
}
