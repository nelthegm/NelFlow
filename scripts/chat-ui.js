import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { getSetting } from "./settings.js";
import { logger } from "./logger.js";
import {
  formatDamageSummary,
  NativeCardCompactor,
  strikeOutcomeLabel,
} from "./native-card-compactor.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { StrikeResolver } from "./strike-resolver.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";

const reportedRenderFailures = new Set();

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function icon(className) {
  const element = document.createElement("i");
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function labeledButton({ className, iconClass, label, title = label }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", label);
  button.append(icon(iconClass));
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  return button;
}

function runControl(operation, stage) {
  void operation().catch((error) => {
    logger.error(
      "Chat control failed",
      {
        stage,
        reason: error instanceof Error ? error.message : String(error),
      },
      error,
    );
  });
}

function rowState(row) {
  if (row.presentationError || row.transactionState === TRANSACTION_STATES.FAILED) {
    return { key: "Nelflow.State.Error", className: "error" };
  }
  if (row.transactionState === TRANSACTION_STATES.PROCESSING) {
    return { key: "Nelflow.State.Resolving", className: "resolving" };
  }
  if (row.transactionState === TRANSACTION_STATES.SKIPPED) {
    const key =
      row.outcome === "criticalFailure"
        ? "Nelflow.StrikeOutcome.CriticalMiss"
        : "Nelflow.StrikeOutcome.Miss";
    return { key, className: "miss" };
  }
  if (row.transactionState === TRANSACTION_STATES.DAMAGE_ROLLED) {
    return row.autoApplyRequested
      ? { key: "Nelflow.State.PendingApplication", className: "pending" }
      : { key: "Nelflow.State.NotApplied", className: "not-applied" };
  }
  if (row.transactionState === TRANSACTION_STATES.APPLIED) {
    return row.undoBlocked
      ? { key: "Nelflow.State.UndoBlocked", className: "blocked" }
      : { key: "Nelflow.State.Applied", className: "applied" };
  }
  if (row.transactionState === TRANSACTION_STATES.UNDONE) {
    return { key: "Nelflow.State.Undone", className: "undone" };
  }
  return { key: "Nelflow.State.Error", className: "error" };
}

function mapText(row) {
  if (!row.mapIncreases) return "";
  if (!Number.isFinite(row.mapPenalty)) {
    return format("Nelflow.Stack.MapStep", { step: row.mapIncreases });
  }
  const penalty = new Intl.NumberFormat(game.i18n.lang, { signDisplay: "always" }).format(
    row.mapPenalty,
  );
  return format("Nelflow.Stack.Map", { penalty });
}

function visibleNativeMessage(messageId) {
  const message = messageId ? game.messages.get(messageId) : null;
  return Boolean(message?.visible && message.isContentVisible);
}

function revealNativeMessage(messageId, stackId, options = {}) {
  NativeRecordsController.show(stackId);
  if (!NativeCardCompactor.reveal(messageId, options)) {
    ui.notifications.warn("Nelflow.Notification.NativeMessageUnavailable", { localize: true });
  }
}

function referenceButton(messageId, stackId, labelKey, iconClass) {
  const button = labeledButton({
    className: "nelflow-stack__reference",
    iconClass,
    label: localize(labelKey),
  });
  button.disabled = !visibleNativeMessage(messageId);
  button.addEventListener("click", () => revealNativeMessage(messageId, stackId));
  return button;
}

function renderSupplementalActions(row, stackId) {
  const awareness = SupplementalActionAwareness.forRow(row);
  if (
    !SupplementalActionAwareness.visibleToCurrentUser(awareness) ||
    !visibleNativeMessage(row.attackMessageId)
  ) {
    return null;
  }

  const labels = SupplementalActionAwareness.localizedLabels(awareness);
  const label = Number.isFinite(awareness.count)
    ? format("Nelflow.Stack.ActionsCount", { count: awareness.count })
    : localize("Nelflow.Stack.AdditionalActions");
  const title = labels.length
    ? format("Nelflow.Stack.ActionsNamedTitle", { actions: labels.join(", ") })
    : localize("Nelflow.Stack.ActionsUnknownTitle");
  const button = labeledButton({
    className: "nelflow-stack__actions",
    iconClass: "fa-solid fa-bolt",
    label,
    title,
  });
  button.addEventListener("click", () => {
    revealNativeMessage(row.attackMessageId, stackId, { focus: true, highlight: true });
  });
  return button;
}

function renderRow(row, canMutate, stackId) {
  const state = rowState(row);
  const item = document.createElement("li");
  item.className = `nelflow-stack__row nelflow-stack__row--${state.className}`;
  item.dataset.transactionId = row.transactionId;
  item.dataset.attackMessageId = row.attackMessageId;

  const summary = document.createElement("div");
  summary.className = "nelflow-stack__row-summary";

  const image = document.createElement("img");
  image.className = "nelflow-stack__strike-icon";
  image.src = row.strikeIcon;
  image.alt = "";

  const main = document.createElement("div");
  main.className = "nelflow-stack__main";
  const attackLine = document.createElement("div");
  attackLine.className = "nelflow-stack__attack";
  const attackName = document.createElement("strong");
  attackName.textContent = row.strikeName;
  attackLine.append(attackName);
  const map = mapText(row);
  if (map) {
    const mapLabel = document.createElement("span");
    mapLabel.className = "nelflow-stack__map";
    mapLabel.textContent = map;
    attackLine.append(mapLabel);
  }
  const target = document.createElement("span");
  target.className = "nelflow-stack__target";
  if (game.user.isGM) {
    target.dataset.uuid = row.targetTokenUuid ?? row.targetActorUuid ?? "";
    target.title = row.targetTokenUuid ?? row.targetActorUuid ?? "";
  }
  target.textContent = format("Nelflow.Stack.Target", {
    target: game.user.isGM ? row.targetName : localize("Nelflow.Native.Target"),
  });
  attackLine.append(target);

  const resultLine = document.createElement("div");
  resultLine.className = "nelflow-stack__result";
  const outcome = document.createElement("span");
  outcome.textContent = strikeOutcomeLabel(row.outcome);
  resultLine.append(outcome);
  const damage =
    game.user.isGM || visibleNativeMessage(row.damageMessageId)
      ? formatDamageSummary(row.damageSummary)
      : "";
  if (damage) {
    const damageLabel = document.createElement("span");
    damageLabel.textContent = damage;
    resultLine.append(damageLabel);
  }
  const stateLabel = document.createElement("span");
  stateLabel.className = "nelflow-stack__state";
  stateLabel.textContent = localize(state.key);
  if (
    row.appliedAmount != null &&
    state.className === "applied" &&
    (game.user.isGM || visibleNativeMessage(row.applicationMessageId))
  ) {
    stateLabel.textContent = format("Nelflow.State.AppliedAmount", {
      amount: row.appliedAmount,
    });
  }
  if (row.transactionState !== TRANSACTION_STATES.SKIPPED) resultLine.append(stateLabel);
  const supplementalActions = renderSupplementalActions(row, stackId);
  if (supplementalActions) resultLine.append(supplementalActions);
  const details = document.createElement("details");
  details.className = "nelflow-stack__details";
  const detailsToggle = document.createElement("summary");
  detailsToggle.textContent = localize("Nelflow.Stack.Details");
  detailsToggle.setAttribute("aria-label", localize("Nelflow.Stack.DetailsAria"));
  const references = document.createElement("div");
  references.className = "nelflow-stack__references";
  const recordsLabel = document.createElement("span");
  recordsLabel.className = "nelflow-stack__records-label";
  recordsLabel.textContent = localize("Nelflow.Stack.Records");
  references.append(recordsLabel);
  references.append(
    referenceButton(
      row.attackMessageId,
      stackId,
      "Nelflow.Stack.AttackMessage",
      "fa-solid fa-dice-d20",
    ),
    referenceButton(
      row.damageMessageId,
      stackId,
      "Nelflow.Stack.DamageMessage",
      "fa-solid fa-burst",
    ),
  );
  if (row.applicationMessageId) {
    references.append(
      referenceButton(
        row.applicationMessageId,
        stackId,
        "Nelflow.Stack.ApplicationMessage",
        "fa-solid fa-heart-pulse",
      ),
    );
  }
  if (row.presentationError) {
    const error = document.createElement("span");
    error.className = "nelflow-stack__error";
    error.textContent = row.presentationError;
    references.append(error);
  }
  details.append(detailsToggle, references);
  resultLine.append(details);

  const canUndo =
    canMutate &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    row.transactionState === TRANSACTION_STATES.APPLIED &&
    !row.undoBlocked &&
    Boolean(game.messages.get(row.attackMessageId));
  if (canUndo) {
    const undo = labeledButton({
      className: "nelflow-stack__undo",
      iconClass: "fa-solid fa-rotate-left",
      label: localize("Nelflow.Status.Undo"),
      title: localize("Nelflow.Status.UndoTitle"),
    });
    undo.addEventListener("click", () => {
      runControl(async () => {
        undo.disabled = true;
        try {
          const attackMessage = game.messages.get(row.attackMessageId);
          if (attackMessage) await StrikeResolver.undoFromMessage(attackMessage);
        } finally {
          undo.disabled = false;
        }
      }, "stack-row-undo");
    });
    resultLine.append(undo);
  }

  main.append(attackLine, resultLine);
  summary.append(image, main);
  item.append(summary);
  return item;
}

function renderStack(message, html, stack) {
  const content = html.querySelector(".message-content") ?? html;
  const article = document.createElement("article");
  article.className = "nelflow-stack";
  article.dataset.stackId = stack.id;

  const header = document.createElement("header");
  header.className = "nelflow-stack__header";
  const context = document.createElement("span");
  context.className = "nelflow-stack__context";
  context.textContent =
    stack.kind === "combat-turn"
      ? format("Nelflow.Stack.Round", { round: stack.identity.round })
      : localize("Nelflow.Stack.Standalone");
  header.append(context);

  const nativeRecords = NativeRecordsController.recordsForStack(stack);
  let nativeRecordsButton = null;
  if (nativeRecords.length && NativeRecordsController.shouldRenderControl()) {
    nativeRecordsButton = labeledButton({
      className: "nelflow-stack__native-records",
      iconClass: "fa-solid fa-box-archive",
      label: format("Nelflow.Stack.NativeRecords", { count: nativeRecords.length }),
    });
    header.append(nativeRecordsButton);
  }

  const rows = document.createElement("ol");
  rows.className = "nelflow-stack__rows";
  rows.setAttribute("aria-label", localize("Nelflow.Stack.RowsAria"));
  const canMutate = game.user.isGM && game.user.id === stack.identity.authorUserId;
  for (const row of stack.rows ?? []) rows.append(renderRow(row, canMutate, stack.id));
  article.append(header, rows);
  content.replaceChildren(article);
  html.classList.add("nelflow-stack-message");
  html.dataset.nelflowStackId = message.id;
  if (nativeRecordsButton) {
    NativeRecordsController.bindStackControl(stack, nativeRecordsButton, nativeRecords);
  }
}

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
  return localize(keys[state] ?? "Nelflow.Status.Failed");
}

function legacyStatusText(transaction) {
  if (transaction.state === TRANSACTION_STATES.APPLIED) {
    return format("Nelflow.Status.AppliedDetail", {
      target: transaction.targetName ?? transaction.snapshot.targetActorUuid,
      amount: transaction.appliedAmount ?? 0,
    });
  }
  if (transaction.state === TRANSACTION_STATES.UNDONE) {
    return format("Nelflow.Status.UndoneDetail", {
      target: transaction.targetName ?? transaction.snapshot.targetActorUuid,
    });
  }
  if (transaction.state === TRANSACTION_STATES.SKIPPED) {
    return format("Nelflow.Status.SkippedDetail", {
      reason: localize(transaction.reasonKey ?? "Nelflow.Reason.AttackFailed"),
    });
  }
  if (transaction.state === TRANSACTION_STATES.FAILED) {
    return format("Nelflow.Status.FailedDetail", {
      reason: localize(transaction.reasonKey ?? "Nelflow.Reason.ProcessingError"),
    });
  }
  return stateLabel(transaction.state);
}

function shouldRenderLegacy(localMarker, transaction) {
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

function renderLegacyStatus(message, html) {
  if (TurnStackService.enabled() || html.querySelector(".nelflow-status")) return;
  const localMarker = message.getFlag(MODULE_ID, "transaction");
  if (!localMarker) return;
  const resolved = TransactionStore.resolveCanonical(message);
  if (!resolved || !shouldRenderLegacy(localMarker, resolved.transaction)) return;

  const row = document.createElement("div");
  row.className = "nelflow-status";
  row.dataset.transactionId = resolved.transaction.id;
  const text = document.createElement("span");
  text.className = "nelflow-status__text";
  text.textContent = legacyStatusText(resolved.transaction);
  row.append(text);

  const canUndo =
    localMarker.role === "damage" &&
    game.user.isGM &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    resolved.transaction.state === TRANSACTION_STATES.APPLIED;
  if (canUndo) {
    const button = labeledButton({
      className: "nelflow-status__undo",
      iconClass: "fa-solid fa-rotate-left",
      label: localize("Nelflow.Status.Undo"),
      title: localize("Nelflow.Status.UndoTitle"),
    });
    button.addEventListener("click", () => {
      runControl(async () => {
        button.disabled = true;
        try {
          await StrikeResolver.undoFromMessage(message);
        } finally {
          button.disabled = false;
        }
      }, "legacy-undo");
    });
    row.append(button);
  }
  (html.querySelector(".message-content") ?? html).append(row);
}

export function renderNelflowChat(message, html) {
  if (!(html instanceof HTMLElement)) return;
  try {
    const stack = message.getFlag(MODULE_ID, "stack");
    if (stack) {
      if (message.visible && message.isContentVisible) renderStack(message, html, stack);
      return;
    }
    if (!message.visible || !message.isContentVisible) return;
    renderLegacyStatus(message, html);
    NativeCardCompactor.render(message, html);
  } catch (error) {
    html.classList.remove("nelflow-native-record-hidden", "nelflow-native-collapsed");
    const reason = error instanceof Error ? error.message : "unexpected chat presentation failure";
    const key = `${message.id}:${reason}`;
    if (reportedRenderFailures.has(key)) return;
    reportedRenderFailures.add(key);
    logger.warn(
      "Chat presentation failed open",
      {
        attackMessageId: message.id,
        stage: "renderChatMessageHTML",
        reason,
      },
      error,
    );
  }
}
