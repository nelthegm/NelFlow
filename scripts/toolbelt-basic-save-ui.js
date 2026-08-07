import {
  BASIC_SAVE_WORKFLOW_MODES,
  MODULE_ID,
  SETTINGS,
  TOOLBELT_APPLICATION_MODES,
} from "./constants.js";
import { getSetting } from "./settings.js";
import { allPrimarySavesResolved, TOOLBELT_TARGET_STATES } from "./toolbelt-basic-save-model.js";
import { ToolbeltBasicSaveService, TOOLBELT_BASIC_SAVE_FLAG } from "./toolbelt-basic-save-service.js";
import { isConclusiveGuardRecord, ToolbeltControlGuard } from "./toolbelt-control-guard.js";
import { ToolbeltTargetHelperAdapter } from "./toolbelt-target-helper-adapter.js";
import { logger } from "./logger.js";
import { runNelflowBoundary } from "./nelflow-boundary.js";

function runToolbeltControl(message, operation, name) {
  return runNelflowBoundary({
    subsystem: "toolbelt-control",
    operation: name,
    messageId: message.id,
    transactionType: "toolbelt-application",
    task: operation,
    onFailure: (failure) => ToolbeltBasicSaveService.recordBoundaryFailure(message.id, failure),
  });
}

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
  if (record.state === TOOLBELT_TARGET_STATES.AWAITING_IMPACT) {
    return localize("Nelflow.Status.AwaitingImpact");
  }
  const key = `Nelflow.Toolbelt.State.${record.state}`;
  if (record.state === TOOLBELT_TARGET_STATES.APPLIED && Number.isFinite(record.actualHpDelta) && maySeeHp(record)) {
    return localize("Nelflow.Toolbelt.State.appliedAmount", { amount: record.actualHpDelta });
  }
  return localize(key);
}

function resultLabel(record) {
  if (!record.nativeOutcome) return null;
  const outcome = localize(`Nelflow.Outcome.${{
    criticalSuccess: "CriticalSuccess",
    success: "Success",
    failure: "Failure",
    criticalFailure: "CriticalFailure",
  }[record.nativeOutcome]}`);
  const multiplierKey = {
    0: "Nelflow.SaveResolver.NoDamage",
    0.5: "Nelflow.SaveResolver.Half",
    1: "Nelflow.SaveResolver.Full",
    2: "Nelflow.SaveResolver.Double",
  }[record.multiplier];
  return multiplierKey
    ? localize("Nelflow.Toolbelt.Result", { outcome, multiplier: localize(multiplierKey) })
    : outcome;
}

function sourceHeader(message, draft) {
  const save = localize(`Nelflow.SaveResolver.Save.${draft.saveType}`);
  if (draft.sourceKind !== "npc-ability") return localize("Nelflow.Toolbelt.Header", { save });
  const item = fromUuidSync(draft.sourceItemUuid, { strict: false });
  const actor = fromUuidSync(draft.sourceActorUuid, { strict: false });
  const canSeeName = Boolean(
    game.user?.isGM ||
      item?.isOwner ||
      actor?.isOwner ||
      actor?.hasPlayerOwner,
  );
  const source = canSeeName && item?.name
    ? item.name
    : localize("Nelflow.Toolbelt.BasicSaveAbility");
  return localize("Nelflow.Toolbelt.AbilityHeader", { source, save });
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

async function confirmManualDamage(message, record) {
  const content = element("div");
  content.append(element("p", null, localize("Nelflow.Toolbelt.Guard.ConfirmBody")));
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.Toolbelt.Guard.ConfirmTitle") },
    content,
    modal: true,
    rejectClose: false,
  });
  if (!confirmed) return false;
  return ToolbeltBasicSaveService.setManualControls(message.id, record.toolbeltTargetKey, true);
}

function manualControlButton(message, draft, normalizedTarget, record) {
  if (
    !game.user?.isGM ||
    !getSetting(SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS) ||
    game.user.id !== draft.processingUserId ||
    normalizedTarget?.toolbeltTargetKey !== record.toolbeltTargetKey ||
    normalizedTarget?.tokenUuid !== record.tokenUuid ||
    normalizedTarget?.actorUuid !== record.actorUuid ||
    !isConclusiveGuardRecord(record, { toolbeltApplied: normalizedTarget?.toolbeltAppliedState })
  ) return null;
  const enabled = record.manualControlsEnabled === true;
  const button = element(
    "button",
    "nelflow-toolbelt__manual-control",
    localize(enabled ? "Nelflow.Toolbelt.Guard.Reguard" : "Nelflow.Toolbelt.Guard.EnableManual"),
  );
  button.type = "button";
  button.addEventListener("click", () => {
    button.disabled = true;
    const action = enabled
      ? ToolbeltBasicSaveService.setManualControls(message.id, record.toolbeltTargetKey, false)
      : confirmManualDamage(message, record);
    void action
      .then(() => {
        button.disabled = false;
      })
      .catch((error) => {
        button.disabled = false;
        logger.warn("toolbelt-manual-controls-update-failed", {
          stage: "toolbelt-control-guard",
          reason: "manual-override-update-failed",
        }, error);
      });
  });
  return button;
}

function statusRow(message, draft, normalizedTarget, record, number) {
  const row = element("div", `nelflow-toolbelt__target nelflow-toolbelt__target--${record.state}`);
  row.dataset.nelflowToolbeltTargetKey = record.toolbeltTargetKey;
  const body = element("div", "nelflow-toolbelt__target-body");
  body.append(element("strong", null, targetName(record, number)));
  const result = resultLabel(record);
  if (result) body.append(element("span", "nelflow-toolbelt__result", result));
  body.append(element("span", "nelflow-toolbelt__status", stateLabel(record)));
  if (
    getSetting(SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS) &&
    record.manualControlsEnabled === true
  ) {
    body.append(element("span", "nelflow-toolbelt__manual-enabled", localize("Nelflow.Toolbelt.Guard.ManualEnabled")));
  }
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
    undo.addEventListener("click", () => {
      undo.disabled = true;
      void runToolbeltControl(
        message,
        () => ToolbeltBasicSaveService.undo(message.id, record.toolbeltTargetKey),
        "undo",
      ).finally(() => { undo.disabled = false; });
    });
    controls.append(undo);
  }
  const manual = manualControlButton(message, draft, normalizedTarget, record);
  if (manual) controls.append(manual);
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
  header.append(element("strong", null, sourceHeader(message, draft)));
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
    list.append(statusRow(message, draft, target, record, index + 1));
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
      void runToolbeltControl(message, () => ToolbeltBasicSaveService.confirm(message.id), "confirm-application")
        .finally(() => { apply.disabled = false; });
    });
    footer.append(apply);
    wrapper.append(footer);
  }

  const content = html.querySelector(".message-content");
  content?.append(wrapper);
  const guardedTargets = ToolbeltControlGuard.render(message, html, draft, normalized);
  for (const key of guardedTargets) {
    const row = Array.from(wrapper.querySelectorAll("[data-nelflow-toolbelt-target-key]")).find(
      (candidate) => candidate.dataset.nelflowToolbeltTargetKey === key,
    );
    row?.querySelector(".nelflow-toolbelt__target-body")?.append(
      element("span", "nelflow-toolbelt__guard", localize("Nelflow.Toolbelt.Guard.Indicator")),
    );
  }
  return true;
}

export function toolbeltModeActive() {
  return getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT;
}
