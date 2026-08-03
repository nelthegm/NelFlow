import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { PLAYER_STRIKE_TRANSACTION_TYPE } from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { logger } from "./logger.js";

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

function statusKey(transaction) {
  if (transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE) return "Nelflow.PlayerStrike.WaitingForDamage";
  if ([TRANSACTION_STATES.DAMAGE_OBSERVED, TRANSACTION_STATES.VALIDATING, TRANSACTION_STATES.CLAIMED, TRANSACTION_STATES.APPLYING].includes(transaction.state)) {
    return "Nelflow.PlayerStrike.Applying";
  }
  if (transaction.state === TRANSACTION_STATES.APPLIED) return "Nelflow.PlayerStrike.Applied";
  if (transaction.state === TRANSACTION_STATES.UNDONE) return "Nelflow.PlayerStrike.Undone";
  if (transaction.state === TRANSACTION_STATES.SKIPPED) return "Nelflow.PlayerStrike.NotAHit";
  if (transaction.state === TRANSACTION_STATES.INTERRUPTED) return "Nelflow.PlayerStrike.Interrupted";
  return "Nelflow.PlayerStrike.ManualReview";
}

export function renderPlayerStrike(message, html) {
  html.querySelectorAll(".nelflow-player-strike").forEach((node) => node.remove());
  const marker = message.getFlag?.(MODULE_ID, "transaction");
  if (marker?.transactionType !== PLAYER_STRIKE_TRANSACTION_TYPE) return false;
  const resolved = TransactionStore.resolveCanonical(message);
  const transaction = resolved?.transaction;
  if (!transaction || !message.visible || !message.isContentVisible) return false;

  const status = document.createElement("aside");
  status.className = `nelflow-player-strike nelflow-player-strike--${transaction.state}`;
  status.setAttribute("role", "status");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-crosshairs";
  icon.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "nelflow-player-strike__body";
  const label = document.createElement("strong");
  label.textContent = localize(statusKey(transaction));
  const target = document.createElement("small");
  target.className = "nelflow-player-strike__target";
  const amount = Number.isFinite(transaction.appliedAmount)
    ? localize("Nelflow.PlayerStrike.AppliedAmount", { amount: transaction.appliedAmount })
    : null;
  target.textContent = amount
    ? localize("Nelflow.PlayerStrike.TargetAndAmount", { target: targetLabel(transaction), amount })
    : targetLabel(transaction);
  body.append(label, target);
  status.append(icon, body);

  if (
    game.user?.isGM &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    transaction.state === TRANSACTION_STATES.APPLIED &&
    !transaction.undoBlocked
  ) {
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
