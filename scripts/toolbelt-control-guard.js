import { MODULE_ID, SETTINGS, TOOLBELT_TRANSACTION_SCHEMA_VERSION } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { applicationId, TOOLBELT_TARGET_STATES } from "./toolbelt-basic-save-model.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";

const GUARDED_MULTIPLIERS = new Set([0.5, 1, 2, 3]);
const originalPresentation = new WeakMap();
const listenerRoots = new WeakSet();
const reported = new Set();

function shortId(value) {
  const text = String(value ?? "");
  return text.length > 8 ? text.slice(-8) : text;
}

function reportOnce(event, data) {
  if (!game.user?.isGM) return;
  const key = `${event}:${data.messageId}:${data.targetKey}:${data.rollIndex}:${data.action}:${data.reason}`;
  if (reported.has(key)) return;
  reported.add(key);
  logger.debug(event, {
    integrationId: shortId(data.integrationId),
    applicationId: shortId(data.applicationId),
    messageId: shortId(data.messageId),
    targetKey: shortId(data.targetKey),
    rollIndex: data.rollIndex,
    action: data.action ?? null,
    reason: data.reason ?? null,
  });
}

function viewerCanSeeTarget(target, record) {
  if (game.user?.isGM) return true;
  const token = fromUuidSync(record.tokenUuid, { strict: false });
  if (!token || token.hidden || token.actor?.hasCondition?.("unnoticed", "undetected")) return false;
  return !target.private || token.actor?.isOwner || token.hasPlayerOwner;
}

export function isDamageApplicationControl(action, multiplier) {
  return action === "target-applyDamage" && GUARDED_MULTIPLIERS.has(Number(multiplier));
}

export function recordProvesPriorApplication(record) {
  return Boolean(
    Number.isFinite(record?.preApplicationHp) &&
      Number.isFinite(record?.postApplicationHp) &&
      record?.applicationId,
  );
}

export function isConclusiveGuardRecord(record, { toolbeltApplied = false } = {}) {
  if (!record) return false;
  if ([TOOLBELT_TARGET_STATES.APPLIED, TOOLBELT_TARGET_STATES.NO_DAMAGE].includes(record.state)) {
    return true;
  }
  if (record.state === TOOLBELT_TARGET_STATES.EXTERNAL) return toolbeltApplied === true;
  if (record.state === TOOLBELT_TARGET_STATES.RESULT_CHANGED) return true;
  if (record.state === TOOLBELT_TARGET_STATES.UNDO_BLOCKED) return recordProvesPriorApplication(record);
  if (record.state === TOOLBELT_TARGET_STATES.INTERRUPTED) return recordProvesPriorApplication(record);
  return (
    record.state === TOOLBELT_TARGET_STATES.MANUAL &&
    record.reason === "manual-review-required" &&
    recordProvesPriorApplication(record)
  );
}

export function shouldGuardDamageControls(record, context = {}) {
  return record?.manualControlsEnabled !== true && isConclusiveGuardRecord(record, context);
}

export function guardIdentityMatches(actual, expected) {
  return Boolean(
    actual &&
      expected &&
      actual.messageId === expected.messageId &&
      actual.targetKey === expected.targetKey &&
      actual.tokenUuid === expected.tokenUuid &&
      actual.actorUuid === expected.actorUuid &&
      Number(actual.rollIndex) === Number(expected.rollIndex) &&
      actual.applicationId === expected.applicationId,
  );
}

function restoreControl(control) {
  const original = originalPresentation.get(control);
  if (original) {
    if ("disabled" in control) control.disabled = original.disabled;
    if (original.disabledAttribute === null) control.removeAttribute("disabled");
    else control.setAttribute("disabled", original.disabledAttribute);
    if (original.ariaDisabled === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", original.ariaDisabled);
    if (original.title === null) control.removeAttribute("title");
    else control.setAttribute("title", original.title);
    if (original.tooltip === null) control.removeAttribute("data-tooltip");
    else control.setAttribute("data-tooltip", original.tooltip);
    originalPresentation.delete(control);
  }
  control.classList.remove("nelflow-toolbelt-control-guarded");
  delete control.dataset.nelflowGuardMessageId;
  delete control.dataset.nelflowGuardTargetKey;
  delete control.dataset.nelflowGuardTokenUuid;
  delete control.dataset.nelflowGuardRollIndex;
  delete control.dataset.nelflowGuardApplicationId;
}

function restoreAll(html) {
  const restored = [];
  for (const control of html.querySelectorAll(".nelflow-toolbelt-control-guarded")) {
    restored.push({
      messageId: control.dataset.nelflowGuardMessageId,
      targetKey: control.dataset.nelflowGuardTargetKey,
      rollIndex: Number(control.dataset.nelflowGuardRollIndex),
      applicationId: control.dataset.nelflowGuardApplicationId,
      action: control.dataset.action,
    });
    restoreControl(control);
  }
  return restored;
}

function guardControl(control, identity, tooltip) {
  if (!originalPresentation.has(control)) {
    originalPresentation.set(control, {
      disabled: "disabled" in control ? control.disabled : false,
      disabledAttribute: control.getAttribute("disabled"),
      ariaDisabled: control.getAttribute("aria-disabled"),
      title: control.getAttribute("title"),
      tooltip: control.getAttribute("data-tooltip"),
    });
  }
  if ("disabled" in control) control.disabled = true;
  control.setAttribute("aria-disabled", "true");
  control.setAttribute("title", tooltip);
  control.setAttribute("data-tooltip", tooltip);
  control.classList.add("nelflow-toolbelt-control-guarded");
  control.dataset.nelflowGuardMessageId = identity.messageId;
  control.dataset.nelflowGuardTargetKey = identity.targetKey;
  control.dataset.nelflowGuardTokenUuid = identity.tokenUuid;
  control.dataset.nelflowGuardRollIndex = String(identity.rollIndex);
  control.dataset.nelflowGuardApplicationId = identity.applicationId;
}

function exactGuardIdentity(control) {
  const root = control.closest?.("[data-message-id]");
  const container = control.closest?.("[data-target-uuid][data-target-roll-index]");
  const messageId = root?.dataset.messageId;
  if (
    !root ||
    !container ||
    messageId !== control.dataset.nelflowGuardMessageId ||
    container.dataset.targetUuid !== control.dataset.nelflowGuardTokenUuid ||
    container.dataset.targetRollIndex !== control.dataset.nelflowGuardRollIndex ||
    !isDamageApplicationControl(control.dataset.action, control.dataset.multiplier)
  ) return null;
  const message = game.messages?.get(messageId);
  const draft = message?.getFlag?.(MODULE_ID, "toolbeltBasicSave");
  const record = draft?.targets?.[control.dataset.nelflowGuardTargetKey];
  if (
    !draft ||
    draft.schemaVersion !== TOOLBELT_TRANSACTION_SCHEMA_VERSION ||
    ["manual", "abandoned", "interrupted"].includes(draft.phase) ||
    message.visible === false ||
    message.isContentVisible === false ||
    draft.damageMessageId !== messageId ||
    draft.rollIndex !== Number(control.dataset.nelflowGuardRollIndex) ||
    (record?.rollIndex != null && record.rollIndex !== draft.rollIndex) ||
    record?.tokenUuid !== control.dataset.nelflowGuardTokenUuid ||
    record?.applicationId !== control.dataset.nelflowGuardApplicationId
  ) return null;
  const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
  const target = normalized.ok
    ? normalized.targets.find((entry) => entry.toolbeltTargetKey === record.toolbeltTargetKey)
    : null;
  if (
    !target ||
    !viewerCanSeeTarget(target, record) ||
    !guardIdentityMatches(
      {
        messageId,
        targetKey: record.toolbeltTargetKey,
        tokenUuid: target.tokenUuid,
        actorUuid: target.actorUuid,
        rollIndex: draft.rollIndex,
        applicationId: record.applicationId,
      },
      {
        messageId: draft.damageMessageId,
        targetKey: control.dataset.nelflowGuardTargetKey,
        tokenUuid: record.tokenUuid,
        actorUuid: record.actorUuid,
        rollIndex: control.dataset.nelflowGuardRollIndex,
        applicationId: control.dataset.nelflowGuardApplicationId,
      },
    ) ||
    !shouldGuardDamageControls(record, { toolbeltApplied: target.toolbeltAppliedState })
  ) return null;
  return { draft, record };
}

function interceptActivation(event) {
  if (!getSetting(SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS)) return;
  const control = event.target?.closest?.(".nelflow-toolbelt-control-guarded");
  if (!control) return;
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const identity = exactGuardIdentity(control);
  if (!identity) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  reportOnce("toolbelt-guard-blocked-activation", {
    integrationId: identity.draft.integrationId,
    applicationId: identity.record.applicationId,
    messageId: identity.draft.damageMessageId,
    targetKey: identity.record.toolbeltTargetKey,
    rollIndex: identity.draft.rollIndex,
    action: control.dataset.action,
    reason: "conclusive-guard",
  });
}

function ensureInterceptors(html) {
  if (listenerRoots.has(html)) return;
  listenerRoots.add(html);
  html.addEventListener("click", interceptActivation, true);
  html.addEventListener("keydown", interceptActivation, true);
}

function localizedTooltip(record) {
  return game.i18n.localize(
    record.state === TOOLBELT_TARGET_STATES.NO_DAMAGE
      ? "Nelflow.Toolbelt.Guard.NoDamageTooltip"
      : "Nelflow.Toolbelt.Guard.AppliedTooltip",
  );
}

export class ToolbeltControlGuard {
  static render(message, html, draft, normalized) {
    const restored = restoreAll(html);
    for (const identity of restored) {
      reportOnce("toolbelt-control-guard-restored", {
        integrationId: draft.integrationId,
        ...identity,
        reason: "render-reconciliation",
      });
    }
    ensureInterceptors(html);
    const guarded = new Set();
    if (!getSetting(SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS)) return guarded;
    if (draft.schemaVersion !== TOOLBELT_TRANSACTION_SCHEMA_VERSION || ["manual", "abandoned", "interrupted"].includes(draft.phase)) {
      return guarded;
    }
    if (html.dataset.messageId !== message.id || draft.damageMessageId !== message.id || !normalized.ok) {
      reportOnce("toolbelt-control-guard-skipped", {
        integrationId: draft.integrationId,
        messageId: message.id,
        targetKey: null,
        rollIndex: draft.rollIndex,
        action: null,
        reason: "message-or-schema-identity-missing",
      });
      return guarded;
    }

    for (const key of draft.targetOrder) {
      const record = draft.targets[key];
      const target = normalized.targets.find((entry) => entry.toolbeltTargetKey === key);
      const expectedApplicationId = applicationId(draft.integrationId, key);
      if (
        !record ||
        !target ||
        !viewerCanSeeTarget(target, record) ||
        record.applicationId !== expectedApplicationId ||
        (record.rollIndex != null && record.rollIndex !== draft.rollIndex) ||
        record.tokenUuid !== target.tokenUuid ||
        record.actorUuid !== target.actorUuid ||
        !shouldGuardDamageControls(record, { toolbeltApplied: target.toolbeltAppliedState })
      ) continue;

      const containers = Array.from(
        html.querySelectorAll(".damage-application[data-target-uuid][data-target-roll-index]"),
      ).filter(
        (container) =>
          container.dataset.targetUuid === record.tokenUuid &&
          container.dataset.targetRollIndex === String(draft.rollIndex),
      );
      if (containers.length !== 1) {
        reportOnce("toolbelt-guard-identity-missing", {
          integrationId: draft.integrationId,
          applicationId: record.applicationId,
          messageId: message.id,
          targetKey: key,
          rollIndex: draft.rollIndex,
          action: null,
          reason: containers.length ? "ambiguous-target-container" : "target-container-missing",
        });
        continue;
      }

      const controls = Array.from(containers[0].querySelectorAll('[data-action="target-applyDamage"]'));
      const recognized = controls.filter((control) =>
        isDamageApplicationControl(control.dataset.action, control.dataset.multiplier),
      );
      const recognizedMultipliers = new Set(recognized.map((control) => Number(control.dataset.multiplier)));
      if (
        controls.length !== GUARDED_MULTIPLIERS.size ||
        recognized.length !== controls.length ||
        recognizedMultipliers.size !== GUARDED_MULTIPLIERS.size ||
        ![...GUARDED_MULTIPLIERS].every((multiplier) => recognizedMultipliers.has(multiplier))
      ) {
        reportOnce("toolbelt-guard-control-unrecognized", {
          integrationId: draft.integrationId,
          applicationId: record.applicationId,
          messageId: message.id,
          targetKey: key,
          rollIndex: draft.rollIndex,
          action: null,
          reason: "damage-controls-missing",
        });
        continue;
      }
      const identity = {
        messageId: message.id,
        targetKey: key,
        tokenUuid: record.tokenUuid,
        rollIndex: draft.rollIndex,
        applicationId: record.applicationId,
      };
      for (const control of recognized) guardControl(control, identity, localizedTooltip(record));
      guarded.add(key);
      reportOnce("toolbelt-control-guard-applied", {
        integrationId: draft.integrationId,
        applicationId: record.applicationId,
        messageId: message.id,
        targetKey: key,
        rollIndex: draft.rollIndex,
        action: "target-applyDamage",
        reason: record.state,
      });
    }
    return guarded;
  }
}
