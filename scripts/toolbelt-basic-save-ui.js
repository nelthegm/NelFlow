import {
  BASIC_SAVE_WORKFLOW_MODES,
  MODULE_ID,
  SETTINGS,
  TOOLBELT_APPLICATION_MODES,
} from "./constants.js";
import { getSetting } from "./settings.js";
import { allPrimarySavesResolved, TOOLBELT_TARGET_STATES } from "./toolbelt-basic-save-model.js";
import { ToolbeltBasicSaveService, TOOLBELT_BASIC_SAVE_FLAG } from "./toolbelt-basic-save-service.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";

function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function element(tag, classes, text) {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (text != null) node.textContent = text;
  return node;
}

function maySeeHp(record) {
  if (game.user?.isGM) return true;
  const token = fromUuidSync(record.tokenUuid, { strict: false });
  return Boolean(token?.actor?.isOwner || token?.hasPlayerOwner);
}

function stateLabel(record) {
  const key = `Nelflow.Toolbelt.State.${record.state}`;
  if (record.state === TOOLBELT_TARGET_STATES.APPLIED && Number.isFinite(record.actualHpDelta) && maySeeHp(record)) {
    return localize("Nelflow.Toolbelt.State.appliedAmount", { amount: record.actualHpDelta });
  }
  return localize(key);
}

function canSeeTarget(target, record) {
  if (game.user?.isGM) return true;
  const token = fromUuidSync(record.tokenUuid, { strict: false });
  if (!token || token.hidden || token.actor?.hasCondition?.("unnoticed", "undetected")) return false;
  return !target.private || token.actor?.isOwner || token.hasPlayerOwner;
}

function targetName(record, number) {
  const token = fromUuidSync(record.tokenUuid, { strict: false });
  if (!token) return localize("Nelflow.Toolbelt.TargetNumber", { number });
  if (game.user?.isGM || token.actor?.isOwner || !game.pf2e?.settings?.tokens?.nameVisibility || token.playersCanSeeName) {
    return token.name;
  }
  return localize("Nelflow.Toolbelt.TargetNumber", { number });
}

function nativeRecordButton(record) {
  const message = record.applicationMessageId ? game.messages?.get(record.applicationMessageId) : null;
  if (!message || message.visible === false || message.isContentVisible === false) return null;
  const button = element("button", "nelflow-toolbelt__record", localize("Nelflow.Toolbelt.ApplicationRecord"));
  button.type = "button";
  button.addEventListener("click", () => {
    const target = document.querySelector(`[data-message-id="${record.applicationMessageId}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    else ui.notifications.info("Nelflow.Notification.NativeMessageNotRendered", { localize: true });
  });
  return button;
}

function statusRow(message, normalizedTarget, record, number) {
  const row = element("div", `nelflow-toolbelt__target nelflow-toolbelt__target--${record.state}`);
  row.dataset.nelflowToolbeltTargetKey = record.toolbeltTargetKey;
  const body = element("div", "nelflow-toolbelt__target-body");
  body.append(element("strong", null, targetName(record, number)));
  body.append(element("span", "nelflow-toolbelt__status", stateLabel(record)));
  row.append(body);

  const controls = element("div", "nelflow-toolbelt__controls");
  if (
    game.user?.isGM &&
    (record.state === TOOLBELT_TARGET_STATES.APPLIED ||
      (record.state === TOOLBELT_TARGET_STATES.RESULT_CHANGED && Number.isFinite(record.preApplicationHp))) &&
    record.undoState === "available" &&
    getSetting(SETTINGS.ENABLE_UNDO)
  ) {
    const undo = element("button", null, localize("Nelflow.Toolbelt.Undo"));
    undo.type = "button";
    undo.setAttribute("aria-label", localize("Nelflow.Toolbelt.UndoAria", { target: targetName(record, number) }));
    undo.addEventListener("click", () => void ToolbeltBasicSaveService.undo(message.id, record.toolbeltTargetKey));
    controls.append(undo);
  }
  const native = nativeRecordButton(record);
  if (native) controls.append(native);
  if (controls.childElementCount) row.append(controls);
  return row;
}

export function renderToolbeltBasicSave(message, html) {
  html.querySelectorAll(".nelflow-toolbelt").forEach((node) => node.remove());
  const draft = message.getFlag?.(MODULE_ID, TOOLBELT_BASIC_SAVE_FLAG);
  if (!draft) return false;
  const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
  if (!normalized.ok && normalized.reason !== "toolbelt-version-unsupported") return false;

  const wrapper = element("section", "nelflow-toolbelt");
  wrapper.dataset.nelflowToolbeltIntegrationId = draft.integrationId;
  const header = element("header", "nelflow-toolbelt__header");
  header.append(element("strong", null, localize("Nelflow.Toolbelt.Header", {
    save: localize(`Nelflow.SaveResolver.Save.${draft.saveType}`),
  })));
  wrapper.append(header);

  const list = element("div", "nelflow-toolbelt__targets");
  let visibleCount = 0;
  for (const [index, key] of draft.targetOrder.entries()) {
    const record = draft.targets[key];
    const target = normalized.ok
      ? normalized.targets.find((entry) => entry.toolbeltTargetKey === key)
      : { private: true };
    if (!record || !canSeeTarget(target, record)) continue;
    visibleCount += 1;
    list.append(statusRow(message, target, record, index + 1));
  }
  if (visibleCount) wrapper.append(list);

  const mode = getSetting(SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION);
  if (
    game.user?.isGM &&
    game.user.id === draft.processingUserId &&
    mode === TOOLBELT_APPLICATION_MODES.GM_CONFIRM &&
    normalized.ok
  ) {
    const footer = element("footer", "nelflow-toolbelt__footer");
    const resolved = normalized.targets.filter((target) => target.saveState === "resolved").length;
    footer.append(element("span", null, localize("Nelflow.Toolbelt.Progress", {
      complete: resolved,
      total: normalized.targets.length,
    })));
    const apply = element("button", null, localize("Nelflow.Toolbelt.Apply"));
    apply.type = "button";
    apply.disabled = !allPrimarySavesResolved(normalized.targets) || draft.phase === "applying" || draft.phase === "complete";
    apply.addEventListener("click", () => {
      apply.disabled = true;
      void ToolbeltBasicSaveService.confirm(message.id);
    });
    footer.append(apply);
    wrapper.append(footer);
  }

  const content = html.querySelector(".message-content");
  content?.append(wrapper);
  return true;
}

export function toolbeltModeActive() {
  return getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT;
}
