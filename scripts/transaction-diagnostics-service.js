import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";
import { getRuntimeSessionId, sessionOwns } from "./runtime-session.js";
import { getSetting } from "./settings.js";
import { AutoDamageRollService, AUTO_DAMAGE_ROLL_STATES } from "./auto-damage-roll-service.js";
import { SaveResolverService } from "./save-resolver-service.js";
import { ToolbeltBasicSaveService } from "./toolbelt-basic-save-service.js";
import { TOOLBELT_TARGET_STATES } from "./toolbelt-basic-save-model.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";
import { createFailureRecord, shortId } from "./transaction-failure.js";

export const DIAGNOSTIC_EXPORT_SCHEMA_VERSION = 1;
const healthNotified = new Set();

function roleFor(userId) {
  if (!userId) return "unknown";
  return game.users?.get(userId)?.isGM ? "gm" : "player";
}

function safeModuleVersion(id) {
  const module = game.modules?.get(id);
  return module?.active ? module.version ?? module.manifest?.version ?? "active" : null;
}

export async function copyDiagnosticWithFallback(json, { writeText, showFallback }) {
  try {
    if (typeof writeText !== "function") throw new Error("clipboard-unavailable");
    await writeText(json);
    return { copied: true, fallback: false };
  } catch {
    await showFallback(json);
    return { copied: false, fallback: true };
  }
}

export function healthNotificationRequired({ isGM, count, alreadyNotified }) {
  return isGM === true && Number(count) > 0 && alreadyNotified !== true;
}

export function recoveryRequiresConfirmation(action) {
  return ["abandon", "use-existing-damage"].includes(action);
}

function safeSetting(key) {
  try {
    return getSetting(key);
  } catch {
    return null;
  }
}

function autoDescriptor(message, transaction) {
  return {
    type: "autoroll",
    message,
    ownerMessage: message,
    transaction,
    id: transaction.integrationId,
  };
}

function toolbeltDescriptor(message, transaction) {
  return {
    type: "toolbelt-application",
    message,
    ownerMessage: message,
    transaction,
    id: transaction.integrationId,
  };
}

function resolverDescriptor(message, transaction) {
  return {
    type: "legacy-save-resolver",
    message,
    ownerMessage: message,
    transaction,
    id: transaction.resolverId,
  };
}

function strikeDescriptor(message) {
  const resolved = TransactionStore.resolveCanonical(message);
  if (!resolved?.transaction?.id) return null;
  return {
    type: "strike",
    message,
    ownerMessage: resolved.attackMessage,
    transaction: resolved.transaction,
    id: resolved.transaction.id,
  };
}

function descriptorFor(message) {
  const auto = AutoDamageRollService.getTransaction(message);
  if (auto) return autoDescriptor(message, auto);
  const toolbelt = ToolbeltBasicSaveService.getTransaction(message);
  if (toolbelt) return toolbeltDescriptor(message, toolbelt);
  const resolver = SaveResolverService.getResolver(message);
  if (resolver) return resolverDescriptor(message, resolver);
  return strikeDescriptor(message);
}

export function diagnosticDescriptors(message) {
  if (!game.user?.isGM || !message) return [];
  const stack = message.getFlag?.(MODULE_ID, "stack");
  if (stack?.rows) {
    const results = [];
    const seen = new Set();
    for (const row of stack.rows) {
      const attack = game.messages?.get(row.attackMessageId);
      const descriptor = attack ? strikeDescriptor(attack) : null;
      if (!descriptor || seen.has(descriptor.id)) continue;
      seen.add(descriptor.id);
      results.push(descriptor);
    }
    return results;
  }
  const direct = descriptorFor(message);
  return direct ? [direct] : [];
}

function targetCounts(descriptor) {
  const transaction = descriptor.transaction;
  if (descriptor.type === "toolbelt-application") {
    const records = Object.values(transaction.targets ?? {});
    const resolved = records.filter((record) => record.state !== TOOLBELT_TARGET_STATES.PENDING_SAVE).length;
    const completed = records.filter((record) => [
      TOOLBELT_TARGET_STATES.APPLIED, TOOLBELT_TARGET_STATES.NO_DAMAGE,
      TOOLBELT_TARGET_STATES.EXTERNAL, TOOLBELT_TARGET_STATES.UNDONE,
    ].includes(record.state)).length;
    return {
      targetCount: records.length,
      saveCount: records.length,
      resolvedSaveCount: resolved,
      applicationCount: records.length,
      completedApplicationCount: completed,
    };
  }
  if (descriptor.type === "legacy-save-resolver") {
    const targets = transaction.targets ?? [];
    return {
      targetCount: targets.length,
      saveCount: targets.length,
      resolvedSaveCount: targets.filter((target) => target.saveState === "complete").length,
      applicationCount: targets.length,
      completedApplicationCount: targets.filter((target) => ["applied", "no-damage", "undone"].includes(target.applicationState)).length,
    };
  }
  if (descriptor.type === "autoroll") {
    return {
      targetCount: transaction.targetTokenUuids?.length ?? 0,
      saveCount: 0,
      resolvedSaveCount: 0,
      applicationCount: 0,
      completedApplicationCount: 0,
    };
  }
  return {
    targetCount: transaction.snapshot?.targetTokenUuid ? 1 : 0,
    saveCount: 0,
    resolvedSaveCount: 0,
    applicationCount: transaction.preApplication ? 1 : 0,
    completedApplicationCount: [TRANSACTION_STATES.APPLIED, TRANSACTION_STATES.UNDONE].includes(transaction.state) ? 1 : 0,
  };
}

function guardState(descriptor) {
  const transaction = descriptor.transaction;
  if (descriptor.type === "autoroll") {
    return transaction.guardSourceControl && !transaction.manualRollEnabled ? "guarded" : "open";
  }
  if (descriptor.type === "toolbelt-application") {
    const records = Object.values(transaction.targets ?? {});
    return records.some((record) => !record.manualControlsEnabled && [
      TOOLBELT_TARGET_STATES.APPLIED, TOOLBELT_TARGET_STATES.NO_DAMAGE,
      TOOLBELT_TARGET_STATES.EXTERNAL, TOOLBELT_TARGET_STATES.RESULT_CHANGED,
      TOOLBELT_TARGET_STATES.UNDO_BLOCKED,
    ].includes(record.state)) ? "guarded" : "open";
  }
  return "none";
}

function inferredFailure(descriptor) {
  if (descriptor.transaction.failure?.code) return descriptor.transaction.failure;
  const state = descriptor.transaction.state ?? descriptor.transaction.phase ?? "unknown";
  if (!["failed", "error", "interrupted", "ambiguous", "partial"].includes(state)) return null;
  return createFailureRecord({
    reason: descriptor.transaction.failureReason ?? descriptor.transaction.errorStage ?? state,
    subsystem: descriptor.type,
    operation: "projection",
    state,
    recoverable: true,
    revision: descriptor.transaction.revision,
    context: { messageId: descriptor.ownerMessage.id, transactionId: descriptor.id },
  });
}

export function transactionDiagnosticProjection(descriptor) {
  const transaction = descriptor.transaction;
  const counts = targetCounts(descriptor);
  const sourceAuthorId = transaction.sourceUserId ?? transaction.authoringUserId ?? transaction.snapshot?.processingUserId;
  const processingId = transaction.processingUserId ?? transaction.rollingUserId ?? transaction.snapshot?.processingUserId;
  const damageMessageId = transaction.damageMessageId ?? transaction.damage?.messageId ?? null;
  const state = transaction.state ?? transaction.phase ?? "unknown";
  const failure = inferredFailure(descriptor);
  return {
    nelflowVersion: game.modules?.get(MODULE_ID)?.version ?? game.modules?.get(MODULE_ID)?.manifest?.version ?? "unknown",
    type: descriptor.type,
    state,
    revision: Number(transaction.revision ?? 0),
    sourceKind: transaction.sourceKind ?? (descriptor.type === "strike" ? "strike" : "spell"),
    sourceMessageIdShort: shortId(transaction.sourceMessageId ?? transaction.attackMessageId ?? descriptor.ownerMessage.id),
    damageMessageIdShort: shortId(damageMessageId),
    sourceAuthorRole: roleFor(sourceAuthorId),
    processingAuthorityRole: roleFor(processingId),
    ...counts,
    undoAvailable: descriptor.type === "strike"
      ? transaction.state === TRANSACTION_STATES.APPLIED && !transaction.undoBlocked
      : Object.values(transaction.targets ?? {}).some((target) => target.undoState === "available" || target.applicationState === "applied"),
    autorollState: descriptor.type === "autoroll" ? state : null,
    guardState: guardState(descriptor),
    failure: failure ? { code: failure.code, subsystem: failure.subsystem, operation: failure.operation, recoverable: failure.recoverable } : null,
    recovery: {
      status: transaction.recovery?.status ?? "none",
      lastAction: transaction.recovery?.lastAction ?? null,
      failureCode: transaction.recovery?.failureCode ?? null,
      revision: Number(transaction.recovery?.revision ?? 0),
    },
    audit: (transaction.audit ?? []).slice(-5).map((entry) => ({
      revision: Number(entry.revision ?? 0),
      event: entry.event,
      state: entry.state,
      subsystem: entry.subsystem,
      occurredAt: entry.occurredAt,
      userRole: entry.userRole,
      safeReason: entry.safeReason ?? null,
    })),
  };
}

export function buildSanitizedDiagnostic(descriptor) {
  const projection = transactionDiagnosticProjection(descriptor);
  let betterChatMessageActive = false;
  try {
    betterChatMessageActive = Boolean(game.settings.get("pf2e-toolbelt", "betterChat.enabled"));
  } catch {
    betterChatMessageActive = false;
  }
  const externalModules = [
    "xdy-pf2e-workbench", "dice-so-nice", "monks-combat-details",
    "pf2e-action-support", "dynamic-initiative", "pf2e-sustain-reminder", "autoanimations",
  ].map((id) => ({ id, version: safeModuleVersion(id) })).filter((entry) => entry.version);
  return {
    exportSchemaVersion: DIAGNOSTIC_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    environment: {
      foundryVersion: game.version ?? game.release?.version ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      nelflowVersion: projection.nelflowVersion,
      toolbeltVersion: safeModuleVersion("pf2e-toolbelt"),
      workbenchVersion: safeModuleVersion("xdy-pf2e-workbench"),
      betterChatMessageActive,
      diceSoNiceActive: Boolean(safeModuleVersion("dice-so-nice")),
      externalModules,
    },
    settings: {
      basicSaveWorkflow: safeSetting(SETTINGS.BASIC_SAVE_WORKFLOW),
      toolbeltBasicSaveSources: safeSetting(SETTINGS.TOOLBELT_BASIC_SAVE_SOURCES),
      automaticBasicSaveDamageRoll: safeSetting(SETTINGS.AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL),
      applicationTiming: safeSetting(SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION),
      compactTurnStacks: safeSetting(SETTINGS.COMPACT_TURN_STACKS),
      collapseLinkedNativeCards: safeSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS),
    },
    transaction: {
      type: projection.type,
      state: projection.state,
      revision: projection.revision,
      sourceKind: projection.sourceKind,
      sourceMessageIdShort: projection.sourceMessageIdShort,
      damageMessageIdShort: projection.damageMessageIdShort,
      sourceAuthorRole: projection.sourceAuthorRole,
      processingAuthorityRole: projection.processingAuthorityRole,
      targetCount: projection.targetCount,
      saveCount: projection.saveCount,
      resolvedSaveCount: projection.resolvedSaveCount,
      applicationCount: projection.applicationCount,
      completedApplicationCount: projection.completedApplicationCount,
      autorollState: projection.autorollState,
      guardState: projection.guardState,
      failure: projection.failure,
    },
    audit: projection.audit,
    recovery: projection.recovery,
    warnings: projection.failure ? [projection.failure.code] : [],
  };
}

function debug(event, descriptor, action = null, reason = null) {
  logger.debug(event, {
    transactionId: shortId(descriptor?.id),
    messageId: shortId(descriptor?.ownerMessage?.id),
    transactionType: descriptor?.type ?? null,
    subsystem: "recovery",
    state: descriptor?.transaction?.state ?? descriptor?.transaction?.phase ?? null,
    failureCode: descriptor?.transaction?.failure?.code ?? null,
    recoveryAction: action,
    revision: descriptor?.transaction?.revision ?? 0,
    safeRole: game.user?.isGM ? "gm" : "player",
    reason,
  });
}

export class TransactionDiagnosticsService {
  static async initialize() {
    getRuntimeSessionId();
    if (!game.user?.isGM) return 0;
    const operations = [];
    for (const message of game.messages ?? []) {
      const transaction = TransactionStore.get(message);
      if (
        transaction?.role === "attack" &&
        (transaction.state === TRANSACTION_STATES.PROCESSING || transaction.undoOperation?.state === "undoing") &&
        transaction.snapshot?.processingUserId === game.user.id &&
        (!sessionOwns(transaction.activeOperation) || transaction.undoOperation?.sessionId !== getRuntimeSessionId())
      ) {
        operations.push(TransactionStore.update(message, transaction.state === TRANSACTION_STATES.PROCESSING
          ? { state: TRANSACTION_STATES.INTERRUPTED, errorStage: "transaction-interrupted", activeOperation: null }
          : { undoOperation: { ...transaction.undoOperation, state: "failed", reason: "transaction-interrupted" }, manualApplicationRequired: true }));
      }
    }
    await Promise.allSettled(operations);
    if (operations.length) {
      logger.debug("transaction-interrupted", { count: operations.length, safeRole: "gm", reason: "previous-session-active-operation" });
      logger.debug("transaction-reconciled", { count: operations.length, safeRole: "gm", reason: "ready-reconciliation" });
    }
    const review = this.reviewCount();
    if (healthNotificationRequired({
      isGM: game.user?.isGM,
      count: review,
      alreadyNotified: healthNotified.has(getRuntimeSessionId()),
    })) {
      healthNotified.add(getRuntimeSessionId());
      ui.notifications.warn(game.i18n.format("Nelflow.Notification.InterruptedTransactions", { count: review }));
      logger.debug("transaction-health-summary", { count: review, safeRole: "gm" });
    }
    return review;
  }

  static reviewCount() {
    let count = 0;
    const seen = new Set();
    for (const message of game.messages ?? []) {
      for (const descriptor of diagnosticDescriptors(message)) {
        if (seen.has(descriptor.id)) continue;
        seen.add(descriptor.id);
        const state = descriptor.transaction.state ?? descriptor.transaction.phase;
        if (descriptor.transaction.failure || ["interrupted", "manual", "ambiguous", "error", "failed", "partial"].includes(state)) count += 1;
      }
    }
    return count;
  }

  static candidates(descriptor) {
    if (!game.user?.isGM || descriptor.type !== "autoroll") return [];
    return AutoDamageRollService.compatibleDamageMessages(descriptor.ownerMessage.id);
  }

  static async recover(descriptor, action, options = {}) {
    if (!game.user?.isGM || !descriptor?.ownerMessage) return { ok: false, result: "unauthorized" };
    debug("transaction-recovery-started", descriptor, action);
    let result = false;
    if (action === "rescan-toolbelt" && descriptor.type === "toolbelt-application") {
      const scan = await ToolbeltBasicSaveService.rescan(descriptor.ownerMessage.id);
      if (scan.ok && scan.result === "ready-for-application") {
        // Resume only through the existing service, which rechecks authority,
        // configured timing, target states, and duplicate-application guards.
        await ToolbeltBasicSaveService.handleMessage(descriptor.ownerMessage);
      }
      debug(scan.ok ? "transaction-recovery-completed" : "transaction-recovery-failed", descriptor, action, scan.result);
      return scan;
    }
    if (action === "use-existing-damage" && descriptor.type === "autoroll") {
      result = await AutoDamageRollService.linkExistingDamage(descriptor.ownerMessage.id, options.damageMessageId);
    } else if (descriptor.type === "autoroll") {
      result = await AutoDamageRollService.recover(descriptor.ownerMessage.id, action);
    } else if (descriptor.type === "toolbelt-application") {
      result = await ToolbeltBasicSaveService.recover(descriptor.ownerMessage.id, action);
    } else if (descriptor.type === "legacy-save-resolver" && action !== "clear-guard") {
      result = await SaveResolverService.recover(descriptor.ownerMessage.id, action);
    } else if (descriptor.type === "strike" && action !== "clear-guard") {
      const updated = await TransactionStore.recover(descriptor.ownerMessage, action);
      result = Boolean(updated);
      if (updated) await TurnStackService.syncTransaction(descriptor.ownerMessage, updated);
    }
    debug(result ? "transaction-recovery-completed" : "transaction-recovery-failed", descriptor, action);
    if (result) {
      const event = {
        "mark-manual": "transaction-marked-manual",
        abandon: "transaction-abandoned",
        "clear-guard": "transaction-guard-cleared",
      }[action];
      if (event) debug(event, descriptor, action);
    }
    return { ok: Boolean(result), result: result ? "completed" : "unsupported" };
  }
}
