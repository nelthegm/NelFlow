import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "./constants.js";
import { formatResourceLossBreakdown } from "./damage-resource-loss.js";
import { getSetting } from "./settings.js";
import { logger } from "./logger.js";
import { NativeCardCompactor } from "./native-card-compactor.js";
import { NativeRecordsController } from "./native-records-controller.js";
import {
  formatDamageSummary,
  formatMap,
  strikeOutcomeLabel,
} from "./presentation-format.js";
import { renderDurableStackFallback } from "./stack-fallback.js";
import { failOpenSaveResolver, renderSaveResolverChat } from "./save-resolver-ui.js";
import { renderToolbeltBasicSave } from "./toolbelt-basic-save-ui.js";
import { StrikeResolver } from "./strike-resolver.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";
import { TurnStackService } from "./turn-stack-service.js";
import { failOpenAutoDamageRoll, renderAutoDamageRoll } from "./auto-damage-roll-ui.js";
import {
  removeLegacyTransactionDiagnostics,
  renderTransactionRecovery,
} from "./transaction-diagnostics-ui.js";
import { renderPlayerStrike } from "./player-strike-ui.js";
import { renderSpellAttack } from "./spell-attack-ui.js";
import { renderMultiTargetStrike } from "./multi-target-strike-ui.js";
import { canUndoBatchChild } from "./multi-target-strike-model.js";
import { MultiTargetStrikeService } from "./multi-target-strike-service.js";
import { RollPopoverController } from "./roll-popover-controller.js";
import { buildRollInspection, inspectionKind } from "./strike-roll-inspection.js";
import { buildStrikeRowPresentation } from "./strike-row-presentation.js";
import {
  ridersForStackRow,
  shouldExpandStrikeRiders,
} from "./strike-riders.js";
import { renderActionResultPresentation } from "./action-result-presentation.js";
import {
  StackPresentationController,
  stackRenderRevision,
} from "./stack-presentation-controller.js";

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

function iconButton({ className, iconClass, label, title = label }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", label);
  button.append(icon(iconClass));
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
  if (row.transactionState === TRANSACTION_STATES.ABANDONED) {
    return { key: "Nelflow.Diagnostics.Status.Abandoned", className: "manual" };
  }
  if ([TRANSACTION_STATES.MANUAL, TRANSACTION_STATES.INTERRUPTED].includes(row.transactionState)) {
    return {
      key: row.transactionState === TRANSACTION_STATES.INTERRUPTED
        ? "Nelflow.Diagnostics.Status.Interrupted"
        : "Nelflow.Diagnostics.Status.Manual",
      className: "manual",
    };
  }
  if (row.manualApplicationRequired) {
    return { key: "Nelflow.State.ManualApplicationRequired", className: "manual" };
  }
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
  if (row.transactionState === TRANSACTION_STATES.AWAITING_IMPACT) {
    return { key: "Nelflow.Status.AwaitingImpact", className: "pending" };
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
  return formatMap(row);
}

function canRenderStackForViewer(message) {
  return Boolean(message?.visible && message.isContentVisible);
}

function validStackProjection(stack) {
  return Boolean(
    stack &&
      typeof stack.id === "string" &&
      stack.identity &&
      Array.isArray(stack.rows),
  );
}

function canRevealNativeRecord(messageId) {
  const message = messageId ? game.messages.get(messageId) : null;
  return Boolean(message?.visible && message.isContentVisible);
}

function targetDocument(target) {
  if (typeof fromUuidSync !== "function") return null;
  const uuid = target?.tokenUuid ?? target?.targetTokenUuid;
  const document = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return document?.object ?? document;
}

function canInspectTarget(target) {
  const token = targetDocument(target);
  return Boolean(game.user?.isGM || token?.actor?.isOwner);
}

function inspectionTargetLabel(target) {
  const token = targetDocument(target);
  if (!token) return localize("Nelflow.MultiTarget.TargetUnavailable");
  const canSeeName =
    game.user?.isGM ||
    token.actor?.isOwner ||
    !game.pf2e?.settings?.tokens?.nameVisibility ||
    token.playersCanSeeName;
  return canSeeName ? token.name : localize("Nelflow.Roll.HiddenTarget");
}

function inspectionModel(record) {
  const kind = inspectionKind(record);
  const current = NativeRecordsController.refreshRecord(record);
  if (!current) return { kind, available: false };
  return buildRollInspection(current, {
    transaction: current.transaction,
    canInspectTarget,
    targetLabel: inspectionTargetLabel,
    hiddenTargetLabel: localize("Nelflow.Roll.HiddenTarget"),
  });
}

function inspectionButton(record) {
  const kind = inspectionKind(record);
  const labels = {
    attack: ["Nelflow.Stack.ViewAttackRoll", "fa-solid fa-dice-d20"],
    damage: ["Nelflow.Stack.ViewDamageRoll", "fa-solid fa-burst"],
    criticalDamage: ["Nelflow.Stack.ViewCriticalDamageRoll", "fa-solid fa-burst"],
  };
  const [labelKey, iconClass] = labels[kind] ?? labels.damage;
  const label = localize(labelKey);
  const control = iconButton({
    className: "nelflow-stack__reference",
    iconClass,
    label,
    title: label,
  });
  return RollPopoverController.register(
    control,
    () => inspectionModel(record),
    kind,
  );
}

function resultsPanel(records) {
  if (!records.length) return null;
  const panel = document.createElement("div");
  panel.className = "nelflow-stack__results";
  panel.setAttribute("aria-label", localize("Nelflow.Stack.ResultsAria"));
  for (const record of records) panel.append(inspectionButton(record));
  return panel;
}

function renderSupplementalActions(row, stackId) {
  const awareness = SupplementalActionAwareness.forRow(row);
  if (
    !SupplementalActionAwareness.visibleToCurrentUser(awareness) ||
    !canRevealNativeRecord(row.attackMessageId)
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
  const note = document.createElement("span");
  note.className = "nelflow-stack__actions";
  note.title = title;
  note.setAttribute("aria-label", `${label}: ${title}`);
  note.append(icon("fa-solid fa-bolt"), document.createTextNode(label));
  return note;
}

function renderStrikeRiders(row, stack) {
  const riders = ridersForStackRow(row);
  if (!riders.length) return null;

  const section = document.createElement("div");
  section.className = "nelflow-stack__riders";
  const expanded = shouldExpandStrikeRiders({ outcome: row.outcome, riders });
  section.dataset.expanded = expanded ? "true" : "false";
  if (expanded) section.classList.add("nelflow-stack__riders--open");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nelflow-stack__riders-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));
  const toggleLabel = format("Nelflow.Stack.RidersCount", { count: riders.length });
  toggle.append(icon("fa-solid fa-bolt"), document.createTextNode(toggleLabel));
  toggle.title = localize("Nelflow.Stack.RidersTitle");
  toggle.addEventListener("click", () => {
    const open = section.classList.toggle("nelflow-stack__riders--open");
    section.dataset.expanded = String(open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  const list = document.createElement("ul");
  list.className = "nelflow-stack__riders-list";
  for (const rider of riders) {
    const item = document.createElement("li");
    item.className = `nelflow-stack__rider nelflow-stack__rider--${rider.kind}`;
    const label = document.createElement("strong");
    label.textContent = rider.label;
    item.append(label);
    if (rider.detail) {
      const detail = document.createElement("span");
      detail.textContent = rider.detail;
      item.append(document.createTextNode(" — "), detail);
    }
    list.append(item);
  }

  section.append(toggle, list);

  const needsDetails = riders.some((rider) => rider.actionable || rider.kind === "native-control");
  if (needsDetails && canRevealNativeRecord(row.attackMessageId ?? row.damageMessageId)) {
    const openDetails = labeledButton({
      className: "nelflow-stack__rider-details",
      iconClass: "fa-solid fa-up-right-from-square",
      label: localize("Nelflow.Stack.OpenRiderDetails"),
      title: localize("Nelflow.Stack.OpenRiderDetailsHint"),
    });
    openDetails.addEventListener("click", () => {
      const messageId = row.damageMessageId ?? row.attackMessageId;
      if (messageId) NativeCardCompactor.reveal(messageId, { focus: true, highlight: true });
    });
    section.append(openDetails);
  }

  return section;
}

function canUseUndo(row, stack) {
  return Boolean(
    game.user.isGM &&
      game.user.id === stack.identity?.authorUserId &&
      getSetting(SETTINGS.ENABLE_UNDO) &&
      row.transactionState === TRANSACTION_STATES.APPLIED &&
      !row.undoBlocked &&
      canRevealNativeRecord(row.attackMessageId),
  );
}

function renderRow(row, stack, records) {
  if (row.batch) return renderBatchRow(row, stack, records);
  const stackId = stack.id;
  const state = rowState(row);
  const item = document.createElement("li");
  item.className = `nelflow-stack__row nelflow-stack__row--${state.className}`;

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

  const presentation = buildStrikeRowPresentation({
    row,
    records,
    inspectAttack: inspectionModel,
    formatDamage: formatDamageSummary,
  });

  const attackResult = document.createElement("div");
  attackResult.className = "nelflow-stack__attack-result";
  const outcome = document.createElement("span");
  outcome.textContent = strikeOutcomeLabel(presentation.outcome);
  attackResult.append(outcome);
  if (Number.isFinite(presentation.attackTotal)) {
    const total = document.createElement("span");
    total.className = "nelflow-stack__attack-total";
    total.textContent = String(presentation.attackTotal);
    attackResult.append(total);
  }

  const stateLabel = document.createElement("span");
  stateLabel.className = "nelflow-stack__state";
  stateLabel.textContent = localize(state.key);
  if (row.manualApplicationRequired && game.user.isGM) {
    stateLabel.title = localize("Nelflow.State.DamageUnlinkedTitle");
  }
  let resourceBreakdown = null;
  if (
    row.appliedAmount != null &&
    state.className === "applied" &&
    (game.user.isGM || canRevealNativeRecord(row.applicationMessageId))
  ) {
    stateLabel.textContent = format("Nelflow.State.AppliedAmount", {
      amount: row.appliedAmount,
    });
    const breakdown = formatResourceLossBreakdown(row.resourceLoss, format);
    if (breakdown) {
      resourceBreakdown = document.createElement("span");
      resourceBreakdown.className = "nelflow-stack__resource-breakdown";
      resourceBreakdown.textContent = breakdown;
    }
  }

  let damageResult = null;
  if (presentation.showDamage) {
    damageResult = document.createElement("div");
    damageResult.className = "nelflow-stack__damage-result";
    const damageHeading = document.createElement("span");
    damageHeading.className = "nelflow-stack__damage-heading";
    damageHeading.textContent = localize("Nelflow.Stack.DamageLabel");
    damageResult.append(damageHeading);
    if (presentation.damage) {
      const damageLabel = document.createElement("span");
      damageLabel.textContent = presentation.damage;
      damageResult.append(damageLabel);
    }
    if (row.transactionState !== TRANSACTION_STATES.SKIPPED) {
      damageResult.append(stateLabel);
      if (resourceBreakdown) damageResult.append(resourceBreakdown);
    }
  }

  let statusLine = null;
  if (!presentation.showDamage && row.transactionState !== TRANSACTION_STATES.SKIPPED) {
    statusLine = document.createElement("div");
    statusLine.className = "nelflow-stack__status";
    statusLine.append(stateLabel);
  }

  const riders = renderStrikeRiders(row, stack);
  let supplementalActions = null;
  if (riders) {
    // Rider section replaces the coarse Actions badge when structured notes exist.
  } else {
    supplementalActions = renderSupplementalActions(row, stackId);
  }

  const controls = document.createElement("div");
  controls.className = "nelflow-strike-controls";
  const inspection = resultsPanel(records);
  if (inspection) controls.append(inspection);

  if (canUseUndo(row, stack)) {
    const label = localize("Nelflow.Stack.UndoAppliedDamage");
    const undo = iconButton({
      className: "nelflow-stack__undo",
      iconClass: "fa-solid fa-rotate-left",
      label,
      title: label,
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
    controls.append(undo);
  }

  main.append(attackLine, attackResult);
  if (damageResult) main.append(damageResult);
  if (statusLine) main.append(statusLine);
  if (supplementalActions) {
    const auxiliary = document.createElement("div");
    auxiliary.className = "nelflow-stack__auxiliary";
    auxiliary.append(supplementalActions);
    main.append(auxiliary);
  }
  if (controls.childElementCount) main.append(controls);
  if (riders) main.append(riders);
  summary.append(image, main);
  item.append(summary);
  return item;
}

function batchTargetLabel(target) {
  if (!game.user.isGM || typeof fromUuidSync !== "function") return localize("Nelflow.Native.Target");
  const document = fromUuidSync(target.tokenUuid, { strict: false });
  return document?.name ?? document?.object?.name ?? localize("Nelflow.MultiTarget.TargetUnavailable");
}

function renderBatchRow(row, stack, records) {
  const item = document.createElement("li");
  item.className = "nelflow-stack__row nelflow-stack__row--batch";
  const summary = document.createElement("div");
  summary.className = "nelflow-stack__row-summary";
  const image = document.createElement("img");
  image.className = "nelflow-stack__strike-icon";
  image.src = row.strikeIcon;
  image.alt = "";
  const main = document.createElement("div");
  main.className = "nelflow-stack__main";
  const attack = document.createElement("div");
  attack.className = "nelflow-stack__attack";
  const name = document.createElement("strong");
  name.textContent = row.strikeName;
  const count = document.createElement("span");
  count.textContent = format("Nelflow.MultiTarget.TargetCount", { count: row.targets.length });
  attack.append(name, count);
  const map = mapText(row);
  if (map) {
    const mapLabel = document.createElement("span");
    mapLabel.className = "nelflow-stack__map";
    mapLabel.textContent = map;
    attack.append(mapLabel);
  }
  const targets = document.createElement("ul");
  targets.className = "nelflow-batch__targets";
  for (const target of row.targets) {
    const child = document.createElement("li");
    child.className = `nelflow-batch__target nelflow-batch__target--${target.state}`;
    const parts = [batchTargetLabel(target), target.outcome ? strikeOutcomeLabel(target.outcome) : localize("Nelflow.MultiTarget.Review")];
    if (game.user.isGM || canRevealNativeRecord(target.damageMessageId)) {
      const damage = formatDamageSummary(target.damageSummary);
      if (damage) parts.push(damage);
    }
    if (target.state === "applied") {
      parts.push(Number.isFinite(target.appliedAmount)
        ? format("Nelflow.MultiTarget.Applied", { amount: target.appliedAmount })
        : localize("Nelflow.State.Applied"));
    } else if (target.state === "review") parts.push(localize("Nelflow.MultiTarget.Review"));
    else if (target.state === "damage-rolled") parts.push(localize("Nelflow.State.NotApplied"));
    else if (target.state === "resolving") parts.push(localize("Nelflow.State.Resolving"));
    else if (target.state === "undone") parts.push(localize("Nelflow.State.Undone"));
    else if (target.state === "undo-blocked") parts.push(localize("Nelflow.State.UndoBlocked"));
    else if (target.flatCheckFailed) parts.push(localize("Nelflow.MultiTarget.FlatCheckFailed"));
    const text = document.createElement("span");
    text.textContent = parts.join(" · ");
    child.append(text);
    if (
      game.user.isGM &&
      game.user.id === stack.identity?.authorUserId &&
      getSetting(SETTINGS.ENABLE_UNDO) &&
      canUndoBatchChild(target)
    ) {
      const undo = labeledButton({
        className: "nelflow-batch__undo-target",
        iconClass: "fa-solid fa-rotate-left",
        label: localize("Nelflow.Status.Undo"),
      });
      undo.addEventListener("click", () => runControl(
        () => MultiTargetStrikeService.undoTarget(game.messages.get(row.attackMessageId), target.key),
        "batch-target-undo",
      ));
      child.append(undo);
    }
    targets.append(child);
  }
  const footer = document.createElement("div");
  footer.className = "nelflow-batch__footer";
  const inspection = resultsPanel(records);
  if (inspection) footer.append(inspection);
  if (
    game.user.isGM &&
    game.user.id === stack.identity?.authorUserId &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    row.targets.some(canUndoBatchChild)
  ) {
    const undoAll = labeledButton({
      className: "nelflow-batch__undo-all",
      iconClass: "fa-solid fa-rotate-left",
      label: localize("Nelflow.MultiTarget.UndoAll"),
    });
    undoAll.addEventListener("click", () => runControl(
      () => MultiTargetStrikeService.undoAll(game.messages.get(row.attackMessageId)),
      "batch-undo-all",
    ));
    footer.append(undoAll);
  }
  main.append(attack, targets, footer);
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
  const disclosure = document.createElement("button");
  disclosure.type = "button";
  disclosure.className = "nelflow-stack__disclosure";
  const actor = document.createElement("strong");
  actor.className = "nelflow-stack__actor";
  actor.textContent = inspectionTargetLabel({ tokenUuid: stack.actor?.tokenUuid }) ||
    localize("Nelflow.Stack.UnknownCombatant");
  disclosure.append(actor);
  if (stack.identity?.outOfTurn) {
    const context = document.createElement("span");
    context.className = "nelflow-stack__context";
    context.textContent = localize("Nelflow.Stack.OutOfTurn");
    disclosure.append(context);
  }
  const count = document.createElement("span");
  count.className = "nelflow-stack__count";
  count.textContent = format(
    (stack.rows?.length ?? 0) === 1 ? "Nelflow.Stack.RowCountOne" : "Nelflow.Stack.RowCountMany",
    { count: stack.rows?.length ?? 0 },
  );
  const chevron = document.createElement("i");
  chevron.setAttribute("aria-hidden", "true");
  disclosure.append(count, chevron);
  header.append(disclosure);

  const nativeRecords = NativeRecordsController.recordsForStack(stack);
  let nativeRecordsButton = null;
  if (nativeRecords.length && NativeRecordsController.shouldRenderControl()) {
    nativeRecordsButton = labeledButton({
      className: "nelflow-stack__native-records",
      iconClass: "fa-solid fa-chevron-down",
      label: format("Nelflow.Stack.Results", { count: nativeRecords.length }),
    });
    header.append(nativeRecordsButton);
  }

  const rows = document.createElement("ol");
  rows.className = "nelflow-stack__rows";
  rows.id = `nelflow-stack-rows-${message.id}`;
  rows.setAttribute("aria-label", localize("Nelflow.Stack.RowsAria"));
  disclosure.setAttribute("aria-controls", rows.id);
  for (const row of stack.rows ?? []) {
    rows.append(renderRow(row, stack, NativeRecordsController.recordsForRow(stack, row)));
  }
  article.append(header, rows);
  content.replaceChildren(article);
  html.classList.add("nelflow-stack-message");
  try {
    StackPresentationController.enhanceDisclosure({
      messageId: message.id, article, rows, button: disclosure, chevron,
    });
  } catch (error) {
    article.classList.remove("nelflow-stack--collapsed");
    rows.hidden = false;
    disclosure.setAttribute("aria-expanded", "true");
    chevron.className = "fa-solid fa-chevron-up";
    logger.debug("Stack disclosure failed open", {
      messageId: message.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (nativeRecordsButton) {
    NativeRecordsController.bindStackControl(stack, nativeRecordsButton, nativeRecords);
  }
  NativeRecordsController.markStackRendered(stack);
  // Mark the outer message only after every canonical enhancement succeeds.
  // The live-follow controller will never move a failed/fallback projection.
  html.dataset.nelflowStackId = message.id;
  html.dataset.nelflowStackRevision = stackRenderRevision(stack);
}

function stateLabel(state) {
  const keys = {
    [TRANSACTION_STATES.DETECTED]: "Nelflow.Status.Detected",
    [TRANSACTION_STATES.PROCESSING]: "Nelflow.Status.Processing",
    [TRANSACTION_STATES.SKIPPED]: "Nelflow.Status.Skipped",
    [TRANSACTION_STATES.DAMAGE_ROLLED]: "Nelflow.Status.DamageRolled",
    [TRANSACTION_STATES.AWAITING_IMPACT]: "Nelflow.Status.AwaitingImpact",
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
      TRANSACTION_STATES.AWAITING_IMPACT,
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
  // Character Strikes have one dedicated canonical presentation host. The
  // legacy NPC fallback would otherwise duplicate both status and guarded Undo.
  if (["player-strike", "multi-target-strike", "spell-attack"].includes(resolved?.transaction?.transactionType)) return;
  if (!resolved || !shouldRenderLegacy(localMarker, resolved.transaction)) return;

  const row = document.createElement("div");
  row.className = "nelflow-status";
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
  // 0.6.5 never inserts transaction internals into chat. Remove any stale
  // projection synchronously before rendering live or historical content.
  removeLegacyTransactionDiagnostics(html);
  let stack = null;
  try {
    renderAutoDamageRoll(message, html);
    renderToolbeltBasicSave(message, html);
    if (renderSaveResolverChat(message, html)) {
      renderTransactionRecovery(message, html);
      return;
    }
    stack = message.getFlag(MODULE_ID, "stack");
    if (stack) {
      if (!validStackProjection(stack)) throw new Error("Invalid persisted stack projection");
      if (canRenderStackForViewer(message)) renderStack(message, html, stack);
      renderTransactionRecovery(message, html);
      return;
    }
    if (!message.visible || !message.isContentVisible) return;
    if (!renderMultiTargetStrike(message, html)) {
      if (!renderPlayerStrike(message, html)) renderSpellAttack(message, html);
    }
    renderLegacyStatus(message, html);
    renderActionResultPresentation(message, html);
    NativeCardCompactor.render(message, html);
    renderTransactionRecovery(message, html);
  } catch (error) {
    removeLegacyTransactionDiagnostics(html);
    html.querySelectorAll(".nelflow-recovery").forEach((node) => node.remove());
    html.querySelectorAll("[data-nelflow-application-status]").forEach((node) => node.remove());
    failOpenAutoDamageRoll(html);
    html.classList.remove(
      "nelflow-native-record-hidden",
      "nelflow-native-collapsed",
      "nelflow-strike-canonical-host",
      "nelflow-save-native-hidden",
      "nelflow-action-collapsed",
      "nelflow-action-compact",
    );
    html.querySelectorAll(".nelflow-native-detail, .nelflow-native-header, .nelflow-action-native-detail, .nelflow-action-header").forEach((node) => {
      node.classList.remove("nelflow-native-detail", "nelflow-native-header", "nelflow-action-native-detail", "nelflow-action-header");
    });
    html.querySelector(":scope > .nelflow-action-summary")?.remove();
    NativeRecordsController.failOpen(stack?.id);
    failOpenSaveResolver(
      message.getFlag(MODULE_ID, "saveResolver")?.resolverId ??
        message.getFlag(MODULE_ID, "saveResolverNative")?.resolverId,
    );
    if (stack && canRenderStackForViewer(message)) {
      try {
        renderDurableStackFallback(message, html, stack);
      } catch {
        // Preserve the already stored fallback if even local fallback rendering fails.
      }
    }
    const reason = error instanceof Error ? error.message : "unexpected chat presentation failure";
    const key = `${message.id}:${reason}`;
    if (reportedRenderFailures.has(key)) return;
    reportedRenderFailures.add(key);
    logger.debug("Chat presentation failed open", {
      attackMessageId: message.id,
      stage: "renderChatMessageHTML",
      reason,
    });
  }
}
