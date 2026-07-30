import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { getSetting } from "./settings.js";
import { logger } from "./logger.js";
import { formatDamageSummary, NativeCardCompactor } from "./native-card-compactor.js";
import { StrikeResolver } from "./strike-resolver.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";

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

function outcomeLabel(outcome) {
  const keys = {
    criticalFailure: "Nelflow.Outcome.CriticalFailure",
    failure: "Nelflow.Outcome.Failure",
    success: "Nelflow.Outcome.Success",
    criticalSuccess: "Nelflow.Outcome.CriticalSuccess",
  };
  return localize(keys[outcome] ?? "Nelflow.State.Error");
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
        ? "Nelflow.Outcome.CriticalFailure"
        : "Nelflow.Outcome.Failure";
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

function revealNativeMessage(messageId) {
  if (!NativeCardCompactor.reveal(messageId)) {
    ui.notifications.warn("Nelflow.Notification.NativeMessageUnavailable", { localize: true });
  }
}

function referenceButton(messageId, labelKey, iconClass) {
  const button = labeledButton({
    className: "nelflow-stack__reference",
    iconClass,
    label: localize(labelKey),
  });
  button.disabled = !messageId || !game.messages.get(messageId);
  button.addEventListener("click", () => revealNativeMessage(messageId));
  return button;
}

function renderRow(row, canMutate) {
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
  target.dataset.uuid = row.targetTokenUuid ?? row.targetActorUuid ?? "";
  target.title = row.targetTokenUuid ?? row.targetActorUuid ?? "";
  target.textContent = format("Nelflow.Stack.Target", { target: row.targetName });
  attackLine.append(target);

  const resultLine = document.createElement("div");
  resultLine.className = "nelflow-stack__result";
  const outcome = document.createElement("span");
  outcome.textContent = outcomeLabel(row.outcome);
  resultLine.append(outcome);
  const damage = formatDamageSummary(row.damageSummary);
  if (damage) {
    const damageLabel = document.createElement("span");
    damageLabel.textContent = damage;
    resultLine.append(damageLabel);
  }
  const stateLabel = document.createElement("span");
  stateLabel.className = "nelflow-stack__state";
  stateLabel.textContent = localize(state.key);
  if (row.appliedAmount != null && state.className === "applied") {
    stateLabel.textContent = format("Nelflow.State.AppliedAmount", {
      amount: row.appliedAmount,
    });
  }
  if (row.transactionState !== TRANSACTION_STATES.SKIPPED) resultLine.append(stateLabel);
  const details = document.createElement("details");
  details.className = "nelflow-stack__details";
  const detailsToggle = document.createElement("summary");
  detailsToggle.textContent = localize("Nelflow.Stack.Details");
  detailsToggle.setAttribute("aria-label", localize("Nelflow.Stack.DetailsAria"));
  const references = document.createElement("div");
  references.className = "nelflow-stack__references";
  references.append(
    referenceButton(row.attackMessageId, "Nelflow.Stack.AttackMessage", "fa-solid fa-dice-d20"),
    referenceButton(row.damageMessageId, "Nelflow.Stack.DamageMessage", "fa-solid fa-burst"),
  );
  if (row.applicationMessageId) {
    references.append(
      referenceButton(
        row.applicationMessageId,
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

  const rows = document.createElement("ol");
  rows.className = "nelflow-stack__rows";
  rows.setAttribute("aria-label", localize("Nelflow.Stack.RowsAria"));
  const canMutate = game.user.isGM && game.user.id === stack.identity.authorUserId;
  for (const row of stack.rows ?? []) rows.append(renderRow(row, canMutate));
  article.append(header, rows);
  content.replaceChildren(article);
  html.classList.add("nelflow-stack-message");
  html.dataset.nelflowStackId = message.id;
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
  const stack = message.getFlag(MODULE_ID, "stack");
  if (stack) {
    renderStack(message, html, stack);
    return;
  }
  renderLegacyStatus(message, html);
  NativeCardCompactor.render(message, html);
}
