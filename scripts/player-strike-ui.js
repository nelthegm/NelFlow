import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { PLAYER_STRIKE_TRANSACTION_TYPE } from "./player-strike-model.js";
import { getSetting } from "./settings.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { logger } from "./logger.js";
import { bindCharacterStrikeIntentCapture } from "./player-strike-intent.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { RollPopoverController } from "./roll-popover-controller.js";
import { buildRollInspection, inspectionKind } from "./strike-roll-inspection.js";
import { strikeOutcomeLabel } from "./presentation-format.js";
import {
  canShowPlayerStrikeAppliedAmount,
  canShowPlayerStrikeUndo,
  isPlayerStrikePresentationHost,
  playerStrikeDamageActionKind,
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

function attackMessageForTransaction(transaction, currentMessage) {
  if (!transaction?.attackMessageId) return currentMessage;
  if (currentMessage?.id === transaction.attackMessageId) return currentMessage;
  return game.messages?.get(transaction.attackMessageId) ?? currentMessage;
}

/**
 * Authorized attack total from the visible native attack message.
 * Never invents a total when the roll is private to this viewer.
 */
export function authorizedAttackTotal(message) {
  if (!message?.isContentVisible) return null;
  const roll =
    message.rolls?.find((candidate) => candidate?.options?.type === "attack-roll") ??
    message.rolls?.find((candidate) => candidate?.isCheckRoll) ??
    message.rolls?.[0] ??
    null;
  return Number.isFinite(roll?.total) ? roll.total : null;
}

/**
 * Locate the native PF2e Damage / Critical Damage control on the attack card.
 */
export function findNativeStrikeDamageControl(html, outcome) {
  if (!html?.querySelector) return null;
  const dataOutcome = outcome === "criticalSuccess" ? "critical-success" : "success";
  return (
    html.querySelector(`button[data-action="strike-damage"][data-outcome="${dataOutcome}"]`) ??
    html.querySelector(`button[data-action="strike-damage"][data-outcome="${outcome}"]`) ??
    null
  );
}

/**
 * Activate PF2e's own strike-damage control once. Does not reconstruct formulas.
 * Intent capture remains bound to the native button click.
 * @returns {boolean}
 */
export function activateNativeStrikeDamage(html, outcome) {
  const button = findNativeStrikeDamageControl(html, outcome);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

function strikeLabel(transaction, message) {
  const attackMessage = attackMessageForTransaction(transaction, message);
  const name =
    attackMessage?.item?.name ??
    attackMessage?.flags?.pf2e?.strike?.name ??
    null;
  return typeof name === "string" && name.length > 0
    ? name
    : localize("Nelflow.Stack.UnknownStrike");
}

function attackResultLine(transaction, message) {
  const strike = strikeLabel(transaction, message);
  const target = targetLabel(transaction);
  const outcome = transaction.snapshot?.outcome;
  const parts = [`${strike} → ${target}`];
  const outcomeText = outcome ? strikeOutcomeLabel(outcome) : null;
  const attackMessage = attackMessageForTransaction(transaction, message);
  const total = authorizedAttackTotal(attackMessage);
  if (outcomeText && Number.isFinite(total)) {
    parts.push(`${outcomeText} · ${total}`);
  } else if (outcomeText) {
    parts.push(outcomeText);
  }
  return parts.join("\n");
}

function summaryText(transaction, message, { showAppliedAmount }) {
  const target = targetLabel(transaction);
  const state = playerStrikePresentationState(transaction);
  if (state === "waiting" || state === "not-a-hit") {
    return attackResultLine(transaction, message);
  }
  if (state === "applied") {
    const result = attackResultLine(transaction, message);
    const applied = showAppliedAmount && Number.isFinite(transaction.appliedAmount)
      ? localize("Nelflow.PlayerStrike.Summary.Applied", {
          amount: transaction.appliedAmount,
          target,
        })
      : localize("Nelflow.PlayerStrike.Summary.AppliedUnknown", { target });
    return `${result}\n${applied}`;
  }
  const keys = {
    applying: "Applying",
    interrupted: "Interrupted",
    undone: "Undone",
    "undo-blocked": "UndoBlocked",
    "manual-review": "ManualReview",
  };
  if (keys[state]) {
    return `${attackResultLine(transaction, message)}\n${localize(
      `Nelflow.PlayerStrike.Summary.${keys[state]}`,
      { target },
    )}`;
  }
  return attackResultLine(transaction, message);
}

function damageActionControl(message, html, transaction) {
  const outcome = transaction.snapshot?.outcome;
  const kind = playerStrikeDamageActionKind(outcome);
  if (!kind) return null;
  const native = findNativeStrikeDamageControl(html, outcome);
  if (!native) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nelflow-player-strike__damage-action";
  button.dataset.nelflowDamageAction = kind;
  button.textContent = localize(
    kind === "critical"
      ? "Nelflow.PlayerStrike.RollCriticalDamage"
      : "Nelflow.PlayerStrike.RollDamage",
  );
  button.title = button.textContent;
  button.setAttribute("aria-label", button.textContent);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    try {
      // Delegate to the exact native PF2e control so formulas, runes, fatal,
      // deadly, and precision stay system-owned. Intent capture stays on that
      // native click path.
      const activated = activateNativeStrikeDamage(html, outcome);
      if (!activated) {
        button.disabled = false;
        logger.warn("Player Strike damage action unavailable", {
          attackMessageId: message.id,
          stage: "player-strike-damage-action",
          reason: "native-control-missing",
        });
      }
    } catch (error) {
      button.disabled = false;
      logger.error("Player Strike damage action failed", {
        attackMessageId: message.id,
        stage: "player-strike-damage-action",
        reason: "internal-exception",
      }, error);
    }
  });
  return button;
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
  body.textContent = summaryText(transaction, message, {
    showAppliedAmount: canShowPlayerStrikeAppliedAmount(transaction, {
      isGM: game.user?.isGM,
      canViewMessage: (messageId) => canViewLinkedMessage(message, messageId),
    }),
  });
  status.append(icon, body);

  if (
    presentationState === "waiting" &&
    transaction.state === TRANSACTION_STATES.WAITING_FOR_DAMAGE
  ) {
    const damageAction = damageActionControl(message, html, transaction);
    if (damageAction) {
      status.dataset.nelflowDamageActionable = "true";
      status.append(damageAction);
    }
  }

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
