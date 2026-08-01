import { MODULE_ID } from "./constants.js";
import {
  AUTO_DAMAGE_ROLL_FLAG,
  AUTO_DAMAGE_ROLL_STATES,
  AutoDamageRollService,
} from "./auto-damage-roll-service.js";
import { logger } from "./logger.js";
import { shouldGuardSourceDamageControl } from "./auto-damage-roll-model.js";
import { getRuntimeSessionId } from "./runtime-session.js";
import { runNelflowBoundary } from "./nelflow-boundary.js";

const originals = new WeakMap();
const listenerRoots = new WeakSet();
const reportedGuardState = new Map();

function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function stateKey(state) {
  return {
    [AUTO_DAMAGE_ROLL_STATES.OBSERVED]: "Observed",
    [AUTO_DAMAGE_ROLL_STATES.AWAITING_TARGETS]: "AwaitingTargets",
    [AUTO_DAMAGE_ROLL_STATES.ELIGIBLE]: "Ready",
    [AUTO_DAMAGE_ROLL_STATES.CLAIMED]: "Rolling",
    [AUTO_DAMAGE_ROLL_STATES.ROLLING]: "Rolling",
    [AUTO_DAMAGE_ROLL_STATES.COMPLETED]: "Completed",
    [AUTO_DAMAGE_ROLL_STATES.EXTERNAL]: "External",
    [AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS]: "Unavailable",
    [AUTO_DAMAGE_ROLL_STATES.MANUAL]: "Manual",
    [AUTO_DAMAGE_ROLL_STATES.INTERRUPTED]: "Interrupted",
    [AUTO_DAMAGE_ROLL_STATES.ERROR]: "Unavailable",
    [AUTO_DAMAGE_ROLL_STATES.ABANDONED]: "Abandoned",
  }[state] ?? "Unavailable";
}

function shouldGuard(draft) {
  return shouldGuardSourceDamageControl(draft, getRuntimeSessionId());
}

function restore(control) {
  const original = originals.get(control);
  if (original) {
    if ("disabled" in control) control.disabled = original.disabled;
    if (original.disabledAttribute == null) control.removeAttribute("disabled");
    else control.setAttribute("disabled", original.disabledAttribute);
    if (original.ariaDisabled == null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", original.ariaDisabled);
    if (original.title == null) control.removeAttribute("title");
    else control.setAttribute("title", original.title);
    if (original.tooltip == null) control.removeAttribute("data-tooltip");
    else control.setAttribute("data-tooltip", original.tooltip);
    originals.delete(control);
  }
  control.classList.remove("nelflow-auto-damage-control-guarded");
  delete control.dataset.nelflowAutoDamageMessageId;
  delete control.dataset.nelflowAutoDamageActionId;
  delete control.dataset.nelflowAutoDamageRollIndex;
}

function restoreAll(html) {
  for (const control of html.querySelectorAll(".nelflow-auto-damage-control-guarded")) restore(control);
}

function exactGuard(control) {
  const root = control.closest?.("[data-message-id]");
  const messageId = control.dataset.nelflowAutoDamageMessageId;
  if (
    !root ||
    root.dataset.messageId !== messageId ||
    control.dataset.action !== control.dataset.nelflowAutoDamageActionId ||
    control.dataset.nelflowAutoDamageActionId !== "spell-damage"
  ) return null;
  const message = game.messages?.get(messageId);
  const draft = message?.getFlag?.(MODULE_ID, AUTO_DAMAGE_ROLL_FLAG);
  if (
    !draft ||
    draft.sourceMessageId !== messageId ||
    draft.damageActionId !== control.dataset.nelflowAutoDamageActionId ||
    String(draft.damageRollIndex) !== control.dataset.nelflowAutoDamageRollIndex ||
    !shouldGuard(draft)
  ) return null;
  return draft;
}

function intercept(event) {
  const control = event.target?.closest?.(".nelflow-auto-damage-control-guarded");
  if (!control) return;
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const draft = exactGuard(control);
  if (!draft) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  logger.debug("auto-damage-source-control-guarded", {
    integrationId: String(draft.integrationId).slice(-10),
    messageId: draft.sourceMessageId,
    sourceKind: draft.sourceKind,
    sourceItemType: draft.sourceItemType,
    rollIndex: draft.damageRollIndex,
    reason: "blocked-activation",
  });
}

function ensureListeners(html) {
  if (listenerRoots.has(html)) return;
  listenerRoots.add(html);
  html.addEventListener("click", intercept, true);
  html.addEventListener("keydown", intercept, true);
}

function guardSourceControl(message, html, draft) {
  restoreAll(html);
  ensureListeners(html);
  if (!shouldGuard(draft)) return false;
  const controls = Array.from(html.querySelectorAll('[data-action="spell-damage"]'));
  if (controls.length !== 1 || html.dataset.messageId !== message.id) return false;
  const [control] = controls;
  if (!originals.has(control)) {
    originals.set(control, {
      disabled: "disabled" in control ? control.disabled : false,
      disabledAttribute: control.getAttribute("disabled"),
      ariaDisabled: control.getAttribute("aria-disabled"),
      title: control.getAttribute("title"),
      tooltip: control.getAttribute("data-tooltip"),
    });
  }
  if ("disabled" in control) control.disabled = true;
  const tooltip = localize("Nelflow.AutoDamage.GuardedTooltip");
  control.setAttribute("aria-disabled", "true");
  control.setAttribute("title", tooltip);
  control.setAttribute("data-tooltip", tooltip);
  control.classList.add("nelflow-auto-damage-control-guarded");
  control.dataset.nelflowAutoDamageMessageId = message.id;
  control.dataset.nelflowAutoDamageActionId = draft.damageActionId;
  control.dataset.nelflowAutoDamageRollIndex = String(draft.damageRollIndex);
  return true;
}

function reportGuardTransition(message, draft, guarded) {
  const previous = reportedGuardState.get(message.id);
  reportedGuardState.set(message.id, guarded);
  if (previous === guarded || (previous === undefined && !guarded)) return;
  logger.debug(
    guarded ? "auto-damage-source-control-guarded" : "auto-damage-source-control-restored",
    {
      integrationId: String(draft.integrationId ?? "").slice(-10),
      messageId: message.id,
      sourceKind: draft.sourceKind,
      sourceItemType: draft.sourceItemType,
      rollIndex: draft.damageRollIndex,
      reason: guarded ? "presentation-guard-applied" : "presentation-guard-restored",
    },
  );
}

function canOverride(message, draft) {
  return Boolean(
    (message.isAuthor || game.user?.isGM) &&
      [AUTO_DAMAGE_ROLL_STATES.COMPLETED, AUTO_DAMAGE_ROLL_STATES.EXTERNAL].includes(draft.state),
  );
}

async function confirmManualRoll(message) {
  const content = element("div");
  content.append(element("p", null, localize("Nelflow.AutoDamage.Override.Body")));
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.AutoDamage.Override.Title") },
    content,
    modal: true,
    rejectClose: false,
  });
  if (!confirmed) return false;
  return AutoDamageRollService.setManualRoll(message.id, true);
}

function overrideButton(message, draft) {
  if (!canOverride(message, draft)) return null;
  const enabled = draft.manualRollEnabled === true;
  const button = element(
    "button",
    "nelflow-auto-damage__override",
    localize(enabled ? "Nelflow.AutoDamage.Reguard" : "Nelflow.AutoDamage.EnableManual"),
  );
  button.type = "button";
  button.addEventListener("click", () => {
    button.disabled = true;
    const operation = enabled
      ? AutoDamageRollService.setManualRoll(message.id, false)
      : confirmManualRoll(message);
    void runNelflowBoundary({
      subsystem: "autoroll-control",
      operation: enabled ? "reguard" : "enable-manual-roll",
      messageId: message.id,
      transactionType: "autoroll",
      task: () => operation,
      onFailure: (failure) => AutoDamageRollService.recordBoundaryFailure(message.id, failure),
    }).finally(() => {
      button.disabled = false;
    });
  });
  return button;
}

function damageMessageButton(draft) {
  const damageMessage = draft.damageMessageId ? game.messages?.get(draft.damageMessageId) : null;
  if (!damageMessage || damageMessage.visible === false || damageMessage.isContentVisible === false) return null;
  const button = element("button", "nelflow-auto-damage__record", localize("Nelflow.AutoDamage.DamageRecord"));
  button.type = "button";
  button.addEventListener("click", () => {
    const rendered = document.querySelector(`[data-message-id="${draft.damageMessageId}"]`);
    if (rendered) rendered.scrollIntoView({ behavior: "smooth", block: "center" });
    else ui.notifications.info("Nelflow.Notification.NativeMessageNotRendered", { localize: true });
  });
  return button;
}

export function renderAutoDamageRoll(message, html) {
  html.querySelectorAll(".nelflow-auto-damage").forEach((node) => node.remove());
  const draft = message.getFlag?.(MODULE_ID, AUTO_DAMAGE_ROLL_FLAG);
  if (!draft) {
    restoreAll(html);
    return false;
  }
  if (message.visible === false || message.isContentVisible === false) {
    restoreAll(html);
    return false;
  }
  const guarded = guardSourceControl(message, html, draft);
  reportGuardTransition(message, draft, guarded);
  const wrapper = element("section", `nelflow-auto-damage nelflow-auto-damage--${draft.state}`);
  wrapper.dataset.nelflowAutoDamageState = draft.state;
  const status = element(
    "strong",
    "nelflow-auto-damage__status",
    localize(`Nelflow.AutoDamage.State.${stateKey(draft.state)}`),
  );
  wrapper.append(status);
  if (guarded) wrapper.append(element("span", "nelflow-auto-damage__guard", localize("Nelflow.AutoDamage.Guarded")));
  if (draft.manualRollEnabled) {
    wrapper.append(element("span", "nelflow-auto-damage__manual", localize("Nelflow.AutoDamage.ManualEnabled")));
  }
  const controls = element("div", "nelflow-auto-damage__controls");
  const record = damageMessageButton(draft);
  if (record) controls.append(record);
  const override = overrideButton(message, draft);
  if (override) controls.append(override);
  if (controls.childElementCount) wrapper.append(controls);
  (html.querySelector(".message-content") ?? html).append(wrapper);
  return true;
}

/** Restore PF2e controls if any later presentation layer fails while rendering. */
export function failOpenAutoDamageRoll(html) {
  restoreAll(html);
  html.querySelectorAll(".nelflow-auto-damage").forEach((node) => node.remove());
}
