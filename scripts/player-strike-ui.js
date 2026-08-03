import { MODULE_ID, SETTINGS } from "./constants.js";
import { PLAYER_STRIKE_TRANSACTION_TYPE } from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { logger } from "./logger.js";
import { bindCharacterStrikeIntentCapture } from "./player-strike-intent.js";
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
  status.dataset.nelflowCanonicalTransaction = transaction.id;
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
