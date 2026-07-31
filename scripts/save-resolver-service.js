import {
  BASIC_SAVE_RESOLVER_MODES,
  MODULE_ID,
  SAVE_RESOLVER_SCHEMA_VERSION,
  SETTINGS,
} from "./constants.js";
import { guardedHealthRestore } from "./guarded-health-restore.js";
import { logger } from "./logger.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import {
  SaveMessageClaimRegistry,
  buildSaveCorrelationOption,
  validateSaveCandidate,
} from "./save-correlation.js";
import {
  RESOLVER_PHASES,
  SAVE_MULTIPLIERS,
  SAVE_OUTCOMES,
  activeOutcome,
  applicationIdFor,
  applyOutcomeOverride,
  deduplicateTargetSnapshots,
  finalParentPhase,
  isPersistentDamageSummary,
  refreshResolverPhase,
  resetTargetSave,
  resolverIdFor,
  targetEntryIdFor,
} from "./save-resolver-model.js";
import { getSetting } from "./settings.js";

const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
const mutationQueues = new Map();
const starting = new Set();
const resolvingDamage = new Set();
const rollingSaves = new Set();
let initialized = false;

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function flags(message) {
  return message?.flags?.pf2e ?? {};
}

function resolverFlag(message) {
  return message?.getFlag?.(MODULE_ID, "saveResolver") ?? null;
}

function sourceFlag(message) {
  return message?.getFlag?.(MODULE_ID, "saveResolverSource") ?? null;
}

function enqueue(resolverId, operation) {
  const previous = mutationQueues.get(resolverId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  mutationQueues.set(resolverId, current);
  void current.then(
    () => {
      if (mutationQueues.get(resolverId) === current) mutationQueues.delete(resolverId);
    },
    () => {
      if (mutationQueues.get(resolverId) === current) mutationQueues.delete(resolverId);
    },
  );
  return current;
}

function canProcess(resolver) {
  return Boolean(
    game.user.isGM &&
      resolver?.authoringUserId === game.user.id &&
      resolver.processingUserId === game.user.id,
  );
}

function targetPresentationSafe(token) {
  const nameVisibilityEnabled = Boolean(game.pf2e?.settings?.tokens?.nameVisibility);
  return Boolean(
    !token.document?.hidden &&
      (!nameVisibilityEnabled || token.playersCanSeeName === true),
  );
}

function safeTargetName(token, sequence) {
  return !targetPresentationSafe(token)
    ? format("Nelflow.SaveResolver.TargetNumber", { number: sequence + 1 })
    : token.name || format("Nelflow.SaveResolver.TargetNumber", { number: sequence + 1 });
}

function safeTargetImage(token) {
  return !targetPresentationSafe(token)
    ? "icons/svg/mystery-man.svg"
    : token.document?.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg";
}

function ownerIds(actor) {
  return Object.entries(actor?.ownership ?? {})
    .filter(([id, level]) => id !== "default" && Number(level) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    .map(([id]) => id)
    .sort();
}

function visibility(message) {
  return {
    whisper: Array.from(message.whisper ?? []).map((entry) => entry.id ?? entry),
    blind: Boolean(message.blind),
  };
}

function outcomeLabel(outcome) {
  const key = {
    criticalFailure: "Nelflow.Outcome.CriticalFailure",
    failure: "Nelflow.Outcome.Failure",
    success: "Nelflow.Outcome.Success",
    criticalSuccess: "Nelflow.Outcome.CriticalSuccess",
  }[outcome];
  return key ? localize(key) : localize("Nelflow.SaveResolver.Pending");
}

function multiplierLabel(multiplier) {
  return localize(
    {
      0: "Nelflow.SaveResolver.NoDamage",
      0.5: "Nelflow.SaveResolver.Half",
      1: "Nelflow.SaveResolver.Full",
      2: "Nelflow.SaveResolver.Double",
    }[multiplier] ?? "Nelflow.SaveResolver.Pending",
  );
}

function damageText(summary) {
  if (!Number.isFinite(summary?.total)) return "";
  const types = (summary.components ?? [])
    .map((component) => `${component.persistent ? `${localize("Nelflow.Stack.Persistent")} ` : ""}${component.type}`)
    .filter(Boolean);
  return [summary.total, ...new Set(types)].join(" ");
}

function gmOnlyFallbackAudience(resolver) {
  const recipients = resolver.visibility?.whisper ?? [];
  return Boolean(
    recipients.length &&
      recipients.every((userId) => game.users?.get(userId)?.isGM === true),
  );
}

export function buildSaveResolverFallback(resolver) {
  const includePrivate = gmOnlyFallbackAudience(resolver);
  const showDc = includePrivate || game.pf2e?.settings?.metagame?.dcs === true;
  const title = format("Nelflow.SaveResolver.FallbackTitle", {
    spell: resolver.spellName,
    dc: showDc ? resolver.save.dc : "?",
    save: localize(`Nelflow.SaveResolver.Save.${resolver.save.type}`),
  });
  const rows = resolver.targets.map((target) => {
    const outcome = activeOutcome(target);
    const parts = [
      escapeHtml(target.targetDisplayName),
      escapeHtml(
        outcome && !includePrivate
          ? localize("Nelflow.SaveResolver.SaveComplete")
          : outcomeLabel(outcome),
      ),
      outcome && includePrivate
        ? escapeHtml(multiplierLabel(SAVE_MULTIPLIERS[outcome]))
        : null,
    ].filter(Boolean);
    if (target.override?.outcome) {
      parts.push(escapeHtml(localize("Nelflow.SaveResolver.Adjusted")));
    }
    if (target.applicationState === "applied") {
      parts.push(
        escapeHtml(includePrivate
          ? format("Nelflow.SaveResolver.AppliedHp", { amount: target.appliedAmount ?? 0 })
          : localize("Nelflow.State.Applied")),
      );
    } else if (target.applicationState === "manual") {
      parts.push(escapeHtml(localize("Nelflow.SaveResolver.Manual")));
    } else if (target.applicationState === "undone") {
      parts.push(escapeHtml(localize("Nelflow.State.Undone")));
    }
    return `<li>${parts.join(" &middot; ")}</li>`;
  });
  return `<article class="nelflow-save-fallback"><strong>${escapeHtml(title)}</strong><ol>${rows.join("")}</ol></article>`;
}

function makeTarget(token, resolverId, sequence, saveType, saveDC) {
  const targetEntryId = targetEntryIdFor(resolverId, token.document.uuid, sequence);
  const attemptId = `${targetEntryId}-attempt-1`;
  return {
    targetEntryId,
    targetActorUuid: token.actor.uuid,
    targetTokenUuid: token.document.uuid,
    targetSceneId: token.document.parent?.id ?? null,
    targetDisplayName: safeTargetName(token, sequence),
    targetImage: safeTargetImage(token),
    kind: token.actor.isOfType?.("character") ? "pc" : "npc",
    ownerUserIds: ownerIds(token.actor),
    saveType,
    saveDC,
    saveAttempt: {
      id: attemptId,
      number: 1,
      rollingUserId: null,
      correlationOption: null,
      state: "pending",
    },
    priorSaveMessageIds: [],
    saveMessageId: null,
    rawDegreeOfSuccess: null,
    finalizedDegreeOfSuccess: null,
    outcomeSource: null,
    override: null,
    saveState: "pending",
    damageMultiplier: null,
    damageSummary: null,
    applicationId: applicationIdFor(resolverId, targetEntryId),
    applicationState: "pending",
    applicationMessageId: null,
    preApplication: null,
    postApplication: null,
    appliedAmount: null,
    undoBlocked: false,
    diagnosticReason: null,
  };
}

function makeResolver(sourceMessage, eligibility, targets) {
  const resolverId = resolverIdFor(sourceMessage.id);
  return {
    schemaVersion: SAVE_RESOLVER_SCHEMA_VERSION,
    resolverId,
    sourceMessageId: sourceMessage.id,
    sourceActorUuid: eligibility.sourceActorUuid,
    sourceTokenUuid: eligibility.sourceTokenUuid,
    spellItemUuid: eligibility.spellItemUuid,
    spellName: eligibility.spellName,
    spellImage: eligibility.spellImage,
    casterDisplayName: eligibility.casterDisplayName,
    authoringUserId: game.user.id,
    processingUserId: game.user.id,
    createdAt: Date.now(),
    visibility: visibility(sourceMessage),
    combatRef: game.combat?.started
      ? { combatId: game.combat.id, round: game.combat.round, turn: game.combat.turn }
      : null,
    save: { type: eligibility.saveType, dc: eligibility.saveDC, basic: true },
    phase: RESOLVER_PHASES.COLLECTING,
    targetOrder: targets.map((target) => target.targetEntryId),
    targets,
    damage: {
      state: "pending",
      correlationId: `${resolverId}-damage-1`,
      messageId: null,
      summary: null,
      candidateCount: 0,
    },
    nativeRecords: { sourceMessageId: sourceMessage.id },
    revision: 1,
  };
}

function messageForResolverId(resolverId) {
  return game.messages.find((message) => resolverFlag(message)?.resolverId === resolverId) ?? null;
}

function persistedSaveOwner(messageId) {
  for (const message of game.messages) {
    const resolver = resolverFlag(message);
    const target = resolver?.targets?.find((entry) => entry.saveMessageId === messageId);
    if (target) return target.saveAttempt?.id ?? null;
  }
  return null;
}

const saveClaims = new SaveMessageClaimRegistry({ persistedOwner: persistedSaveOwner });

async function persistResolver(message, transform) {
  const current = resolverFlag(message);
  if (!current?.resolverId || !canProcess(current)) throw new Error("Resolver authority unavailable");
  const next = transform(structuredClone(current));
  next.resolverId = current.resolverId;
  next.sourceMessageId = current.sourceMessageId;
  next.authoringUserId = current.authoringUserId;
  next.processingUserId = current.processingUserId;
  next.revision = (current.revision ?? 0) + 1;
  await message.update({
    content: buildSaveResolverFallback(next),
    [`flags.${MODULE_ID}.saveResolver`]: next,
  });
  return resolverFlag(message);
}

async function inspectSource(message) {
  if (
    getSetting(SETTINGS.BASIC_SAVE_RESOLVER) !== BASIC_SAVE_RESOLVER_MODES.NPC_SPELLS ||
    !game.user.isGM ||
    message.author?.id !== game.user.id ||
    sourceFlag(message)
  ) return;

  const pf2e = flags(message);
  const item = message.item;
  const actor = message.actor;
  const save = item?.system?.defense?.save;
  const dc = item?.spellcasting?.statistic?.withRollOptions?.({ item })?.dc?.value;
  if (
    pf2e.context?.type !== "spell-cast" ||
    !actor?.isOfType?.("npc") ||
    !item?.isOfType?.("spell") ||
    item.isAttack ||
    save?.basic !== true ||
    !SAVE_TYPES.has(save.statistic) ||
    !Number.isFinite(dc) ||
    typeof item.getDamage !== "function" ||
    typeof item.rollDamage !== "function"
  ) return;
  const nativeDamage = await item.getDamage({ skipDialog: true });
  if (!nativeDamage?.template || !nativeDamage?.context) return;

  await message.setFlag(MODULE_ID, "saveResolverSource", {
    schemaVersion: 1,
    eligible: true,
    resolverId: resolverIdFor(message.id),
    resolverMessageId: null,
    sourceActorUuid: actor.uuid,
    sourceTokenUuid: pf2e.context?.origin?.token ?? message.token?.uuid ?? null,
    spellItemUuid: item.uuid,
    spellName: item.name,
    spellImage: item.img,
    casterDisplayName: message.token?.name ?? actor.name,
    saveType: save.statistic,
    saveDC: dc,
    authoringUserId: game.user.id,
  });
}

function saveCandidate(message, correlationOption) {
  const pf2e = flags(message);
  const context = pf2e.context;
  const roll = message.rolls?.find((candidate) => candidate?.options?.type === "saving-throw");
  return {
    document: message,
    isChatMessage: message instanceof CONFIG.ChatMessage.documentClass,
    messageId: message.id,
    visible: Boolean(message.visible && message.isContentVisible),
    correlationOption,
    authorUserId: message.author?.id,
    contextType: context?.type,
    statistic: pf2e.modifierName ?? roll?.options?.identifier ?? null,
    dc: context?.dc?.value,
    isCheckRoll: Boolean(roll),
    outcome: context?.outcome,
    degreeOfSuccess: roll?.options?.degreeOfSuccess,
    sourceActorUuid: context?.origin?.actor,
    targetActorUuid: context?.target?.actor,
    targetTokenUuid: context?.target?.token,
    itemUuid: pf2e.origin?.uuid,
    existingClaim: message.getFlag?.(MODULE_ID, "saveResolverNative")?.attemptId ?? null,
  };
}

function eligibleRoller(resolver, target, userId) {
  const user = game.users.get(userId);
  if (!user) return false;
  if (user.isGM) {
    return (
      userId === resolver.authoringUserId &&
      (target.kind === "npc" || target.ownerUserIds.length === 0)
    );
  }
  return target.kind === "pc" && target.ownerUserIds.includes(userId);
}

async function observeSaveMessage(message) {
  const options = flags(message).context?.options ?? [];
  const correlationOption = options.find((option) =>
    String(option).startsWith("nelflow:save-correlation:"),
  );
  if (!correlationOption || !game.user.isGM) return;
  logger.debug("save-candidate-observed", {
    saveMessageId: message.id,
    rollingUserId: message.author?.id,
  });

  for (const resolverMessage of game.messages) {
    const resolver = resolverFlag(resolverMessage);
    if (!canProcess(resolver)) continue;
    const target = resolver.targets.find((entry) => {
      const expected = buildSaveCorrelationOption({
        resolverId: resolver.resolverId,
        targetEntryId: entry.targetEntryId,
        attemptId: entry.saveAttempt?.id,
        sourceMessageId: resolver.sourceMessageId,
        rollingUserId: message.author?.id,
      });
      return expected === correlationOption;
    });
    if (!target) continue;
    const scope = {
      resolverId: resolver.resolverId,
      targetEntryId: target.targetEntryId,
      attemptId: target.saveAttempt.id,
      correlationOption,
      rollingUserId: message.author?.id,
      saveType: target.saveType,
      saveDC: target.saveDC,
      targetActorUuid: target.targetActorUuid,
      targetTokenUuid: target.targetTokenUuid,
      sourceActorUuid: resolver.sourceActorUuid,
      spellItemUuid: resolver.spellItemUuid,
    };
    const candidate = saveCandidate(message, correlationOption);
    const validation = validateSaveCandidate(scope, candidate);
    if (!validation.ok || !eligibleRoller(resolver, target, message.author?.id)) {
      logger.debug("save-candidate-rejected", {
        resolverId: resolver.resolverId.slice(-12),
        targetEntryId: target.targetEntryId.slice(-12),
        reason: validation.reason ?? "roller-ineligible",
      });
      return;
    }
    await enqueue(resolver.resolverId, async () => {
      const fresh = resolverFlag(resolverMessage);
      const freshTarget = fresh?.targets.find((entry) => entry.targetEntryId === target.targetEntryId);
      if (
        !canProcess(fresh) ||
        freshTarget?.saveState !== "pending" ||
        freshTarget.saveAttempt?.id !== target.saveAttempt.id
      ) return;
      const claim = saveClaims.claim(message.id, target.saveAttempt.id);
      if (!claim.ok) return;
      const updated = await persistResolver(resolverMessage, (draft) => {
        const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
        entry.saveAttempt = {
          ...entry.saveAttempt,
          rollingUserId: message.author.id,
          correlationOption,
          state: "complete",
        };
        entry.saveMessageId = message.id;
        entry.rawDegreeOfSuccess = candidate.outcome;
        entry.finalizedDegreeOfSuccess = candidate.outcome;
        entry.outcomeSource = "pf2e-message-context";
        entry.saveState = "complete";
        entry.damageMultiplier = SAVE_MULTIPLIERS[candidate.outcome];
        draft.phase = refreshResolverPhase(draft);
        return draft;
      });
      await message.setFlag(MODULE_ID, "saveResolverNative", {
        resolverId: updated.resolverId,
        sourceMessageId: updated.sourceMessageId,
        role: "save",
        targetEntryId: target.targetEntryId,
        attemptId: target.saveAttempt.id,
      });
      logger.debug("save-candidate-claimed", {
        resolverId: resolver.resolverId.slice(-12),
        targetEntryId: target.targetEntryId.slice(-12),
        saveMessageId: message.id,
      });
      logger.debug("save-outcome-finalized", {
        resolverId: resolver.resolverId.slice(-12),
        targetEntryId: target.targetEntryId.slice(-12),
        outcome: candidate.outcome,
      });
      if (updated.phase === RESOLVER_PHASES.READY) {
        logger.debug("resolver-ready", { resolverId: resolver.resolverId.slice(-12) });
      }
    });
    return;
  }
}

export class SaveResolverService {
  static initialize() {
    if (initialized) return;
    initialized = true;
    PF2eAdapter.registerMessageObserver((message) => {
      void observeSaveMessage(message).catch((error) =>
        logger.error("Save correlation failed", { stage: "save-candidate" }, error),
      );
    });
    for (const message of game.messages) {
      const resolver = resolverFlag(message);
      for (const target of resolver?.targets ?? []) {
        if (target.saveMessageId) saveClaims.restore(target.saveMessageId, target.saveAttempt?.id);
      }
      if (canProcess(resolver) && ["rolling-damage", "applying-damage"].includes(resolver.phase)) {
        void enqueue(resolver.resolverId, () =>
          persistResolver(message, (draft) => {
            draft.phase = RESOLVER_PHASES.INTERRUPTED;
            draft.damage.state = "manual";
            for (const target of draft.targets) {
              if (target.applicationState === "pending") {
                target.applicationState = "manual";
                target.diagnosticReason = "resolver-interrupted";
              }
            }
            return draft;
          }),
        ).catch((error) => {
          logger.error("Interrupted resolver persistence failed", {
            stage: "resolver-interrupted",
            reason: error instanceof Error ? error.message : String(error),
          }, error);
        });
        logger.debug("resolver-interrupted", { resolverId: resolver.resolverId.slice(-12) });
      }
    }
  }

  static async handleMessage(message) {
    await inspectSource(message);
  }

  static async start(sourceMessage) {
    const eligibility = sourceFlag(sourceMessage);
    if (
      !eligibility?.eligible ||
      eligibility.authoringUserId !== game.user.id ||
      sourceMessage.author?.id !== game.user.id ||
      !game.user.isGM ||
      eligibility.resolverMessageId ||
      starting.has(sourceMessage.id)
    ) return;

    const selected = PF2eAdapter.selectedTargets();
    const validTokens = selected.filter(
      (token) =>
        token?.document?.uuid &&
        token.actor?.uuid &&
        token.actor.isOfType?.("creature") === true,
    );
    if (validTokens.length !== selected.length) {
      ui.notifications.warn("Nelflow.Notification.SaveResolverTargetsOmitted", {
        localize: true,
      });
    }
    const deduped = deduplicateTargetSnapshots(
      validTokens.map((token) => ({ targetTokenUuid: token.document.uuid, token })),
    ).map((entry) => entry.token);
    if (!deduped.length) {
      ui.notifications.warn("Nelflow.Notification.SaveResolverNoTargets", { localize: true });
      return;
    }

    starting.add(sourceMessage.id);
    try {
      const resolverId = resolverIdFor(sourceMessage.id);
      const existing = messageForResolverId(resolverId);
      if (existing) {
        await sourceMessage.update({
          [`flags.${MODULE_ID}.saveResolverSource.resolverMessageId`]: existing.id,
          [`flags.${MODULE_ID}.saveResolverNative`]: {
            resolverId,
            sourceMessageId: sourceMessage.id,
            role: "source",
          },
        });
        return;
      }
      const targets = deduped.map((token, index) =>
        makeTarget(token, resolverId, index, eligibility.saveType, eligibility.saveDC),
      );
      const resolver = makeResolver(sourceMessage, eligibility, targets);
      for (const target of targets) {
        logger.debug("save-target-snapshotted", {
          resolverId: resolverId.slice(-12),
          targetEntryId: target.targetEntryId.slice(-12),
        });
      }
      const ChatMessageClass = CONFIG.ChatMessage.documentClass;
      const resolverMessage = await ChatMessageClass.create({
        author: game.user.id,
        speaker: sourceMessage.speaker,
        whisper: resolver.visibility.whisper,
        blind: resolver.visibility.blind,
        content: buildSaveResolverFallback(resolver),
        flags: { [MODULE_ID]: { saveResolver: resolver } },
      });
      if (!resolverMessage) throw new Error("Resolver message was not created");
      await sourceMessage.update({
        [`flags.${MODULE_ID}.saveResolverSource.resolverMessageId`]: resolverMessage.id,
        [`flags.${MODULE_ID}.saveResolverNative`]: {
          resolverId,
          sourceMessageId: sourceMessage.id,
          role: "source",
        },
      });
      logger.debug("save-resolver-started", {
        resolverId: resolverId.slice(-12),
        sourceMessageId: sourceMessage.id,
        targetCount: targets.length,
      });
    } catch (error) {
      logger.error("Save resolver start failed", { sourceMessageId: sourceMessage.id }, error);
      ui.notifications.error("Nelflow.Notification.SaveResolverStartFailed", { localize: true });
    } finally {
      starting.delete(sourceMessage.id);
    }
  }

  static async rollSave(resolverMessage, targetEntryId) {
    const resolver = resolverFlag(resolverMessage);
    const target = resolver?.targets.find((entry) => entry.targetEntryId === targetEntryId);
    const rollKey = `${resolver?.resolverId}:${target?.saveAttempt?.id}`;
    if (!target || target.saveState !== "pending" || rollingSaves.has(rollKey)) return;
    const targetToken = await PF2eAdapter.resolveToken(target.targetTokenUuid);
    const sourceMessage = game.messages.get(resolver.sourceMessageId);
    const spell = sourceMessage?.item;
    const isAuthorGm =
      game.user.isGM &&
      game.user.id === resolver.authoringUserId &&
      (target.kind === "npc" || target.ownerUserIds.length === 0);
    const isPcOwner = !game.user.isGM && target.kind === "pc" && targetToken?.actor?.isOwner;
    if (
      !(isAuthorGm || isPcOwner) ||
      targetToken?.actor?.uuid !== target.targetActorUuid ||
      !spell?.isOfType?.("spell") ||
      spell.uuid !== resolver.spellItemUuid
    ) return;
    const save = targetToken.actor.saves?.[target.saveType];
    if (typeof save?.check?.roll !== "function") return;
    const correlationOption = buildSaveCorrelationOption({
      resolverId: resolver.resolverId,
      targetEntryId,
      attemptId: target.saveAttempt.id,
      sourceMessageId: resolver.sourceMessageId,
      rollingUserId: game.user.id,
    });
    rollingSaves.add(rollKey);
    try {
      logger.debug("save-roll-started", {
        resolverId: resolver.resolverId.slice(-12),
        targetEntryId: targetEntryId.slice(-12),
      });
      await save.check.roll({
        dc: { value: target.saveDC },
        item: spell,
        origin: spell.actor,
        token: targetToken.document,
        damaging: true,
        extraRollOptions: [correlationOption],
      });
    } finally {
      rollingSaves.delete(rollKey);
    }
  }

  static async rollPendingNpcSaves(resolverMessage) {
    const resolver = resolverFlag(resolverMessage);
    if (!canProcess(resolver)) return;
    for (const target of resolver.targets) {
      if (
        target.saveState === "pending" &&
        (target.kind === "npc" || target.ownerUserIds.length === 0)
      ) {
        await this.rollSave(resolverMessage, target.targetEntryId);
      }
    }
  }

  static async resetSave(resolverMessage, targetEntryId) {
    const resolver = resolverFlag(resolverMessage);
    if (!canProcess(resolver) || !["collecting-saves", "ready"].includes(resolver.phase)) return;
    await enqueue(resolver.resolverId, () =>
      persistResolver(resolverMessage, (draft) => {
        const index = draft.targets.findIndex((entry) => entry.targetEntryId === targetEntryId);
        const target = draft.targets[index];
        if (!target || target.saveState !== "complete") return draft;
        if (target.saveMessageId) target.priorSaveMessageIds.push(target.saveMessageId);
        const nextAttempt = `${target.targetEntryId}-attempt-${(target.saveAttempt?.number ?? 1) + 1}`;
        draft.targets[index] = {
          ...resetTargetSave(target, nextAttempt),
          priorSaveMessageIds: target.priorSaveMessageIds,
        };
        draft.phase = RESOLVER_PHASES.COLLECTING;
        return draft;
      }),
    );
    logger.debug("save-reset", { resolverId: resolver.resolverId.slice(-12) });
  }

  static async setOverride(resolverMessage, targetEntryId, outcome, reason = null) {
    const resolver = resolverFlag(resolverMessage);
    if (!canProcess(resolver) || !["collecting-saves", "ready"].includes(resolver.phase)) return;
    await enqueue(resolver.resolverId, () =>
      persistResolver(resolverMessage, (draft) => {
        const target = draft.targets.find((entry) => entry.targetEntryId === targetEntryId);
        if (!target || target.saveState !== "complete") return draft;
        Object.assign(target, applyOutcomeOverride(target, outcome, reason));
        draft.phase = refreshResolverPhase(draft);
        return draft;
      }),
    );
    logger.debug("save-override-set", { resolverId: resolver.resolverId.slice(-12) });
  }

  static async cancel(resolverMessage) {
    const resolver = resolverFlag(resolverMessage);
    if (!canProcess(resolver) || !["collecting-saves", "ready"].includes(resolver.phase)) return;
    await enqueue(resolver.resolverId, () =>
      persistResolver(resolverMessage, (draft) => {
        draft.phase = RESOLVER_PHASES.CANCELLED;
        return draft;
      }),
    );
    logger.debug("resolver-cancelled", { resolverId: resolver.resolverId.slice(-12) });
  }

  static async resolveDamage(resolverMessage) {
    let resolver = resolverFlag(resolverMessage);
    if (
      !canProcess(resolver) ||
      refreshResolverPhase(resolver) !== RESOLVER_PHASES.READY ||
      resolver.damage.messageId ||
      resolvingDamage.has(resolver.resolverId)
    ) return;
    resolvingDamage.add(resolver.resolverId);
    try {
      resolver = await enqueue(resolver.resolverId, () =>
        persistResolver(resolverMessage, (draft) => {
          if (refreshResolverPhase(draft) === RESOLVER_PHASES.READY && !draft.damage.messageId) {
            draft.phase = RESOLVER_PHASES.ROLLING_DAMAGE;
            draft.damage.state = "rolling";
          }
          return draft;
        }),
      );
      if (resolver.phase !== RESOLVER_PHASES.ROLLING_DAMAGE) return;
      const sourceMessage = game.messages.get(resolver.sourceMessageId);
      const spell = sourceMessage?.item;
      if (
        !sourceMessage ||
        !spell?.isOfType?.("spell") ||
        spell.uuid !== resolver.spellItemUuid
      ) throw new Error("Source spell is no longer safely resolvable");

      logger.debug("spell-damage-started", { resolverId: resolver.resolverId.slice(-12) });
      const rolled = await PF2eAdapter.rollSpellDamage({
        sourceMessage,
        spell,
        resolverId: resolver.resolverId,
        correlationId: resolver.damage.correlationId,
      });
      if (!rolled.ok) {
        await enqueue(resolver.resolverId, () =>
          persistResolver(resolverMessage, (draft) => {
            draft.phase = RESOLVER_PHASES.ERROR;
            draft.damage.state = "manual";
            draft.damage.candidateCount = rolled.candidateCount ?? 0;
            draft.damage.diagnosticReason = rolled.reason;
            return draft;
          }),
        );
        return;
      }
      const damageMarker = rolled.damageMessage.getFlag?.(MODULE_ID, "saveResolverNative");
      if (
        damageMarker?.resolverId !== resolver.resolverId ||
        damageMarker.correlationId !== resolver.damage.correlationId ||
        damageMarker.role !== "damage"
      ) {
        throw new Error("Shared damage correlation marker is invalid");
      }

      const summary = PF2eAdapter.summarizeDamageRoll(rolled.roll);
      resolver = await enqueue(resolver.resolverId, () =>
        persistResolver(resolverMessage, (draft) => {
          draft.phase = RESOLVER_PHASES.APPLYING_DAMAGE;
          draft.damage.state = "claimed";
          draft.damage.messageId = rolled.damageMessage.id;
          draft.damage.summary = summary;
          draft.damage.candidateCount = 1;
          return draft;
        }),
      );
      logger.debug("spell-damage-claimed", {
        resolverId: resolver.resolverId.slice(-12),
        damageMessageId: rolled.damageMessage.id,
      });

      const autoApply = getSetting(SETTINGS.AUTO_APPLY_BASIC_SAVE_DAMAGE);
      const persistent = isPersistentDamageSummary(summary);
      for (const snapshot of resolver.targets) {
        const latest = resolverFlag(resolverMessage);
        if (
          !canProcess(latest) ||
          latest.phase !== RESOLVER_PHASES.APPLYING_DAMAGE ||
          latest.damage?.messageId !== rolled.damageMessage.id
        ) break;
        const target = latest.targets.find((entry) => entry.targetEntryId === snapshot.targetEntryId);
        if (!target || target.applicationState !== "pending") continue;
        const outcome = activeOutcome(target);
        const multiplier = SAVE_MULTIPLIERS[outcome];
        if (outcome === "criticalSuccess") {
          await enqueue(resolver.resolverId, () =>
            persistResolver(resolverMessage, (draft) => {
              const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
              entry.damageMultiplier = 0;
              entry.applicationState = "no-damage";
              return draft;
            }),
          );
          continue;
        }
        const transformed = multiplier === 1 ? rolled.roll : rolled.roll.alter(multiplier, 0);
        const transformedSummary = PF2eAdapter.summarizeDamageRoll(transformed);
        if (!autoApply || persistent) {
          await enqueue(resolver.resolverId, () =>
            persistResolver(resolverMessage, (draft) => {
              const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
              entry.damageMultiplier = multiplier;
              entry.damageSummary = transformedSummary;
              entry.applicationState = persistent ? "manual" : "not-applied";
              entry.diagnosticReason = persistent ? "persistent-damage" : null;
              return draft;
            }),
          );
          logger.debug("target-application-manual", {
            resolverId: resolver.resolverId.slice(-12),
            targetEntryId: target.targetEntryId.slice(-12),
            reason: persistent ? "persistent-damage" : "auto-apply-disabled",
          });
          continue;
        }

        const targetToken = await PF2eAdapter.resolveToken(target.targetTokenUuid);
        if (targetToken?.actor?.uuid !== target.targetActorUuid) {
          await enqueue(resolver.resolverId, () =>
            persistResolver(resolverMessage, (draft) => {
              const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
              entry.damageMultiplier = multiplier;
              entry.damageSummary = transformedSummary;
              entry.applicationState = "manual";
              entry.diagnosticReason = "target-unavailable";
              return draft;
            }),
          );
          logger.debug("target-application-manual", {
            resolverId: resolver.resolverId.slice(-12),
            targetEntryId: target.targetEntryId.slice(-12),
            reason: "target-unavailable",
          });
          continue;
        }
        const before = PF2eAdapter.healthSnapshot(targetToken.actor);
        if (!before) {
          await enqueue(resolver.resolverId, () =>
            persistResolver(resolverMessage, (draft) => {
              const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
              entry.damageMultiplier = multiplier;
              entry.damageSummary = transformedSummary;
              entry.applicationState = "manual";
              entry.diagnosticReason = "health-snapshot-unavailable";
              return draft;
            }),
          );
          logger.debug("target-application-manual", {
            resolverId: resolver.resolverId.slice(-12),
            targetEntryId: target.targetEntryId.slice(-12),
            reason: "health-snapshot-unavailable",
          });
          continue;
        }
        logger.debug("target-application-started", {
          resolverId: resolver.resolverId.slice(-12),
          targetEntryId: target.targetEntryId.slice(-12),
        });
        let applied = null;
        try {
          applied = await PF2eAdapter.applyDamageRollToRecordedTarget({
            damageMessage: rolled.damageMessage,
            damageRoll: rolled.roll,
            sourceActor: spell.actor,
            sourceItem: spell,
            targetToken,
            expectedTargetActorUuid: target.targetActorUuid,
            multiplier,
            outcome,
            applicationId: target.applicationId,
            nativeMarker: {
              resolverId: resolver.resolverId,
              sourceMessageId: resolver.sourceMessageId,
              role: "application",
              targetEntryId: target.targetEntryId,
              applicationId: target.applicationId,
            },
          });
        } catch (error) {
          logger.error(
            "Target application failed",
            {
              stage: "target-application",
              reason: error instanceof Error ? error.message : String(error),
            },
            error,
          );
        }
        const after = applied ? PF2eAdapter.healthSnapshot(targetToken.actor) : null;
        await enqueue(resolver.resolverId, () =>
          persistResolver(resolverMessage, (draft) => {
            const entry = draft.targets.find((item) => item.targetEntryId === target.targetEntryId);
            entry.damageMultiplier = multiplier;
            entry.damageSummary = transformedSummary;
            if (!applied || !after) {
              entry.applicationState = "manual";
              entry.diagnosticReason = "native-application-failed";
            } else {
              entry.applicationState = "applied";
              entry.applicationMessageId = applied.applicationMessage?.id ?? null;
              entry.preApplication = before;
              entry.postApplication = after;
              entry.appliedAmount = Math.max(
                0,
                before.hp + before.tempHp - after.hp - after.tempHp,
              );
            }
            return draft;
          }),
        );
        logger.debug(applied && after ? "target-application-complete" : "target-application-manual", {
          resolverId: resolver.resolverId.slice(-12),
          targetEntryId: target.targetEntryId.slice(-12),
        });
      }
      const completed = await enqueue(resolver.resolverId, () =>
        persistResolver(resolverMessage, (draft) => {
          draft.phase = finalParentPhase(draft.targets);
          draft.damage.state = "complete";
          return draft;
        }),
      );
      logger.debug(
        completed.phase === RESOLVER_PHASES.COMPLETE ? "resolver-complete" : "resolver-partial",
        { resolverId: resolver.resolverId.slice(-12) },
      );
    } catch (error) {
      logger.error(
        "Basic-save damage resolution failed",
        { resolverId: resolver?.resolverId?.slice(-12), stage: "resolve-damage" },
        error,
      );
      if (resolver?.resolverId) {
        await enqueue(resolver.resolverId, () =>
          persistResolver(resolverMessage, (draft) => {
            draft.phase = draft.damage.messageId ? RESOLVER_PHASES.PARTIAL : RESOLVER_PHASES.ERROR;
            draft.damage.state = "manual";
            for (const target of draft.targets) {
              if (target.applicationState === "pending") target.applicationState = "manual";
            }
            return draft;
          }),
        ).catch(() => undefined);
      }
    } finally {
      if (resolver?.resolverId) resolvingDamage.delete(resolver.resolverId);
    }
  }

  static async undo(resolverMessage, targetEntryId) {
    const resolver = resolverFlag(resolverMessage);
    const target = resolver?.targets.find((entry) => entry.targetEntryId === targetEntryId);
    if (
      !canProcess(resolver) ||
      !getSetting(SETTINGS.ENABLE_UNDO) ||
      target?.applicationState !== "applied"
    ) return;
    const restored = await guardedHealthRestore({
      resolveToken: (uuid) => PF2eAdapter.resolveToken(uuid),
      healthSnapshot: (actor) => PF2eAdapter.healthSnapshot(actor),
      restoreHealth: (actor, snapshot) => PF2eAdapter.restoreHealth(actor, snapshot),
      targetTokenUuid: target.targetTokenUuid,
      targetActorUuid: target.targetActorUuid,
      preApplication: target.preApplication,
      postApplication: target.postApplication,
    });
    await enqueue(resolver.resolverId, () =>
      persistResolver(resolverMessage, (draft) => {
        const entry = draft.targets.find((item) => item.targetEntryId === targetEntryId);
        if (restored.ok) entry.applicationState = "undone";
        else if (restored.reason === "health-changed") {
          entry.applicationState = "undo-blocked";
          entry.undoBlocked = true;
        }
        return draft;
      }),
    );
    if (restored.reason === "health-changed") {
      ui.notifications.warn("Nelflow.Notification.UndoChanged", { localize: true });
    }
  }

  static getResolver(message) {
    return resolverFlag(message);
  }

  static getSource(message) {
    return sourceFlag(message);
  }

  static damageText(summary) {
    return damageText(summary);
  }
}
