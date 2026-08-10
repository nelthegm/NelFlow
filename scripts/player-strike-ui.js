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
  shouldRenderPlayerStrikeApplication,
} from "./player-strike-presentation.js";
import { usesNativeAugmentedStrikePresentation } from "./strike-presentation-mode.js";

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

function applicationText(transaction, { showAppliedAmount }) {
  const state = playerStrikePresentationState(transaction);
  const target = targetLabel(transaction);
  if (state === "applied") {
    return showAppliedAmount && Number.isFinite(transaction.appliedAmount)
      ? localize("Nelflow.PlayerStrike.Application.Applied", {
          amount: transaction.appliedAmount,
          target,
        })
      : localize("Nelflow.PlayerStrike.Application.AppliedUnknown", { target });
  }
  if (state === "undone") {
    return showAppliedAmount && Number.isFinite(transaction.appliedAmount)
      ? localize("Nelflow.PlayerStrike.Application.Reverted", { amount: transaction.appliedAmount })
      : localize("Nelflow.PlayerStrike.Application.RevertedUnknown");
  }
  if (state === "undo-blocked") {
    return localize("Nelflow.PlayerStrike.Application.UndoBlocked");
  }
  return localize("Nelflow.PlayerStrike.Application.Applying", { target });
}

function stateIcon(state) {
  if (state === "applied") return "fa-solid fa-circle-check";
  if (state === "undone") return "fa-solid fa-rotate-left";
  if (state === "undo-blocked") return "fa-solid fa-triangle-exclamation";
  return "fa-solid fa-spinner fa-spin";
}

/**
 * Preserve the complete native PF2e character Strike card and add, at most,
 * one application footer to the exact linked native damage record. Rendering
 * is read-only and deterministic from durable transaction/message flags.
 */
export function renderPlayerStrike(message, html) {
  html.querySelectorAll("[data-nelflow-application-status]").forEach((node) => node.remove());
  const marker = message.getFlag?.(MODULE_ID, "transaction");
  if (marker?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE) return false;
  const resolved = TransactionStore.resolveCanonical(message);
  const transaction = resolved?.transaction;
  if (!transaction || !usesNativeAugmentedStrikePresentation(transaction)) return false;

  // The capture listener observes PF2e's own Damage / Critical Damage button.
  // It never prevents, replaces, or replays PF2e's native handler.
  if (resolved.attackMessage?.id === message.id) {
    bindCharacterStrikeIntentCapture(message, html);
  }
  if (!message.visible || !message.isContentVisible) return false;
  if (!shouldRenderPlayerStrikeApplication(transaction)) return false;
  if (!isPlayerStrikePresentationHost(
    message.id,
    transaction,
    (messageId) => canViewLinkedMessage(message, messageId),
  )) return false;

  const presentationState = playerStrikePresentationState(transaction);
  const status = document.createElement("aside");
  status.className = `nelflow-player-strike-application nelflow-player-strike-application--${presentationState}`;
  status.dataset.nelflowApplicationStatus = presentationState;
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", localize("Nelflow.PlayerStrike.Application.Aria"));

  const icon = document.createElement("i");
  icon.className = stateIcon(presentationState);
  icon.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "nelflow-player-strike-application__body";
  const showAppliedAmount = canShowPlayerStrikeAppliedAmount(transaction, {
    isGM: game.user?.isGM,
    canViewMessage: (messageId) => canViewLinkedMessage(message, messageId),
  });
  body.textContent = applicationText(transaction, { showAppliedAmount });
  status.append(icon, body);

  if (canShowPlayerStrikeUndo(transaction, {
    isGM: game.user?.isGM,
    undoEnabled: getSetting(SETTINGS.ENABLE_UNDO),
  })) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "nelflow-player-strike-application__undo";
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
