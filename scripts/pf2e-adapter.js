import { DEGREE_OF_SUCCESS, MODULE_ID } from "./constants.js";
import {
  DAMAGE_CORRELATION_REASONS,
  DamageCaptureRegistry,
  DamageMessageClaimRegistry,
  validateDamageCandidate,
} from "./damage-correlation.js";
import { logger } from "./logger.js";
import { emitDamageAppliedFromApplication } from "./damage-applied-bridge.js";

const pendingApplicationCaptures = new Map();
const pendingSpellDamageCaptures = new Map();
const messageObservers = new Set();
let spellDamageQueue = Promise.resolve();
let hooksRegistered = false;

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 10 ? text.slice(-10) : text;
}

function persistedDamageOwner(messageId) {
  const attack = game.messages.find((message) => {
    const transaction = message.getFlag?.(MODULE_ID, "transaction");
    return transaction?.role === "attack" && transaction.damageMessageId === messageId;
  });
  if (attack) return attack.getFlag(MODULE_ID, "transaction")?.id ?? null;

  const damage = game.messages.get(messageId);
  const marker = damage?.getFlag?.(MODULE_ID, "transaction");
  return marker?.role === "damage" ? marker.id : null;
}

const damageClaims = new DamageMessageClaimRegistry({
  persistedOwner: persistedDamageOwner,
});
const damageCaptures = new DamageCaptureRegistry({
  claims: damageClaims,
  report(event, capture, details) {
    logger.debug(event, {
      transactionId: shortId(capture.transactionId),
      attackMessageId: capture.attackMessageId,
      candidateMessageId: details.candidateMessageId ?? null,
      strategy: details.strategy ?? "scoped-roll-option",
      reason: details.reason ?? null,
      sourceActorUuid: capture.sourceActorUuid,
      elapsedMs: Math.max(0, Date.now() - capture.startedAt),
    });
  },
});

function messageFlags(message) {
  return message?.flags?.pf2e ?? {};
}

function applicationCaptureMatches(capture, document) {
  const flags = messageFlags(document);
  const context = flags.context;
  if (context?.type !== "damage-taken") return false;
  if (flags.origin?.uuid !== capture.itemUuid) return false;

  const speakerToken = document.speaker?.token ?? document._source?.speaker?.token;
  return (
    speakerToken === capture.targetTokenId &&
    flags.origin?.actor === capture.sourceActorUuid &&
    flags.appliedDamage?.uuid === capture.targetActorUuid &&
    flags.appliedDamage?.isHealing === false
  );
}

function spellDamageCaptureMatches(capture, document) {
  const flags = messageFlags(document);
  const authorUserId =
    document.author?.id ?? document.user?.id ?? document._source?.user ?? document._source?.author;
  return (
    flags.context?.type === "damage-roll" &&
    flags.origin?.actor === capture.sourceActorUuid &&
    flags.origin?.uuid === capture.itemUuid &&
    authorUserId === capture.processingUserId &&
    document.isDamageRoll === true &&
    Boolean(document.rolls?.find((roll) => Array.isArray(roll?.instances)))
  );
}

function onPreCreateChatMessage(document) {
  const damageOptions = messageFlags(document).context?.options ?? [];
  const batchOption = damageOptions.find((option) => damageCaptures.getByOption(option)?.nativeMarker);
  const batchCapture = batchOption ? damageCaptures.getByOption(batchOption) : null;
  if (batchCapture?.nativeMarker) {
    document.updateSource({
      [`flags.${MODULE_ID}.multiTargetNative`]: batchCapture.nativeMarker,
    });
  }
  for (const capture of pendingSpellDamageCaptures.values()) {
    if (!spellDamageCaptureMatches(capture, document)) continue;
    document.updateSource({
      [`flags.${MODULE_ID}.saveResolverNative`]: {
        resolverId: capture.resolverId,
        sourceMessageId: capture.sourceMessageId,
        role: "damage",
        correlationId: capture.correlationId,
      },
    });
  }
  for (const capture of pendingApplicationCaptures.values()) {
    if (!capture.nativeMarker || !applicationCaptureMatches(capture, document)) continue;
    document.updateSource({
      [`flags.${MODULE_ID}.saveResolverNative`]: capture.nativeMarker,
    });
  }
}

function damageCandidate(message, correlationOption) {
  const flags = messageFlags(message);
  const context = flags.context;
  const roll = message.rolls?.find((candidate) => Array.isArray(candidate?.instances));
  return {
    document: message,
    messageId: message.id,
    isChatMessage: message instanceof CONFIG.ChatMessage.documentClass,
    isDamageRoll: message.isDamageRoll === true,
    hasNativeDamageRoll: Boolean(roll),
    authorUserId: message.author?.id ?? message.user?.id ?? message._source?.user ?? null,
    visible: Boolean(message.visible && message.isContentVisible),
    contextType: context?.type ?? null,
    correlationOption,
    sourceActorUuid: flags.origin?.actor ?? null,
    sourceTokenUuid: message.token?.uuid ?? null,
    itemUuid: flags.origin?.uuid ?? null,
    targetActorUuid: context?.target?.actor ?? null,
    targetTokenUuid: context?.target?.token ?? null,
    outcome: context?.outcome ?? null,
    degreeOfSuccess: roll?.options?.degreeOfSuccess,
    existingTransactionId: message.flags?.[MODULE_ID]?.transaction?.id ?? null,
  };
}

function onCreateChatMessage(message) {
  const options = messageFlags(message).context?.options ?? [];
  const correlationOption = options.find((option) => damageCaptures.getByOption(option));
  if (correlationOption) {
    damageCaptures.observe(damageCandidate(message, correlationOption));
  }

  // PF2e's application method does not return its ChatMessage. Collect every
  // structurally matching candidate during the awaited native call and accept
  // it only if the set is unique when that call finishes.
  for (const capture of pendingApplicationCaptures.values()) {
    if (
      applicationCaptureMatches(capture, message) &&
      !capture.candidates.some((candidate) => candidate.id === message.id)
    ) {
      capture.candidates.push(message);
    }
  }
  for (const capture of pendingSpellDamageCaptures.values()) {
    const marker = message.getFlag?.(MODULE_ID, "saveResolverNative");
    if (
      marker?.correlationId === capture.correlationId &&
      spellDamageCaptureMatches(capture, message) &&
      !capture.candidates.some((candidate) => candidate.id === message.id)
    ) {
      capture.candidates.push(message);
    }
  }
  for (const observer of messageObservers) {
    try {
      observer(message);
    } catch (error) {
      logger.error("Message observer failed", { stage: "create-dispatcher" }, error);
    }
  }
}

function createApplicationCapture({
  transactionId,
  attackMessageId,
  sourceActorUuid,
  itemUuid,
  targetToken,
  nativeMarker = null,
}) {
  const capture = {
    transactionId,
    attackMessageId,
    role: "application",
    sourceActorUuid,
    itemUuid,
    targetTokenUuid: targetToken.document.uuid,
    targetTokenId: targetToken.document.id,
    targetActorUuid: targetToken.actor.uuid,
    candidates: [],
    nativeMarker,
  };
  pendingApplicationCaptures.set(transactionId, capture);
  return capture;
}

function finishApplicationCapture(capture) {
  pendingApplicationCaptures.delete(capture.transactionId);
  return capture.candidates.length === 1 ? capture.candidates[0] : null;
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
    Hooks.on("deleteChatMessage", (message) => {
      damageClaims.forgetDeletedMessage(message.id);
    });
    for (const message of game.messages) {
      const transaction = message.getFlag?.(MODULE_ID, "transaction");
      if (transaction?.role === "attack" && transaction.damageMessageId) {
        damageClaims.restore(transaction.damageMessageId, transaction.id);
      } else if (transaction?.role === "damage") {
        damageClaims.restore(message.id, transaction.id);
      }
    }
  }

  /** Subscribe to the one adapter-owned createChatMessage dispatcher. */
  static registerMessageObserver(observer) {
    messageObservers.add(observer);
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

  /** Resolve a structured PF2e Strike for either supported creature actor type. */
  static inspectSupportedStrikeMessage(message) {
    const flags = messageFlags(message);
    const context = flags.context;
    const roll = message.rolls?.find((candidate) => candidate?.options?.type === "attack-roll");
    const actor = message.actor ?? message.speakerActor ?? null;
    const attack = message._attack ?? null;
    const item = attack?.item ?? null;
    const outcome = getRollOutcome(roll, context);
    const identifier = getStrikeIdentifier(roll, context);
    const actorSupported = actor?.isOfType?.("npc", "character") === true || ["npc", "character"].includes(actor?.type);
    const valid =
      context?.type === "attack-roll" &&
      roll?.options?.action === "strike" &&
      roll?.options?.damaging === true &&
      actorSupported &&
      attack?.type === "strike" &&
      item?.actor?.uuid === actor.uuid &&
      flags.origin?.uuid === item.uuid &&
      context.origin?.actor === actor.uuid &&
      Boolean(identifier) &&
      Boolean(outcome);
    if (!valid) return null;
    return {
      actor,
      actorType: actor.type,
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
   * A supported namespaced PF2e roll option identifies the exact created
   * damage document without DOM clicks, timeouts, or newest-message guesses.
   */
  static async rollStrikeDamage({ attackMessage, strike, targetToken, transactionId, nativeMarker = null }) {
    const method = strike.outcome === "criticalSuccess" ? "critical" : "damage";
    const rollDamage = strike.attack?.[method];
    if (typeof rollDamage !== "function") {
      return { ok: false, reason: DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED };
    }

    const capture = damageCaptures.begin({
      transactionId,
      attackMessageId: attackMessage.id,
      sourceActorUuid: strike.actor.uuid,
      sourceTokenUuid: strike.sourceTokenUuid,
      itemUuid: strike.item.uuid,
      strikeIdentifier: strike.identifier,
      targetActorUuid: targetToken.actor.uuid,
      targetTokenUuid: targetToken.document.uuid,
      expectedOutcome: strike.outcome,
      processingUserId: game.user.id,
      startState: "processing",
      nativeMarker,
    });

    try {
      const nativeResult = await rollDamage({
        target: targetToken,
        checkContext: strike.context,
        mapIncreases: strike.context.mapIncreases,
        options: new Set([capture.correlationOption]),
        event: createSkipDialogEvent(),
      });
      const DirectChatMessage = CONFIG.ChatMessage.documentClass;
      const directMessage =
        nativeResult instanceof DirectChatMessage
          ? nativeResult
          : nativeResult?.message instanceof DirectChatMessage
            ? nativeResult.message
            : nativeResult?.chatMessage instanceof DirectChatMessage
              ? nativeResult.chatMessage
              : null;
      logger.debug("native-damage-returned", {
        transactionId: shortId(transactionId),
        attackMessageId: attackMessage.id,
        strategy: directMessage ? "direct-return" : "scoped-roll-option",
        reason: nativeResult ? null : DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED,
        sourceActorUuid: strike.actor.uuid,
        elapsedMs: Math.max(0, Date.now() - capture.startedAt),
      });
      const correlation = damageCaptures.finish(transactionId, {
        directCandidate: directMessage ? damageCandidate(directMessage, null) : null,
      });
      const roll =
        directMessage?.rolls?.find((candidate) => Array.isArray(candidate?.instances)) ??
        nativeResult;
      if (!correlation.ok) {
        return {
          ...correlation,
          ok: false,
          roll,
          nativeRollReturned: Boolean(roll?.instances),
        };
      }
      if (!roll?.instances || !correlation.candidate?.document?.isDamageRoll) {
        damageClaims.release(correlation.candidateMessageId, transactionId);
        return {
          ...correlation,
          ok: false,
          reason: DAMAGE_CORRELATION_REASONS.INVALID_ROLL,
          nativeRollReturned: Boolean(roll?.instances),
        };
      }
      return {
        ...correlation,
        ok: true,
        roll,
        damageMessage: correlation.candidate.document,
      };
    } catch (error) {
      damageCaptures.fail(transactionId, DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED);
      logger.debug("native-damage-call-failed", {
        transactionId: shortId(transactionId),
        attackMessageId: attackMessage.id,
        strategy: "native-return",
        reason: error instanceof Error ? error.message : String(error),
        sourceActorUuid: strike.actor.uuid,
        elapsedMs: Math.max(0, Date.now() - capture.startedAt),
      });
      return {
        ok: false,
        reason: DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED,
        nativeRollReturned: false,
        error,
        sequence: capture.sequence,
        correlationOption: capture.correlationOption,
        elapsedMs: Math.max(0, Date.now() - capture.startedAt),
      };
    }
  }

  static persistDamageClaim(messageId, transactionId) {
    return damageClaims.markPersisted(messageId, transactionId);
  }

  static claimDamageMessage(messageId, transactionId) {
    return damageClaims.claim(messageId, transactionId);
  }

  static releaseDamageClaim(messageId, transactionId) {
    return damageClaims.release(messageId, transactionId);
  }

  static damageClaimOwner(messageId) {
    return damageClaims.owner(messageId);
  }

  /**
   * Roll one spell's native PF2e damage. SpellPF2e#rollDamage does not accept
   * arbitrary roll options, so the exact call is enclosed by one scoped
   * pre-create marker. Zero or multiple marked native messages fail safely.
   */
  static rollSpellDamage(parameters) {
    // SpellPF2e#rollDamage has no custom option parameter. Serializing only
    // Nelflow's explicit shared spell-damage invocations guarantees that one
    // scoped pre-create marker can never be shared by two local resolvers.
    const operation = spellDamageQueue
      .catch(() => undefined)
      .then(() => this._rollSpellDamage(parameters));
    spellDamageQueue = operation;
    return operation;
  }

  static async _rollSpellDamage({ sourceMessage, spell, resolverId, correlationId }) {
    if (typeof spell?.rollDamage !== "function" || pendingSpellDamageCaptures.has(resolverId)) {
      return { ok: false, reason: "native-spell-damage-unavailable" };
    }
    const capture = {
      resolverId,
      correlationId,
      sourceMessageId: sourceMessage.id,
      sourceActorUuid: spell.actor?.uuid,
      itemUuid: spell.uuid,
      processingUserId: game.user.id,
      candidates: [],
    };
    pendingSpellDamageCaptures.set(resolverId, capture);
    try {
      const roll = await spell.rollDamage(createSkipDialogEvent());
      if (!roll?.instances) return { ok: false, reason: "native-spell-damage-unavailable" };
      if (capture.candidates.length !== 1) {
        return {
          ok: false,
          reason:
            capture.candidates.length > 1
              ? "spell-damage-message-ambiguous"
              : "spell-damage-message-missing",
          roll,
          candidateCount: capture.candidates.length,
        };
      }
      return { ok: true, roll, damageMessage: capture.candidates[0], candidateCount: 1 };
    } catch (error) {
      return { ok: false, reason: "native-spell-damage-call-failed", error };
    } finally {
      pendingSpellDamageCaptures.delete(resolverId);
    }
  }

  static validateDamageForApplication({
    attackMessage,
    transaction,
    damageMessage,
    strike,
    targetToken,
  }) {
    if (
      !game.user.isGM ||
      attackMessage.author?.id !== game.user.id ||
      transaction.snapshot?.processingUserId !== game.user.id ||
      transaction.state !== "damage-rolled" ||
      transaction.id !== attackMessage.getFlag(MODULE_ID, "transaction")?.id ||
      transaction.damageMessageId !== damageMessage?.id ||
      damageClaims.owner(damageMessage?.id) !== transaction.id ||
      transaction.snapshot.targetActorUuid !== targetToken.actor?.uuid ||
      transaction.snapshot.targetTokenUuid !== targetToken.document?.uuid ||
      transaction.snapshot.sourceActorUuid !== strike.actor?.uuid ||
      transaction.snapshot.sourceItemUuid !== strike.item?.uuid ||
      transaction.snapshot.outcome !== strike.outcome
    ) {
      return { ok: false, reason: DAMAGE_CORRELATION_REASONS.TRANSACTION_INELIGIBLE };
    }

    const correlationOption = transaction.damageCorrelation?.correlationOption ?? null;
    const candidate = damageCandidate(damageMessage, correlationOption);
    const validation = validateDamageCandidate(
      {
        transactionId: transaction.id,
        correlationOption,
        processingUserId: transaction.snapshot.processingUserId,
        sourceActorUuid: transaction.snapshot.sourceActorUuid,
        sourceTokenUuid: transaction.snapshot.sourceTokenUuid,
        itemUuid: transaction.snapshot.sourceItemUuid,
        targetActorUuid: transaction.snapshot.targetActorUuid,
        targetTokenUuid: transaction.snapshot.targetTokenUuid,
        expectedOutcome: transaction.snapshot.outcome,
      },
      candidate,
      { requireCorrelationOption: Boolean(correlationOption) },
    );
    return validation.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: validation.reason };
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
    return this.applyDamageRollToRecordedTarget({
      damageMessage,
      damageRoll: damageMessage.rolls?.at(0),
      sourceActor: strike.actor,
      sourceItem: strike.item,
      targetToken,
      expectedTargetActorUuid: strike.targetActorUuid,
      multiplier: 1,
      outcome: messageFlags(damageMessage).context?.outcome,
      applicationId: transactionId,
      attackMessageId: attackMessage.id,
    });
  }

  static async applyDamageRollToRecordedTarget({
    damageMessage,
    damageRoll,
    sourceActor,
    sourceItem,
    targetToken,
    expectedTargetActorUuid,
    multiplier,
    outcome,
    applicationId,
    attackMessageId = null,
    nativeMarker = null,
  }) {
    const targetActor = targetToken?.actor;
    const originActor = damageMessage?.actor;
    const item = damageMessage?.item;
    const context = messageFlags(damageMessage).context;
    if (
      !damageMessage?.isDamageRoll ||
      !damageRoll?.instances ||
      ![0.5, 1, 2].includes(multiplier) ||
      !targetActor ||
      targetActor.uuid !== expectedTargetActorUuid ||
      typeof targetActor.getContextualClone !== "function" ||
      typeof targetActor.applyDamage !== "function" ||
      !originActor ||
      originActor.uuid !== sourceActor?.uuid ||
      !item ||
      item.uuid !== sourceItem?.uuid ||
      context?.type !== "damage-roll"
    ) return null;

    const transformedRoll = multiplier === 1 ? damageRoll : damageRoll.alter(multiplier, 0);

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
    const capture = createApplicationCapture({
      transactionId: applicationId,
      attackMessageId,
      sourceActorUuid: sourceActor.uuid,
      itemUuid: sourceItem.uuid,
      targetToken,
      nativeMarker,
    });

    try {
      await contextClone.applyDamage({
        damage: transformedRoll,
        token: targetToken,
        item,
        skipIWR: false,
        rollOptions,
        shieldBlockRequest: false,
        outcome,
      });
      const applicationMessage = finishApplicationCapture(capture);
      // Post-application integration event: exact DamageRoll ↔ unique damage-taken
      // capture only. Never emits on undo (undo does not use this path).
      if (applicationMessage) {
        try {
          emitDamageAppliedFromApplication({
            transactionId: applicationId,
            applicationMessage,
            transformedRoll,
            damageMessage,
            targetActorUuid: targetActor.uuid,
            targetTokenUuid: targetToken.document?.uuid ?? targetToken.uuid ?? null,
            sourceActor,
            sourceItem,
          });
        } catch (error) {
          logger.error(
            "damageApplied emission failed",
            {
              stage: "damage-applied-emit",
              reason: error instanceof Error ? error.message : String(error),
              applicationId,
            },
            error,
          );
        }
      }
      return {
        applicationMessage,
        transformedRoll,
      };
    } finally {
      pendingApplicationCaptures.delete(applicationId);
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
