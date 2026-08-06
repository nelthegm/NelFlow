import { MODULE_ID, SETTINGS } from "./constants.js";
import { PLAYER_STRIKE_TRANSACTION_TYPE } from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { logger } from "./logger.js";
import { bindCharacterStrikeIntentCapture } from "./player-strike-intent.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { RollPopoverController } from "./roll-popover-controller.js";
import { buildRollInspection, inspectionKind } from "./strike-roll-inspection.js";
import {
  canShowPlayerStrikeAppliedAmount,
  canShowPlayerStrikeUndo,
  isPlayerStrikePresentationHost,
  playerStrikePresentationState,
} from "./player-strike-presentation.js";

function localize(key, data = null) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function targetLabel(transaction) {
  const targetTokenUuid = transaction.snapshot?.targetTokenUuid;
  const tokenDocument = targetTokenUuid && typeof globalThis.fromUuidSync === "function"
    ? globalThis.fromUuidSync(targetTokenUuid, { strict: false })
    : null;
  const token = tokenDocument?.object ?? tokenDocument;
  if (!token) return localize("Nelflow.PlayerStrike.TargetUnavailable");
  const nameVisible =
    game.user?.isGM ||
    token.actor?.isOwner ||
    !game.pf2e?.settings?.tokens?.nameVisibility ||
    token.playersCanSeeName;
  return nameVisible ? token.name : localize("Nelflow.PlayerStrike.RecordedTarget");
}

function canViewLinkedMessage(currentMessage, messageId) {
  const candidate = currentMessage.id === messageId ? currentMessage : game.messages?.get(messageId);
  return Boolean(candidate?.visible && candidate.isContentVisible);
}

function canInspectRecordedTarget(target) {
  const tokenDocument = typeof globalThis.fromUuidSync === "function"
    ? globalThis.fromUuidSync(target?.tokenUuid ?? target?.targetTokenUuid, { strict: false })
    : null;
  const token = tokenDocument?.object ?? tokenDocument;
  return Boolean(game.user?.isGM || token?.actor?.isOwner);
}

function inspectionTargetLabel(target) {
  const tokenDocument = typeof globalThis.fromUuidSync === "function"
    ? globalThis.fromUuidSync(target?.tokenUuid ?? target?.targetTokenUuid, { strict: false })
    : null;
  const token = tokenDocument?.object ?? tokenDocument;
  if (!token) return localize("Nelflow.PlayerStrike.TargetUnavailable");
  const canSeeName =
    game.user?.isGM ||
    token.actor?.isOwner ||
    !game.pf2e?.settings?.tokens?.nameVisibility ||
    token.playersCanSeeName;
  return canSeeName ? token.name : localize("Nelflow.Roll.HiddenTarget");
}

function resultsControl(transaction) {
  const records = NativeRecordsController.recordsForTransaction(transaction);
  if (!records.length) return null;
  const details = document.createElement("details");
  details.className = "nelflow-player-strike__results";
  const summary = document.createElement("summary");
  summary.textContent = localize("Nelflow.Stack.Results", { count: records.length });
  summary.setAttribute("aria-label", localize("Nelflow.Stack.Results", { count: records.length }));
  const controls = document.createElement("div");
  controls.className = "nelflow-player-strike__result-controls";
  for (const record of records) {
    const kind = inspectionKind(record, transaction);
    const label = localize(kind === "attack"
      ? "Nelflow.Stack.AttackMessage"
      : kind === "criticalDamage"
        ? "Nelflow.Stack.CriticalDamageMessage"
        : "Nelflow.Stack.DamageMessage");
    const control = document.createElement("button");
    control.type = "button";
    control.className = "nelflow-player-strike__result";
    control.textContent = label;
    control.title = localize("Nelflow.Roll.InspectTitle");
    control.setAttribute("aria-label", label);
    RollPopoverController.register(control, () => {
      const current = NativeRecordsController.refreshRecord(record);
      if (!current) return { kind, available: false };
      return buildRollInspection(current, {
        transaction: current.transaction,
        canInspectTarget: canInspectRecordedTarget,
        targetLabel: inspectionTargetLabel,
        hiddenTargetLabel: localize("Nelflow.Roll.HiddenTarget"),
      });
    }, kind);
    controls.append(control);
  }
  details.append(summary, controls);
  return details;
}

function summaryText(transaction, { showAppliedAmount }) {
  const target = targetLabel(transaction);
  const state = playerStrikePresentationState(transaction);
  if (state === "applied") {
    return showAppliedAmount && Number.isFinite(transaction.appliedAmount)
      ? localize("Nelflow.PlayerStrike.Summary.Applied", {
          amount: transaction.appliedAmount,
          target,
        })
      : localize("Nelflow.PlayerStrike.Summary.AppliedUnknown", { target });
  }
  const keys = {
    waiting: "Waiting",
    applying: "Applying",
    "not-a-hit": "NotAHit",
    interrupted: "Interrupted",
    undone: "Undone",
    "undo-blocked": "UndoBlocked",
    "manual-review": "ManualReview",
  };
  return localize(`Nelflow.PlayerStrike.Summary.${keys[state]}`, { target });
}

export function renderPlayerStrike(message, html) {
  html.querySelectorAll(".nelflow-player-strike").forEach((node) => node.remove());
  const marker = message.getFlag?.(MODULE_ID, "transaction");
  if (marker?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE) return false;
  const resolved = TransactionStore.resolveCanonical(message);
  const transaction = resolved?.transaction;
  if (!transaction || !message.visible || !message.isContentVisible) return false;
  bindCharacterStrikeIntentCapture(message, html);
  if (!isPlayerStrikePresentationHost(
    message.id,
    transaction,
    (messageId) => canViewLinkedMessage(message, messageId),
  )) return false;

  const status = document.createElement("aside");
  const presentationState = playerStrikePresentationState(transaction);
  status.className = `nelflow-player-strike nelflow-player-strike--${presentationState}`;
  status.setAttribute("role", "status");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-crosshairs";
  icon.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "nelflow-player-strike__body";
  body.textContent = summaryText(transaction, {
    showAppliedAmount: canShowPlayerStrikeAppliedAmount(transaction, {
      isGM: game.user?.isGM,
      canViewMessage: (messageId) => canViewLinkedMessage(message, messageId),
    }),
  });
  status.append(icon, body);
  const results = resultsControl(transaction);
  if (results) status.append(results);

  if (canShowPlayerStrikeUndo(transaction, {
    isGM: game.user?.isGM,
    undoEnabled: getSetting(SETTINGS.ENABLE_UNDO),
  })) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "nelflow-player-strike__undo";
    undo.textContent = localize("Nelflow.Status.Undo");
    undo.setAttribute("aria-label", localize("Nelflow.Status.UndoTitle"));
    undo.addEventListener("click", () => {
      undo.disabled = true;
      void StrikeResolver.undoFromMessage(resolved.attackMessage)
        .catch((error) => {
          logger.error("Player Strike Undo control failed open", {
            attackMessageId: resolved.attackMessage.id,
            stage: "player-strike-undo",
            reason: "internal-exception",
          }, error);
        })
        .finally(() => {
          undo.disabled = false;
        });
    });
    status.append(undo);
  }
  (html.querySelector(".message-content") ?? html).append(status);
  return true;
}
