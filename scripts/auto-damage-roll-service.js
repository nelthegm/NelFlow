import {
  AUTO_DAMAGE_ROLL_SCHEMA_VERSION,
  AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES,
  BASIC_SAVE_WORKFLOW_MODES,
  MODULE_ID,
  SETTINGS,
} from "./constants.js";
import {
  autoDamageCandidateMatches,
  autoDamageIntegrationId,
  autorollModeAllows,
  inspectNativeDamageAction,
  invokeNativeDamageAction,
} from "./native-damage-action-adapter.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { sourceModeAllows } from "./basic-save-source-classifier.js";
import {
  selectToolbeltDamageRoll,
  ToolbeltTargetHelperAdapter,
} from "./toolbelt-target-helper-adapter.js";
import {
  AUTO_DAMAGE_ROLL_STATES,
  AutoDamageMessageClaimRegistry,
  isTerminalAutoDamageState,
  liveInvocationAllowed,
} from "./auto-damage-roll-model.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import {
  appendAudit,
  recordFailure,
  RECOVERY_STATUSES,
  updateRecovery,
} from "./transaction-failure.js";

const FLAG = "autoDamageRoll";
const ORIGIN_FLAG = "autoDamageRollOrigin";
const liveSourceIds = new Set();
const liveDamageIds = new Set();
const activeSourceIds = new Map();
const mutationQueues = new Map();
const captures = new Map();
const scheduled = new Set();
const damageClaims = new AutoDamageMessageClaimRegistry();
const externalCandidates = new Map();
let invocationQueue = Promise.resolve();
let initialized = false;

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 10 ? text.slice(-10) : text;
}

function diagnostic(event, data = {}) {
  logger.debug(event, {
    integrationId: shortId(data.integrationId),
    messageId: shortId(data.messageId),
    sourceKind: data.sourceKind ?? null,
    sourceItemType: data.sourceItemType ?? null,
    rollIndex: Number.isInteger(data.rollIndex) ? data.rollIndex : null,
    rollingUser: data.rollingUserId ? shortId(data.rollingUserId) : null,
    rollingUserRole: data.rollingUserRole ?? null,
    reason: data.reason ?? null,
  });
}

function queue(messageId, operation) {
  const prior = mutationQueues.get(messageId) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  mutationQueues.set(messageId, current);
  return current.finally(() => {
    if (mutationQueues.get(messageId) === current) mutationQueues.delete(messageId);
  });
}

function transaction(message) {
  const value = message?.getFlag?.(MODULE_ID, FLAG) ?? null;
  return value?.schemaVersion === AUTO_DAMAGE_ROLL_SCHEMA_VERSION &&
    value.sourceMessageId === message.id &&
    typeof value.integrationId === "string"
    ? value
    : null;
}

async function persist(message, draft) {
  draft.revision = Number(draft.revision ?? 0) + 1;
  draft.updatedAt = Date.now();
  const active = [AUTO_DAMAGE_ROLL_STATES.CLAIMED, AUTO_DAMAGE_ROLL_STATES.ROLLING].includes(draft.state);
  draft.activeOperation = active
    ? {
        ownerUserId: draft.rollingUserId,
        enteredRevision: draft.activeOperation?.enteredRevision ?? draft.revision,
        sessionId: draft.activeOperation?.sessionId ?? getRuntimeSessionId(),
      }
    : null;
  const event = {
    [AUTO_DAMAGE_ROLL_STATES.OBSERVED]: "observed",
    [AUTO_DAMAGE_ROLL_STATES.AWAITING_TARGETS]: "awaiting-targets",
    [AUTO_DAMAGE_ROLL_STATES.ELIGIBLE]: "eligible",
    [AUTO_DAMAGE_ROLL_STATES.CLAIMED]: "claimed",
    [AUTO_DAMAGE_ROLL_STATES.ROLLING]: "rolling",
    [AUTO_DAMAGE_ROLL_STATES.COMPLETED]: "damage-message-linked",
    [AUTO_DAMAGE_ROLL_STATES.EXTERNAL]: "damage-message-linked",
    [AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS]: "ambiguous",
    [AUTO_DAMAGE_ROLL_STATES.MANUAL]: "manual",
    [AUTO_DAMAGE_ROLL_STATES.INTERRUPTED]: "interrupted",
    [AUTO_DAMAGE_ROLL_STATES.ERROR]: "application-failed",
    [AUTO_DAMAGE_ROLL_STATES.ABANDONED]: "abandoned",
  }[draft.state] ?? "classified";
  appendAudit(draft, {
    event,
    state: draft.state,
    subsystem: "autoroll",
    userRole: draft.rollingUserRole ?? "unknown",
    safeReason: draft.failureReason,
    revision: draft.revision,
  });
  if ([AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS, AUTO_DAMAGE_ROLL_STATES.INTERRUPTED, AUTO_DAMAGE_ROLL_STATES.ERROR].includes(draft.state)) {
    recordFailure(draft, {
      reason: draft.failureReason,
      subsystem: "autoroll",
      operation: event,
      event,
      userRole: draft.rollingUserRole,
      context: {
        messageId: message.id,
        transactionId: draft.integrationId,
        sourceKind: draft.sourceKind,
        rollIndex: draft.damageRollIndex,
        userRole: draft.rollingUserRole,
      },
    });
  }
  await message.update({ [`flags.${MODULE_ID}.${FLAG}`]: draft });
  return draft;
}

function workflowEnabled() {
  return getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT;
}

function configuredMode() {
  return getSetting(SETTINGS.AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL) ??
    AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF;
}

function sourceModeEnabled(normalized) {
  return sourceModeAllows(
    normalized.sourceKind,
    getSetting(SETTINGS.TOOLBELT_BASIC_SAVE_SOURCES),
  );
}

function currentUserIsRollingAuthor(normalized) {
  const author = game.users?.get(normalized.sourceUserId) ?? null;
  return Boolean(
    author &&
      game.user?.id === author.id &&
      autorollModeAllows(configuredMode(), author),
  );
}

function createTransaction(normalized, state, reason = null) {
  const nonce = foundry.utils.randomID(12);
  const author = game.users?.get(normalized.sourceUserId);
  const isSpell = normalized.sourceKind === "spell";
  const created = {
    schemaVersion: AUTO_DAMAGE_ROLL_SCHEMA_VERSION,
    integrationId: autoDamageIntegrationId(normalized.sourceMessageId, nonce),
    sourceMessageId: normalized.sourceMessageId,
    sourceActorUuid: normalized.sourceActorUuid,
    sourceItemUuid: normalized.sourceItemUuid,
    sourceKind: normalized.sourceKind,
    sourceItemType: normalized.sourceItemType,
    sourceUserId: normalized.sourceUserId,
    rollingUserId: normalized.sourceUserId,
    rollingUserRole: author?.isGM ? "gm" : "player",
    sourceFingerprint: normalized.sourceFingerprint,
    targetFingerprint: normalized.targetFingerprint,
    targetTokenUuids: normalized.targets.map((target) => target.tokenUuid),
    damageActionId: isSpell ? "spell-damage" : null,
    damageRollIndex: isSpell ? 0 : null,
    castRank: normalized.castRank,
    overlayIds: [...(normalized.overlayIds ?? [])],
    actionVariant: normalized.actionVariant,
    saveType: normalized.saveType,
    state,
    damageMessageId: null,
    candidateMessageIds: [],
    sourceClassifierVersion: normalized.sourceClassifierVersion,
    sourceAdapterVersion: null,
    eligibilityFingerprint: null,
    rollMode: normalized.messageMode,
    manualRollEnabled: false,
    guardSourceControl: false,
    failureReason: reason,
    createdAt: Date.now(),
    claimedAt: null,
    completedAt: null,
    updatedAt: Date.now(),
    revision: 0,
  };
  appendAudit(created, {
    event: "observed",
    state,
    subsystem: "autoroll",
    userRole: author?.isGM ? "gm" : "player",
    safeReason: reason,
  });
  return created;
}

function sourceIdentityMatches(draft, normalized) {
  return Boolean(
    normalized?.ok &&
      draft.sourceMessageId === normalized.sourceMessageId &&
      draft.sourceActorUuid === normalized.sourceActorUuid &&
      draft.sourceItemUuid === normalized.sourceItemUuid &&
      draft.sourceKind === normalized.sourceKind &&
      draft.sourceUserId === normalized.sourceUserId &&
      draft.saveType === normalized.saveType &&
      draft.castRank === normalized.castRank &&
      JSON.stringify(draft.overlayIds ?? []) === JSON.stringify(normalized.overlayIds ?? []),
  );
}

function structuralPreCreateMatch(capture, document) {
  const flags = document?.flags?.pf2e ?? {};
  const authorId = document.author?.id ?? document.user?.id ?? document._source?.user ?? null;
  const selected = selectToolbeltDamageRoll(document.rolls, -1);
  return Boolean(
    selected.ok &&
      selected.index === capture.damageRollIndex &&
      flags.context?.type === "damage-roll" &&
      flags.context?.sourceType === "save" &&
      flags.context?.outcome == null &&
      flags.origin?.actor === capture.sourceActorUuid &&
      flags.origin?.uuid === capture.sourceItemUuid &&
      flags.origin?.castRank === capture.castRank &&
      JSON.stringify(
        Array.isArray(flags.origin?.variant?.overlays)
          ? [...flags.origin.variant.overlays].map(String).sort()
          : [],
      ) === JSON.stringify(capture.overlayIds ?? []) &&
      authorId === capture.rollingUserId,
  );
}

function onPreCreateChatMessage(document) {
  for (const capture of captures.values()) {
    if (!structuralPreCreateMatch(capture, document)) continue;
    const marker = {
      schemaVersion: 1,
      integrationId: capture.integrationId,
      sourceMessageId: capture.sourceMessageId,
      damageRollIndex: capture.damageRollIndex,
      targetFingerprint: capture.targetFingerprint,
    };
    const update = { [`flags.${MODULE_ID}.${ORIGIN_FLAG}`]: marker };
    const publicApi = game.toolbelt?.targetHelper;
    if (typeof publicApi?.setMessageFlagTargets === "function") {
      publicApi.setMessageFlagTargets(update, capture.targetTokenUuids);
    }
    document.updateSource(update);
    capture.preCreateMatches += 1;
  }
}

function claimDamageMessage(messageId, integrationId) {
  return damageClaims.claim(messageId, integrationId);
}

function matchingSourceTransactions(normalizedDamage) {
  const matches = [];
  for (const [integrationId, sourceMessageId] of activeSourceIds) {
    const sourceMessage = game.messages?.get(sourceMessageId);
    const draft = transaction(sourceMessage);
    if (!draft || isTerminalAutoDamageState(draft.state)) continue;
    if (autoDamageCandidateMatches(draft, normalizedDamage)) {
      matches.push({ integrationId, sourceMessage, draft });
    }
  }
  return matches;
}

async function persistExternal(sourceMessage, draft, damageMessageId) {
  const latest = transaction(sourceMessage);
  if (!latest || latest.integrationId !== draft.integrationId || isTerminalAutoDamageState(latest.state)) return;
  if (!claimDamageMessage(damageMessageId, draft.integrationId)) {
    latest.state = AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS;
    latest.failureReason = "damage-message-already-claimed";
    latest.guardSourceControl = false;
    await persist(sourceMessage, latest);
    return;
  }
  latest.state = AUTO_DAMAGE_ROLL_STATES.EXTERNAL;
  latest.damageMessageId = damageMessageId;
  latest.candidateMessageIds = [damageMessageId];
  latest.completedAt = Date.now();
  latest.guardSourceControl = true;
  latest.failureReason = null;
  await persist(sourceMessage, latest);
  activeSourceIds.delete(latest.integrationId);
  diagnostic("auto-damage-external-roll-detected", {
    integrationId: latest.integrationId,
    messageId: damageMessageId,
    sourceKind: latest.sourceKind,
    sourceItemType: latest.sourceItemType,
    rollIndex: latest.damageRollIndex,
    rollingUserId: latest.rollingUserId,
  });
}

async function persistAmbiguous(sourceMessage, draft, reason) {
  const latest = transaction(sourceMessage);
  if (!latest || latest.integrationId !== draft.integrationId || isTerminalAutoDamageState(latest.state)) return;
  latest.state = AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS;
  latest.failureReason = reason;
  latest.guardSourceControl = false;
  await persist(sourceMessage, latest);
  activeSourceIds.delete(latest.integrationId);
  diagnostic("auto-damage-correlation-ambiguous", {
    integrationId: latest.integrationId,
    messageId: latest.sourceMessageId,
    sourceKind: latest.sourceKind,
    sourceItemType: latest.sourceItemType,
    rollIndex: latest.damageRollIndex,
    rollingUserId: latest.rollingUserId,
    reason,
  });
}

function observeDamageMessage(message) {
  liveDamageIds.add(message.id);
  const marker = message.getFlag?.(MODULE_ID, ORIGIN_FLAG) ?? null;
  if (marker?.integrationId) {
    const capture = captures.get(marker.integrationId);
    if (capture && !capture.candidateMessageIds.includes(message.id)) {
      capture.candidateMessageIds.push(message.id);
    }
    return;
  }

  const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
  if (!normalized.ok) return;
  const matches = matchingSourceTransactions(normalized);
  if (!matches.length) return;
  if (matches.length > 1) {
    for (const match of matches) {
      void queue(match.sourceMessage.id, () =>
        persistAmbiguous(match.sourceMessage, match.draft, "external-correlation-ambiguous"),
      ).catch((error) => {
        logger.error("External autoroll ambiguity persistence failed", {
          stage: "auto-damage-external",
          reason: error instanceof Error ? error.message : String(error),
        }, error);
      });
    }
    return;
  }
  const [match] = matches;
  const capture = captures.get(match.integrationId);
  if (capture) {
    if (!capture.externalMessageIds.includes(message.id)) capture.externalMessageIds.push(message.id);
    return;
  }
  const ids = externalCandidates.get(match.integrationId) ?? new Set();
  ids.add(message.id);
  externalCandidates.set(match.integrationId, ids);
  void queue(match.sourceMessage.id, () => persistExternal(match.sourceMessage, match.draft, message.id)).catch(
    (error) => {
      logger.error("External autoroll correlation persistence failed", {
        stage: "auto-damage-external",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
    },
  );
}

function liveExternalMatches(draft) {
  const ids = new Set(externalCandidates.get(draft.integrationId) ?? []);
  for (const messageId of liveDamageIds) {
    if (damageClaims.owner(messageId)) continue;
    const message = game.messages?.get(messageId);
    if (message?.getFlag?.(MODULE_ID, ORIGIN_FLAG)) continue;
    const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
    if (autoDamageCandidateMatches(draft, normalized)) ids.add(messageId);
  }
  return [...ids];
}

function scheduleInvocation(sourceMessageId, integrationId) {
  if (scheduled.has(integrationId)) return;
  scheduled.add(integrationId);
  const operation = invocationQueue
    .catch(() => undefined)
    .then(() => queue(sourceMessageId, () => runInvocation(sourceMessageId, integrationId)))
    .catch(async (error) => {
      logger.error("Automatic damage invocation failed", {
        stage: "auto-damage-invocation",
        reason: error instanceof Error ? error.message : String(error),
      }, error);
      const message = game.messages?.get(sourceMessageId);
      if (message) {
        await queue(sourceMessageId, async () => {
          const draft = transaction(message);
          if (!draft || draft.integrationId !== integrationId || isTerminalAutoDamageState(draft.state)) return;
          draft.state = AUTO_DAMAGE_ROLL_STATES.ERROR;
          draft.failureReason = "autoroll-native-call-failed";
          draft.guardSourceControl = false;
          recordFailure(draft, {
            code: "autoroll-native-call-failed",
            subsystem: "autoroll",
            operation: "native-invocation",
            event: "application-failed",
            userRole: draft.rollingUserRole,
            context: { messageId: sourceMessageId, transactionId: integrationId, sourceKind: draft.sourceKind, rollIndex: draft.damageRollIndex },
          });
          await persist(message, draft);
          activeSourceIds.delete(integrationId);
        });
      }
    })
    .finally(() => scheduled.delete(integrationId));
  invocationQueue = operation;
}

async function runInvocation(sourceMessageId, integrationId) {
  const sourceMessage = game.messages?.get(sourceMessageId);
  let draft = transaction(sourceMessage);
  if (
    !sourceMessage ||
    !draft ||
    draft.integrationId !== integrationId ||
    !liveInvocationAllowed({
      live: liveSourceIds.has(sourceMessageId),
      state: draft.state,
      currentUserId: game.user?.id,
      rollingUserId: draft.rollingUserId,
    })
  ) return;

  const existing = liveExternalMatches(draft);
  if (existing.length === 1) return persistExternal(sourceMessage, draft, existing[0]);
  if (existing.length > 1) return persistAmbiguous(sourceMessage, draft, "external-correlation-ambiguous");

  const normalized = ToolbeltTargetHelperAdapter.normalizeSourceMessage(sourceMessage);
  if (
    !sourceIdentityMatches(draft, normalized) ||
    normalized.sourceFingerprint !== draft.sourceFingerprint ||
    normalized.targetFingerprint !== draft.targetFingerprint
  ) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
    draft.failureReason = "source-or-target-changed-after-claim";
    draft.guardSourceControl = false;
    await persist(sourceMessage, draft);
    return;
  }
  const author = game.users?.get(draft.rollingUserId);
  if (!author?.active || game.user.id !== author.id) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
    draft.failureReason = "rolling-user-unavailable";
    draft.guardSourceControl = false;
    await persist(sourceMessage, draft);
    return;
  }
  const inspection = await inspectNativeDamageAction({
    normalizedSource: normalized,
    user: game.user,
    defaultMessageMode: game.settings.get("core", "messageMode"),
    showDamageDialogs: game.user.settings?.showDamageDialogs,
  });
  draft = transaction(sourceMessage);
  if (
    !inspection.ok ||
    draft?.integrationId !== integrationId ||
    draft.state !== AUTO_DAMAGE_ROLL_STATES.CLAIMED ||
    draft.eligibilityFingerprint !== inspection.eligibilityFingerprint
  ) {
    if (draft?.integrationId === integrationId && !isTerminalAutoDamageState(draft.state)) {
      draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
      draft.failureReason = inspection.reason ?? "eligibility-changed-after-claim";
      draft.guardSourceControl = false;
      await persist(sourceMessage, draft);
    }
    return;
  }

  const revisionBeforeRolling = draft.revision;
  draft.state = AUTO_DAMAGE_ROLL_STATES.ROLLING;
  draft.guardSourceControl = true;
  await persist(sourceMessage, draft);
  const durable = transaction(game.messages?.get(sourceMessageId));
  if (
    !durable ||
    durable.integrationId !== integrationId ||
    durable.state !== AUTO_DAMAGE_ROLL_STATES.ROLLING ||
    durable.revision !== revisionBeforeRolling + 1 ||
    durable.rollingUserId !== game.user.id
  ) return;

  const capture = {
    integrationId,
    sourceMessageId,
    sourceActorUuid: draft.sourceActorUuid,
    sourceItemUuid: draft.sourceItemUuid,
    rollingUserId: draft.rollingUserId,
    damageRollIndex: draft.damageRollIndex,
    castRank: draft.castRank,
    overlayIds: [...(draft.overlayIds ?? [])],
    targetFingerprint: draft.targetFingerprint,
    targetTokenUuids: [...draft.targetTokenUuids],
    candidateMessageIds: [],
    externalMessageIds: [],
    preCreateMatches: 0,
  };
  captures.set(integrationId, capture);
  diagnostic("auto-damage-rolling", {
    integrationId,
    messageId: sourceMessageId,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    rollingUserId: draft.rollingUserId,
    rollingUserRole: draft.rollingUserRole,
  });

  const result = await invokeNativeDamageAction(normalized.item, inspection);
  captures.delete(integrationId);
  draft = transaction(sourceMessage);
  if (!draft || draft.integrationId !== integrationId || draft.state !== AUTO_DAMAGE_ROLL_STATES.ROLLING) return;

  const generatedIds = [...new Set(capture.candidateMessageIds)];
  const externalIds = [...new Set(capture.externalMessageIds)];
  const allIds = [...new Set([...generatedIds, ...externalIds])];
  draft.candidateMessageIds = allIds;
  if (!result.ok) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.ERROR;
    draft.failureReason = result.reason;
    draft.guardSourceControl = allIds.length > 0;
    draft.damageMessageId = allIds.length === 1 ? allIds[0] : null;
    await persist(sourceMessage, draft);
    activeSourceIds.delete(integrationId);
    diagnostic("auto-damage-error", {
      integrationId,
      messageId: sourceMessageId,
      sourceKind: draft.sourceKind,
      sourceItemType: draft.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: result.reason,
    });
    return;
  }
  if (externalIds.length || generatedIds.length !== 1 || capture.preCreateMatches !== 1) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS;
    draft.failureReason = "native-damage-correlation-ambiguous";
    // A native roll without a correlated message is terminal for automation,
    // but it is not proof that a duplicate card exists. Fail open in that
    // case; retain the guard only when PF2e actually created a candidate card.
    draft.guardSourceControl = allIds.length > 0;
    draft.damageMessageId = allIds.length === 1 ? allIds[0] : null;
    await persist(sourceMessage, draft);
    activeSourceIds.delete(integrationId);
    diagnostic("auto-damage-correlation-ambiguous", {
      integrationId,
      messageId: sourceMessageId,
      sourceKind: draft.sourceKind,
      sourceItemType: draft.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: draft.failureReason,
    });
    return;
  }

  const damageMessage = game.messages?.get(generatedIds[0]);
  const marker = damageMessage?.getFlag?.(MODULE_ID, ORIGIN_FLAG);
  const normalizedDamage = ToolbeltTargetHelperAdapter.normalizeDamageMessage(damageMessage);
  if (!autoDamageCandidateMatches(draft, normalizedDamage, marker) || !claimDamageMessage(damageMessage.id, integrationId)) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.ERROR;
    draft.failureReason = "generated-damage-message-invalid";
    draft.guardSourceControl = true;
    draft.damageMessageId = damageMessage?.id ?? null;
    await persist(sourceMessage, draft);
    activeSourceIds.delete(integrationId);
    diagnostic("auto-damage-error", {
      integrationId,
      messageId: damageMessage?.id ?? sourceMessageId,
      sourceKind: draft.sourceKind,
      sourceItemType: draft.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: draft.failureReason,
    });
    return;
  }
  draft.state = AUTO_DAMAGE_ROLL_STATES.COMPLETED;
  draft.damageMessageId = damageMessage.id;
  draft.completedAt = Date.now();
  draft.failureReason = null;
  draft.guardSourceControl = true;
  await persist(sourceMessage, draft);
  activeSourceIds.delete(integrationId);
  diagnostic("auto-damage-message-correlated", {
    integrationId,
    messageId: damageMessage.id,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    rollingUserId: draft.rollingUserId,
  });
  diagnostic("auto-damage-completed", {
    integrationId,
    messageId: sourceMessageId,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    rollingUserId: draft.rollingUserId,
  });
}

async function observeSourceMessage(message) {
  if (!workflowEnabled() || configuredMode() === AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF) return;
  const normalized = ToolbeltTargetHelperAdapter.normalizeSourceMessage(message);
  let draft = transaction(message);
  if (!normalized.ok) {
    if (draft && !isTerminalAutoDamageState(draft.state) && game.user?.id === draft.rollingUserId) {
      draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
      draft.failureReason = normalized.reason;
      draft.guardSourceControl = false;
      await persist(message, draft);
      activeSourceIds.delete(draft.integrationId);
    }
    return;
  }
  if (!sourceModeEnabled(normalized) || !currentUserIsRollingAuthor(normalized)) return;
  if (!liveSourceIds.has(message.id) && !draft) return;
  if (draft && isTerminalAutoDamageState(draft.state)) return;
  if (draft && [AUTO_DAMAGE_ROLL_STATES.CLAIMED, AUTO_DAMAGE_ROLL_STATES.ROLLING].includes(draft.state)) return;

  diagnostic("auto-damage-source-observed", {
    integrationId: draft?.integrationId,
    messageId: message.id,
    sourceKind: normalized.sourceKind,
    sourceItemType: normalized.sourceItemType,
    rollingUserId: normalized.sourceUserId,
    rollingUserRole: game.user.isGM ? "gm" : "player",
  });

  if (!normalized.targets.length) {
    draft ??= createTransaction(normalized, AUTO_DAMAGE_ROLL_STATES.AWAITING_TARGETS, "toolbelt-targets-missing");
    draft.state = AUTO_DAMAGE_ROLL_STATES.AWAITING_TARGETS;
    draft.sourceFingerprint = normalized.sourceFingerprint;
    draft.targetFingerprint = normalized.targetFingerprint;
    draft.targetTokenUuids = [];
    draft.failureReason = "toolbelt-targets-missing";
    await persist(message, draft);
    activeSourceIds.set(draft.integrationId, message.id);
    diagnostic("auto-damage-awaiting-targets", {
      integrationId: draft.integrationId,
      messageId: message.id,
      sourceKind: draft.sourceKind,
      sourceItemType: draft.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: draft.failureReason,
    });
    return;
  }

  const inspection = await inspectNativeDamageAction({
    normalizedSource: normalized,
    user: game.user,
    defaultMessageMode: game.settings.get("core", "messageMode"),
    showDamageDialogs: game.user.settings?.showDamageDialogs,
  });
  if (!inspection.ok) {
    draft ??= createTransaction(normalized, AUTO_DAMAGE_ROLL_STATES.MANUAL, inspection.reason);
    draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
    draft.failureReason = inspection.reason;
    draft.guardSourceControl = false;
    await persist(message, draft);
    activeSourceIds.delete(draft.integrationId);
    diagnostic("auto-damage-ineligible", {
      integrationId: draft.integrationId,
      messageId: message.id,
      sourceKind: normalized.sourceKind,
      sourceItemType: normalized.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: inspection.reason,
    });
    diagnostic("auto-damage-manual", {
      integrationId: draft.integrationId,
      messageId: message.id,
      sourceKind: normalized.sourceKind,
      sourceItemType: normalized.sourceItemType,
      rollIndex: draft.damageRollIndex,
      rollingUserId: draft.rollingUserId,
      reason: inspection.reason,
    });
    return;
  }

  draft ??= createTransaction(normalized, AUTO_DAMAGE_ROLL_STATES.OBSERVED);
  if (!sourceIdentityMatches(draft, normalized)) {
    draft.state = AUTO_DAMAGE_ROLL_STATES.MANUAL;
    draft.failureReason = "source-identity-changed";
    await persist(message, draft);
    return;
  }
  Object.assign(draft, {
    state: AUTO_DAMAGE_ROLL_STATES.ELIGIBLE,
    sourceFingerprint: normalized.sourceFingerprint,
    targetFingerprint: normalized.targetFingerprint,
    targetTokenUuids: normalized.targets.map((target) => target.tokenUuid),
    damageActionId: inspection.damageActionId,
    damageRollIndex: inspection.damageRollIndex,
    castRank: inspection.castRank,
    overlayIds: [...inspection.overlayIds],
    actionVariant: inspection.actionVariant,
    sourceAdapterVersion: inspection.adapterVersion,
    eligibilityFingerprint: inspection.eligibilityFingerprint,
    rollMode: inspection.rollMode,
    failureReason: null,
  });
  await persist(message, draft);
  diagnostic("auto-damage-eligible", {
    integrationId: draft.integrationId,
    messageId: message.id,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    rollingUserId: draft.rollingUserId,
    rollingUserRole: draft.rollingUserRole,
  });

  const external = liveExternalMatches(draft);
  if (external.length === 1) return persistExternal(message, draft, external[0]);
  if (external.length > 1) return persistAmbiguous(message, draft, "external-correlation-ambiguous");

  draft.state = AUTO_DAMAGE_ROLL_STATES.CLAIMED;
  draft.claimedAt = Date.now();
  draft.guardSourceControl = true;
  await persist(message, draft); // Durable source/target/authority claim precedes the native call.
  activeSourceIds.set(draft.integrationId, message.id);
  diagnostic("auto-damage-claimed", {
    integrationId: draft.integrationId,
    messageId: message.id,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    rollingUserId: draft.rollingUserId,
    rollingUserRole: draft.rollingUserRole,
  });
  scheduleInvocation(message.id, draft.integrationId);
}

async function interruptAfterReload(message, draft) {
  const latest = transaction(message);
  if (!latest || latest.integrationId !== draft.integrationId || isTerminalAutoDamageState(latest.state)) return;
  latest.state = AUTO_DAMAGE_ROLL_STATES.INTERRUPTED;
  latest.failureReason = "reload-interrupted-autoroll";
  latest.guardSourceControl = false;
  await persist(message, latest);
  diagnostic("auto-damage-interrupted", {
    integrationId: latest.integrationId,
    messageId: message.id,
    sourceKind: latest.sourceKind,
    sourceItemType: latest.sourceItemType,
    rollIndex: latest.damageRollIndex,
    rollingUserId: latest.rollingUserId,
    reason: latest.failureReason,
  });
}

export class AutoDamageRollService {
  static initialize() {
    if (initialized) return;
    initialized = true;
    Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
    for (const message of game.messages ?? []) {
      const draft = transaction(message);
      if (!draft) continue;
      if (draft.damageMessageId && isTerminalAutoDamageState(draft.state)) {
        damageClaims.restore(draft.damageMessageId, draft.integrationId);
      }
      if (
        !isTerminalAutoDamageState(draft.state) &&
        game.user?.id === draft.rollingUserId &&
        (message.isOwner || game.user?.isGM)
      ) {
        void queue(message.id, () => interruptAfterReload(message, draft)).catch((error) => {
          logger.error("Autoroll reload interruption failed", {
            stage: "auto-damage-reload",
            reason: error instanceof Error ? error.message : String(error),
          }, error);
        });
      }
    }
  }

  static handleCreatedMessage(message) {
    if (message?.isDamageRoll) observeDamageMessage(message);
    const rawType = ToolbeltTargetHelperAdapter.readRawData(message)?.type;
    if (["spell", "action"].includes(rawType)) liveSourceIds.add(message.id);
    return queue(message.id, () => observeSourceMessage(message));
  }

  static handleUpdatedMessage(message) {
    if (!liveSourceIds.has(message.id)) return Promise.resolve();
    return queue(message.id, () => observeSourceMessage(message));
  }

  static async setManualRoll(messageId, enabled) {
    const message = game.messages?.get(messageId);
    if (!message || !(message.isAuthor || game.user?.isGM)) return false;
    return queue(message.id, async () => {
      const draft = transaction(message);
      if (
        !draft ||
        ![AUTO_DAMAGE_ROLL_STATES.COMPLETED, AUTO_DAMAGE_ROLL_STATES.EXTERNAL].includes(draft.state)
      ) return false;
      draft.manualRollEnabled = enabled === true;
      draft.manualRollEnabledBy = enabled ? game.user.id : null;
      draft.manualRollEnabledAt = enabled ? Date.now() : null;
      await persist(message, draft);
      diagnostic(enabled ? "auto-damage-manual-roll-enabled" : "auto-damage-manual-roll-reguarded", {
        integrationId: draft.integrationId,
        messageId,
        sourceKind: draft.sourceKind,
        sourceItemType: draft.sourceItemType,
        rollIndex: draft.damageRollIndex,
        rollingUserId: draft.rollingUserId,
      });
      return true;
    });
  }

  static getTransaction(message) {
    return transaction(message);
  }

  static compatibleDamageMessages(sourceMessageId) {
    if (!game.user?.isGM) return [];
    const sourceMessage = game.messages?.get(sourceMessageId);
    const draft = transaction(sourceMessage);
    if (!draft) return [];
    const candidates = [];
    for (const message of game.messages ?? []) {
      if (!message?.isDamageRoll || message.id === draft.damageMessageId) continue;
      if (damageClaims.owner(message.id) && damageClaims.owner(message.id) !== draft.integrationId) continue;
      const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
      if (!autoDamageCandidateMatches(draft, normalized)) continue;
      candidates.push({
        messageId: message.id,
        messageIdShort: shortId(message.id),
        sourceKind: normalized.sourceKind,
        authorRole: game.users?.get(normalized.sourceUserId)?.isGM ? "gm" : "player",
        targetCount: normalized.targets?.length ?? 0,
        createdAt: message._stats?.createdTime ?? null,
      });
    }
    return candidates;
  }

  static linkExistingDamage(sourceMessageId, damageMessageId) {
    const sourceMessage = game.messages?.get(sourceMessageId);
    if (!sourceMessage || !game.user?.isGM) return Promise.resolve(false);
    return queue(sourceMessage.id, async () => {
      const draft = transaction(sourceMessage);
      const damageMessage = game.messages?.get(damageMessageId);
      const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(damageMessage);
      if (!draft || !damageMessage || !autoDamageCandidateMatches(draft, normalized)) return false;
      if (!claimDamageMessage(damageMessage.id, draft.integrationId)) return false;
      draft.state = AUTO_DAMAGE_ROLL_STATES.EXTERNAL;
      draft.damageMessageId = damageMessage.id;
      draft.candidateMessageIds = [damageMessage.id];
      draft.completedAt = Date.now();
      draft.guardSourceControl = true;
      draft.manualRollEnabled = false;
      draft.failureReason = null;
      updateRecovery(draft, { status: RECOVERY_STATUSES.COMPLETED, action: "use-existing-damage-message" });
      appendAudit(draft, { event: "recovery-complete", state: draft.state, subsystem: "recovery", userRole: "gm", safeReason: "use-existing-damage-message" });
      await persist(sourceMessage, draft);
      activeSourceIds.delete(draft.integrationId);
      diagnostic("transaction-existing-damage-linked", {
        integrationId: draft.integrationId,
        messageId: damageMessage.id,
        sourceKind: draft.sourceKind,
        sourceItemType: draft.sourceItemType,
        rollIndex: draft.damageRollIndex,
        rollingUserId: draft.rollingUserId,
      });
      return true;
    });
  }

  static recover(messageId, action) {
    const message = game.messages?.get(messageId);
    if (!message || !game.user?.isGM) return Promise.resolve(false);
    return queue(message.id, async () => {
      const draft = transaction(message);
      if (!draft) return false;
      if (action === "clear-guard") {
        draft.manualRollEnabled = true;
        draft.guardSourceControl = false;
        updateRecovery(draft, { status: RECOVERY_STATUSES.COMPLETED, action });
        appendAudit(draft, { event: "guard-restored", state: draft.state, subsystem: "guards", userRole: "gm", safeReason: action });
        diagnostic("control-restored-fail-open", { messageId, integrationId: draft.integrationId, reason: action });
      } else {
        const abandoned = action === "abandon";
        draft.state = abandoned ? AUTO_DAMAGE_ROLL_STATES.ABANDONED : AUTO_DAMAGE_ROLL_STATES.MANUAL;
        draft.failureReason = abandoned ? "transaction-abandoned" : "manual-review-required";
        draft.guardSourceControl = false;
        draft.manualRollEnabled = true;
        draft.activeOperation = null;
        updateRecovery(draft, {
          status: abandoned ? RECOVERY_STATUSES.ABANDONED : RECOVERY_STATUSES.MANUAL,
          action,
        });
        appendAudit(draft, { event: abandoned ? "abandoned" : "manual", state: draft.state, subsystem: "recovery", userRole: "gm", safeReason: action });
      }
      await persist(message, draft);
      activeSourceIds.delete(draft.integrationId);
      return true;
    });
  }

  static recordBoundaryFailure(messageId, failure) {
    const message = game.messages?.get(messageId);
    if (!message || !game.user?.isGM) return Promise.resolve(false);
    return queue(message.id, async () => {
      const draft = transaction(message);
      if (!draft) return false;
      recordFailure(draft, { ...failure, event: "application-failed", userRole: "gm" });
      if ([AUTO_DAMAGE_ROLL_STATES.CLAIMED, AUTO_DAMAGE_ROLL_STATES.ROLLING].includes(draft.state)) {
        draft.state = AUTO_DAMAGE_ROLL_STATES.INTERRUPTED;
        draft.failureReason = failure.code;
        draft.guardSourceControl = false;
      }
      await persist(message, draft);
      return true;
    });
  }
}

export {
  AUTO_DAMAGE_ROLL_STATES,
  FLAG as AUTO_DAMAGE_ROLL_FLAG,
  ORIGIN_FLAG as AUTO_DAMAGE_ROLL_ORIGIN_FLAG,
  isTerminalAutoDamageState,
};
