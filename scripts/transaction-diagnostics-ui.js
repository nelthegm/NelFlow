import { logger } from "./logger.js";
import { runNelflowBoundary } from "./nelflow-boundary.js";
import {
  buildSanitizedDiagnostic,
  copyDiagnosticWithFallback,
  diagnosticDescriptors,
  TransactionDiagnosticsService,
} from "./transaction-diagnostics-service.js";
import { shortId } from "./transaction-failure.js";
import { PLAYER_STRIKE_TRANSACTION_TYPE } from "./player-strike-model.js";
import { isPlayerStrikePresentationHost } from "./player-strike-presentation.js";
import {
  recoveryStatusKey,
  transactionNeedsRecoveryPresentation,
} from "./transaction-diagnostics-policy.js";

function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function element(tag, className = null, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Remove 0.6.4/legacy diagnostic projections before any new UI is appended. */
export function removeLegacyTransactionDiagnostics(html) {
  for (const node of html.querySelectorAll(
    ".nelflow-diagnostics, [data-nelflow-transaction-details]",
  )) node.remove();
}

async function showClipboardFallback(json) {
  const content = element("div", "nelflow-diagnostic-fallback");
  content.append(element("p", null, localize("Nelflow.Diagnostics.ClipboardFallback")));
  const textarea = element("textarea");
  textarea.readOnly = true;
  textarea.rows = 18;
  textarea.value = json;
  textarea.setAttribute("aria-label", localize("Nelflow.Diagnostics.JsonAria"));
  content.append(textarea);
  await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.Recovery.SupportInfo") },
    content,
    modal: true,
    rejectClose: false,
  });
}

async function copyDiagnostic(descriptor) {
  const json = JSON.stringify(buildSanitizedDiagnostic(descriptor), null, 2);
  const result = await copyDiagnosticWithFallback(json, {
    writeText: globalThis.navigator?.clipboard?.writeText
      ? (value) => navigator.clipboard.writeText(value)
      : null,
    showFallback: showClipboardFallback,
  });
  if (result.copied) {
    ui.notifications.info("Nelflow.Notification.DiagnosticCopied", { localize: true });
  }
  logger.debug("transaction-diagnostic-copied", {
    transactionId: shortId(descriptor.id),
    messageId: shortId(descriptor.ownerMessage.id),
    transactionType: descriptor.type,
    state: descriptor.transaction.state ?? descriptor.transaction.phase,
    safeRole: "gm",
  });
}

async function confirmAbandon() {
  const content = element("div");
  content.append(element("p", null, localize("Nelflow.Diagnostics.AbandonWarning")));
  return foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.Diagnostics.Abandon") },
    content,
    modal: true,
    rejectClose: false,
  });
}

async function selectExistingDamage(descriptor) {
  const candidates = TransactionDiagnosticsService.candidates(descriptor);
  if (!candidates.length) {
    ui.notifications.warn("Nelflow.Notification.NoCompatibleDamage", { localize: true });
    return false;
  }
  const content = element("div", "nelflow-diagnostic-candidates");
  content.append(element("p", null, localize("Nelflow.Diagnostics.ExistingDamageWarning")));
  const select = element("select");
  select.setAttribute("aria-label", localize("Nelflow.Diagnostics.ExistingDamage"));
  for (const [index, candidate] of candidates.entries()) {
    const option = element("option");
    option.value = candidate.messageId;
    option.textContent = localize("Nelflow.Recovery.Candidate", {
      number: index + 1,
      role: candidate.authorRole,
      targets: candidate.targetCount,
      created: candidate.createdAt ?? "—",
    });
    select.append(option);
  }
  content.append(select);
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.Diagnostics.ExistingDamage") },
    content,
    modal: true,
    rejectClose: false,
  });
  if (!confirmed || !select.value) return false;
  return (await TransactionDiagnosticsService.recover(descriptor, "use-existing-damage", {
    damageMessageId: select.value,
  })).ok;
}

function actionButton(labelKey, descriptor, handler, { disabled = false } = {}) {
  const button = element("button", "nelflow-recovery-dialog__action", localize(labelKey));
  button.type = "button";
  button.disabled = disabled;
  button.addEventListener("click", () => {
    button.disabled = true;
    void runNelflowBoundary({
      subsystem: "transaction-recovery",
      operation: labelKey,
      messageId: descriptor.ownerMessage?.id,
      task: handler,
    }).finally(() => {
      button.disabled = disabled;
    });
  });
  return button;
}

function recoveryControls(descriptor) {
  const controls = element("div", "nelflow-recovery-dialog__actions");
  const state = descriptor.transaction.state ?? descriptor.transaction.phase;
  const playerStrikeRecovery = descriptor.type === "player-strike" && [
    "manual", "ambiguous", "failed", "interrupted",
  ].includes(state);
  if (descriptor.type === "toolbelt-application") {
    controls.append(actionButton("Nelflow.Diagnostics.Rescan", descriptor, async () => {
      const result = await TransactionDiagnosticsService.recover(descriptor, "rescan-toolbelt");
      ui.notifications.info(localize("Nelflow.Notification.RescanResult", { result: result.result }));
    }));
  }
  if (playerStrikeRecovery) {
    controls.append(actionButton("Nelflow.Diagnostics.RescanPlayerStrike", descriptor, async () => {
      const result = await TransactionDiagnosticsService.recover(descriptor, "rescan-player-strike");
      ui.notifications.info(localize("Nelflow.Notification.PlayerStrikeRescanResult", { result: result.result }));
    }));
  }
  if (descriptor.type === "autoroll" || playerStrikeRecovery) {
    controls.append(actionButton(
      "Nelflow.Diagnostics.ExistingDamage",
      descriptor,
      () => selectExistingDamage(descriptor),
      { disabled: TransactionDiagnosticsService.candidates(descriptor).length === 0 },
    ));
  }
  if (descriptor.type !== "player-strike" || playerStrikeRecovery) {
    controls.append(actionButton("Nelflow.Diagnostics.MarkManual", descriptor, () =>
      TransactionDiagnosticsService.recover(descriptor, "mark-manual")));
  }
  if (["autoroll", "toolbelt-application"].includes(descriptor.type)) {
    controls.append(actionButton("Nelflow.Diagnostics.ClearGuard", descriptor, () =>
      TransactionDiagnosticsService.recover(descriptor, "clear-guard")));
  }
  if (descriptor.type !== "player-strike" || playerStrikeRecovery) {
    controls.append(actionButton("Nelflow.Diagnostics.Abandon", descriptor, async () => {
      if (await confirmAbandon()) return TransactionDiagnosticsService.recover(descriptor, "abandon");
      return false;
    }));
  }
  controls.append(actionButton("Nelflow.Recovery.SupportInfo", descriptor, () =>
    copyDiagnostic(descriptor)));
  return controls;
}

async function showRecoveryReview(descriptors) {
  const content = element("div", "nelflow-recovery-dialog");
  content.append(element("p", null, localize("Nelflow.Recovery.DialogHint")));
  for (const descriptor of descriptors) {
    const item = element("section", "nelflow-recovery-dialog__item");
    item.append(element("p", null, localize(recoveryStatusKey(descriptor))));
    item.append(recoveryControls(descriptor));
    content.append(item);
  }
  return foundry.applications.api.DialogV2.confirm({
    window: { title: localize("Nelflow.Recovery.DialogTitle") },
    content,
    modal: true,
    rejectClose: false,
  });
}

function currentViewerDescriptors(message) {
  return diagnosticDescriptors(message).filter((descriptor) => {
    if (!transactionNeedsRecoveryPresentation(descriptor)) return false;
    if (descriptor.type !== PLAYER_STRIKE_TRANSACTION_TYPE) return true;
    return isPlayerStrikePresentationHost(message.id, descriptor.transaction, (messageId) => {
      const candidate = message.id === messageId ? message : game.messages?.get(messageId);
      return Boolean(candidate?.visible && candidate.isContentVisible);
    });
  });
}

/**
 * Render only concise, player-facing recovery status. Structured diagnostics,
 * identifiers, audit records, and correlation evidence are never inserted into
 * ordinary ChatMessage HTML; authorized support export remains in the dialog.
 */
export function renderTransactionRecovery(message, html) {
  removeLegacyTransactionDiagnostics(html);
  html.querySelectorAll(".nelflow-recovery").forEach((node) => node.remove());
  if (!game.user?.isGM || message.visible === false || message.isContentVisible === false) {
    return false;
  }
  const descriptors = currentViewerDescriptors(message);
  if (!descriptors.length) return false;
  const wrapper = element("aside", "nelflow-recovery");
  wrapper.setAttribute("role", "status");
  for (const descriptor of descriptors) {
    const item = element("div", "nelflow-recovery__item");
    item.append(element("span", "nelflow-recovery__status", localize(recoveryStatusKey(descriptor))));
    const review = element("button", "nelflow-recovery__review", localize("Nelflow.Recovery.Review"));
    review.type = "button";
    review.setAttribute("aria-label", localize("Nelflow.Recovery.ReviewAria"));
    review.addEventListener("click", () => {
      logger.debug("transaction-recovery-review-opened", {
        messageId: shortId(descriptor.ownerMessage?.id),
        transactionType: descriptor.type,
        safeRole: "gm",
      });
      void runNelflowBoundary({
        subsystem: "transaction-recovery",
        operation: "open-review",
        messageId: descriptor.ownerMessage?.id,
        task: () => showRecoveryReview([descriptor]),
      });
    });
    item.append(review);
    wrapper.append(item);
  }
  (html.querySelector(".message-content") ?? html).append(wrapper);
  return true;
}
