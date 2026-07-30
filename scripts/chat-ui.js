import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";

function stateLabel(state) {
  const keys = {
    [TRANSACTION_STATES.DETECTED]: "Nelflow.Status.Detected",
    [TRANSACTION_STATES.PROCESSING]: "Nelflow.Status.Processing",
    [TRANSACTION_STATES.SKIPPED]: "Nelflow.Status.Skipped",
    [TRANSACTION_STATES.DAMAGE_ROLLED]: "Nelflow.Status.DamageRolled",
    [TRANSACTION_STATES.APPLIED]: "Nelflow.Status.Applied",
    [TRANSACTION_STATES.FAILED]: "Nelflow.Status.Failed",
    [TRANSACTION_STATES.UNDONE]: "Nelflow.Status.Undone",
  };
  return game.i18n.localize(keys[state] ?? "Nelflow.Status.Failed");
}

function statusText(transaction) {
  if (transaction.state === TRANSACTION_STATES.APPLIED) {
    return game.i18n.format("Nelflow.Status.AppliedDetail", {
      target: transaction.targetName ?? transaction.snapshot.targetActorUuid,
      amount: transaction.appliedAmount ?? 0,
    });
  }
  if (transaction.state === TRANSACTION_STATES.UNDONE) {
    return game.i18n.format("Nelflow.Status.UndoneDetail", {
      target: transaction.targetName ?? transaction.snapshot.targetActorUuid,
    });
  }
  if (transaction.state === TRANSACTION_STATES.SKIPPED) {
    return game.i18n.format("Nelflow.Status.SkippedDetail", {
      reason: game.i18n.localize(transaction.reasonKey ?? "Nelflow.Reason.AttackFailed"),
    });
  }
  if (transaction.state === TRANSACTION_STATES.FAILED) {
    return game.i18n.format("Nelflow.Status.FailedDetail", {
      reason: game.i18n.localize(transaction.reasonKey ?? "Nelflow.Reason.ProcessingError"),
    });
  }
  return stateLabel(transaction.state);
}

function shouldRender(message, localMarker, transaction) {
  if (localMarker.role === "application") return false;
  if (localMarker.role === "damage") {
    return [
      TRANSACTION_STATES.DAMAGE_ROLLED,
      TRANSACTION_STATES.APPLIED,
      TRANSACTION_STATES.FAILED,
      TRANSACTION_STATES.UNDONE,
    ].includes(transaction.state);
  }
  return [TRANSACTION_STATES.SKIPPED, TRANSACTION_STATES.FAILED].includes(transaction.state);
}

export function renderTransactionStatus(message, html) {
  if (!(html instanceof HTMLElement) || html.querySelector(".nelflow-status")) return;
  const localMarker = message.getFlag(MODULE_ID, "transaction");
  if (!localMarker) return;
  const resolved = TransactionStore.resolveCanonical(message);
  if (!resolved || !shouldRender(message, localMarker, resolved.transaction)) return;

  const row = document.createElement("div");
  row.className = "nelflow-status";
  row.dataset.transactionId = resolved.transaction.id;

  const text = document.createElement("span");
  text.className = "nelflow-status__text";
  text.textContent = statusText(resolved.transaction);
  row.append(text);

  const canUndo =
    localMarker.role === "damage" &&
    game.user.isGM &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    resolved.transaction.state === TRANSACTION_STATES.APPLIED;
  if (canUndo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nelflow-status__undo";
    button.title = game.i18n.localize("Nelflow.Status.UndoTitle");
    button.setAttribute("aria-label", game.i18n.localize("Nelflow.Status.Undo"));

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-rotate-left";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = game.i18n.localize("Nelflow.Status.Undo");
    button.append(icon, label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await StrikeResolver.undoFromMessage(message);
      } finally {
        const latest = TransactionStore.resolveCanonical(message)?.transaction;
        button.disabled = latest?.state === TRANSACTION_STATES.APPLIED;
      }
    });
    row.append(button);
  }

  (html.querySelector(".message-content") ?? html).append(row);
}
