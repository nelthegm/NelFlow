/**
 * Spell-attack application footer + Undo (reuses StrikeResolver.undoFromMessage).
 */

import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { SPELL_ATTACK_TRANSACTION_TYPE } from "./spell-attack-model.js";

function localize(key, data) {
  return game.i18n?.format?.(key, data) ?? game.i18n?.localize?.(key) ?? key;
}

export function renderSpellAttack(message, html) {
  html.querySelectorAll("[data-nelflow-spell-attack-status]").forEach((node) => node.remove());
  const marker = message.getFlag?.(MODULE_ID, "transaction");
  if (marker?.transactionType !== SPELL_ATTACK_TRANSACTION_TYPE) return false;
  const resolved = TransactionStore.resolveCanonical(message);
  if (!resolved?.transaction) return false;
  const { attackMessage, transaction } = resolved;
  const showFooter =
    transaction.state === TRANSACTION_STATES.APPLYING ||
    transaction.state === TRANSACTION_STATES.APPLIED ||
    transaction.state === TRANSACTION_STATES.UNDONE ||
    transaction.undoBlocked === true;
  if (!showFooter) return false;

  const root = html.querySelector(".message-content") ?? html;
  const status = document.createElement("div");
  status.className = "nelflow-spell-attack-application";
  status.dataset.nelflowSpellAttackStatus = "1";
  const amount = Number.isFinite(transaction.appliedAmount) ? transaction.appliedAmount : null;
  const label =
    transaction.state === TRANSACTION_STATES.UNDONE
      ? localize("Nelflow.Status.Undone")
      : transaction.undoBlocked
        ? localize("Nelflow.Status.UndoBlocked")
        : transaction.state === TRANSACTION_STATES.APPLIED
          ? amount != null
            ? `Applied ${amount}`
            : localize("Nelflow.Status.Applied")
          : localize("Nelflow.Status.Applying");
  status.textContent = label;

  if (
    game.user?.isGM &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    transaction.state === TRANSACTION_STATES.APPLIED &&
    !transaction.undoBlocked
  ) {
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "nelflow-spell-attack-application__undo";
    undo.textContent = localize("Nelflow.Status.Undo");
    undo.addEventListener("click", () => {
      undo.disabled = true;
      void StrikeResolver.undoFromMessage(attackMessage)
        .catch((error) => {
          logger.error("Spell attack Undo control failed open", {
            attackMessageId: attackMessage.id,
            stage: "spell-attack-undo",
          }, error);
        })
        .finally(() => {
          undo.disabled = false;
        });
    });
    status.append(undo);
  }

  root.append(status);
  return true;
}