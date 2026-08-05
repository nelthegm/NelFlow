import { MODULE_ID, SETTINGS } from "./constants.js";
import {
  canUndoBatchChild,
  multiTargetPresentationHost,
  MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
} from "./multi-target-strike-model.js";
import { MultiTargetStrikeService } from "./multi-target-strike-service.js";
import { NativeCardCompactor } from "./native-card-compactor.js";
import { formatDamageSummary, strikeOutcomeLabel } from "./presentation-format.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";
import { logger } from "./logger.js";

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function visible(message) {
  return Boolean(message?.visible && message.isContentVisible);
}

function linkedMessages(transaction) {
  return (transaction.linkedMessageIds ?? [])
    .map((id) => game.messages?.get(id))
    .filter((message) => {
      if (!visible(message)) return false;
      const marker = message.getFlag?.(MODULE_ID, "transaction");
      const resolved = TransactionStore.resolveCanonical(message);
      if (resolved?.transaction?.id !== transaction.id || marker?.id !== transaction.id) return false;
      if (marker.role === "attack") return message.id === transaction.attackMessageId;
      if (marker.role === "damage") {
        return transaction.damageGroups?.[marker.damageGroup]?.damageMessageId === message.id;
      }
      if (marker.role === "application") {
        return transaction.targets?.find((target) => target.key === marker.targetKey)?.applicationMessageId === message.id;
      }
      return false;
    });
}

function hostId(transaction) {
  const exact = new Set(linkedMessages(transaction).map((message) => message.id));
  return multiTargetPresentationHost(transaction, (messageId) => exact.has(messageId));
}

function targetName(child) {
  const document = typeof fromUuidSync === "function"
    ? fromUuidSync(child.tokenUuid, { strict: false })
    : null;
  const token = document?.object ?? document;
  if (!token) return localize("Nelflow.MultiTarget.TargetUnavailable");
  const canSeeName =
    game.user?.isGM ||
    token.actor?.isOwner ||
    !game.pf2e?.settings?.tokens?.nameVisibility ||
    token.playersCanSeeName;
  return canSeeName ? token.name : localize("Nelflow.PlayerStrike.RecordedTarget");
}

function childState(child) {
  if (child.state === "review") return localize("Nelflow.MultiTarget.Review");
  if (child.state === "undone") return localize("Nelflow.State.Undone");
  if (child.state === "undo-blocked") return localize("Nelflow.State.UndoBlocked");
  if (child.state === "applied") {
    return Number.isFinite(child.appliedAmount)
      ? format("Nelflow.MultiTarget.Applied", { amount: child.appliedAmount })
      : localize("Nelflow.State.Applied");
  }
  if (child.state === "damage-rolled") return localize("Nelflow.State.NotApplied");
  if (child.state === "resolving") return localize("Nelflow.State.Resolving");
  if (child.state === "applying") return localize("Nelflow.State.PendingApplication");
  if (child.flatCheckFailed) return localize("Nelflow.MultiTarget.FlatCheckFailed");
  return "";
}

function button(label, className) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = label;
  control.setAttribute("aria-label", label);
  return control;
}

function runControl(operation, stage, control) {
  control.disabled = true;
  void operation()
    .catch((error) => logger.error("Multi-target chat control failed", {
      stage,
      reason: error instanceof Error ? error.message : String(error),
    }, error))
    .finally(() => {
      control.disabled = false;
    });
}

function childRow(child, attackMessage) {
  const item = document.createElement("li");
  item.className = `nelflow-batch__target nelflow-batch__target--${child.state}`;
  const text = document.createElement("span");
  text.className = "nelflow-batch__target-result";
  const parts = [targetName(child), child.outcome ? strikeOutcomeLabel(child.outcome) : localize("Nelflow.MultiTarget.Review")];
  const damage = formatDamageSummary(child.damageSummary);
  if (damage) parts.push(damage);
  const state = childState(child);
  if (state) parts.push(state);
  text.textContent = parts.join(" · ");
  item.append(text);
  if (
    game.user?.isGM &&
    TransactionStore.get(attackMessage)?.snapshot?.processingUserId === game.user.id &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    canUndoBatchChild(child)
  ) {
    const undo = button(localize("Nelflow.Status.Undo"), "nelflow-batch__undo-target");
    undo.title = localize("Nelflow.Status.UndoTitle");
    undo.addEventListener("click", () => {
      runControl(
        () => MultiTargetStrikeService.undoTarget(attackMessage, child.key),
        "batch-target-undo",
        undo,
      );
    });
    item.append(undo);
  }
  return item;
}

function recordsControl(transaction) {
  const messages = linkedMessages(transaction);
  if (!messages.length) return null;
  const details = document.createElement("details");
  details.className = "nelflow-batch__records";
  const summary = document.createElement("summary");
  summary.textContent = format("Nelflow.Stack.NativeRecords", { count: messages.length });
  const controls = document.createElement("div");
  controls.className = "nelflow-batch__record-buttons";
  for (const message of messages) {
    const label = message.id === transaction.attackMessageId
      ? localize("Nelflow.Stack.AttackMessage")
      : message.isDamageRoll
        ? localize("Nelflow.Stack.DamageMessage")
        : localize("Nelflow.Stack.ApplicationMessage");
    const control = button(label, "nelflow-batch__record");
    control.addEventListener("click", () => NativeCardCompactor.reveal(message.id, { focus: true, highlight: true }));
    controls.append(control);
  }
  details.append(summary, controls);
  return details;
}

export function renderMultiTargetStrike(message, html) {
  html.querySelectorAll(".nelflow-batch").forEach((element) => element.remove());
  const resolved = TransactionStore.resolveCanonical(message);
  const transaction = resolved?.transaction;
  const actorType = transaction?.snapshot?.actorType;
  const stackMessage = transaction?.stackRef?.id ? game.messages?.get(transaction.stackRef.id) : null;
  if (
    transaction?.transactionType !== MULTI_TARGET_STRIKE_TRANSACTION_TYPE ||
    !["character", "npc"].includes(actorType) ||
    (actorType === "npc" && stackMessage?.getFlag?.(MODULE_ID, "stack")) ||
    message.id !== hostId(transaction) ||
    !visible(message)
  ) return false;
  const article = document.createElement("aside");
  article.className = `nelflow-batch nelflow-batch--${actorType === "npc" ? "npc" : "player"}`;
  article.setAttribute("role", "status");
  const heading = document.createElement("strong");
  heading.textContent = format("Nelflow.MultiTarget.TargetCount", { count: transaction.targets.length });
  const targets = document.createElement("ul");
  targets.className = "nelflow-batch__targets";
  for (const child of transaction.targets) targets.append(childRow(child, resolved.attackMessage));
  const footer = document.createElement("footer");
  footer.className = "nelflow-batch__footer";
  const records = recordsControl(transaction);
  if (records) footer.append(records);
  if (
    game.user?.isGM &&
    transaction.snapshot?.processingUserId === game.user.id &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    transaction.targets.some(canUndoBatchChild)
  ) {
    const undoAll = button(localize("Nelflow.MultiTarget.UndoAll"), "nelflow-batch__undo-all");
    undoAll.addEventListener("click", () => {
      runControl(
        () => MultiTargetStrikeService.undoAll(resolved.attackMessage),
        "batch-undo-all",
        undoAll,
      );
    });
    footer.append(undoAll);
  }
  article.append(heading, targets, footer);
  (html.querySelector(".message-content") ?? html).append(article);
  return true;
}
