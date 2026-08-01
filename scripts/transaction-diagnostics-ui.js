import { logger } from "./logger.js";
import { runNelflowBoundary } from "./nelflow-boundary.js";
import {
  buildSanitizedDiagnostic,
  copyDiagnosticWithFallback,
  diagnosticDescriptors,
  TransactionDiagnosticsService,
  transactionDiagnosticProjection,
} from "./transaction-diagnostics-service.js";
import { shortId } from "./transaction-failure.js";

function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function element(tag, className = null, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function field(list, key, value) {
  const term = element("dt", null, localize(key));
  const description = element("dd", null, value == null || value === "" ? "—" : String(value));
  list.append(term, description);
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
    window: { title: localize("Nelflow.Diagnostics.Copy") },
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
  for (const candidate of candidates) {
    const option = element("option");
    option.value = candidate.messageId;
    option.textContent = localize("Nelflow.Diagnostics.Candidate", {
      id: candidate.messageIdShort,
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

function actionButton(labelKey, handler, { disabled = false } = {}) {
  const button = element("button", "nelflow-diagnostics__action", localize(labelKey));
  button.type = "button";
  button.disabled = disabled;
  button.addEventListener("click", () => {
    button.disabled = true;
    void runNelflowBoundary({
      subsystem: "transaction-diagnostics",
      operation: labelKey,
      messageId: button.closest("[data-message-id]")?.dataset.messageId,
      task: handler,
    }).finally(() => {
      button.disabled = disabled;
    });
  });
  return button;
}

function recoveryControls(descriptor) {
  const controls = element("div", "nelflow-diagnostics__actions");
  if (descriptor.type === "toolbelt-application") {
    controls.append(actionButton("Nelflow.Diagnostics.Rescan", async () => {
      const result = await TransactionDiagnosticsService.recover(descriptor, "rescan-toolbelt");
      ui.notifications.info(localize("Nelflow.Notification.RescanResult", { result: result.result }));
    }));
  }
  if (descriptor.type === "autoroll") {
    controls.append(actionButton(
      "Nelflow.Diagnostics.ExistingDamage",
      () => selectExistingDamage(descriptor),
      { disabled: TransactionDiagnosticsService.candidates(descriptor).length === 0 },
    ));
  }
  controls.append(actionButton("Nelflow.Diagnostics.MarkManual", () =>
    TransactionDiagnosticsService.recover(descriptor, "mark-manual")));
  if (["autoroll", "toolbelt-application"].includes(descriptor.type)) {
    controls.append(actionButton("Nelflow.Diagnostics.ClearGuard", () =>
      TransactionDiagnosticsService.recover(descriptor, "clear-guard")));
  }
  controls.append(actionButton("Nelflow.Diagnostics.Abandon", async () => {
    if (await confirmAbandon()) return TransactionDiagnosticsService.recover(descriptor, "abandon");
    return false;
  }));
  controls.append(actionButton("Nelflow.Diagnostics.Copy", () => copyDiagnostic(descriptor)));
  return controls;
}

function transactionPanel(descriptor) {
  const projection = transactionDiagnosticProjection(descriptor);
  const stateKey = {
    ready: "Ready",
    "pending-save": "Waiting",
    observing: "Waiting",
    "awaiting-toolbelt-targets": "Waiting",
    applying: "Applying",
    "applying-damage": "Applying",
    applied: "Complete",
    complete: "Complete",
    completed: "Complete",
    interrupted: "Interrupted",
    ambiguous: "Ambiguous",
    error: "Failed",
    failed: "Failed",
    manual: "Manual",
    abandoned: "Abandoned",
  }[projection.state];
  const section = element("section", "nelflow-diagnostics__transaction");
  const list = element("dl", "nelflow-diagnostics__fields");
  field(list, "Nelflow.Diagnostics.Field.Version", projection.nelflowVersion);
  field(list, "Nelflow.Diagnostics.Field.Type", projection.type);
  field(list, "Nelflow.Diagnostics.Field.State", stateKey ? localize(`Nelflow.Diagnostics.Status.${stateKey}`) : projection.state);
  field(list, "Nelflow.Diagnostics.Field.SourceKind", projection.sourceKind);
  field(list, "Nelflow.Diagnostics.Field.SourceMessage", projection.sourceMessageIdShort);
  field(list, "Nelflow.Diagnostics.Field.DamageMessage", projection.damageMessageIdShort);
  field(list, "Nelflow.Diagnostics.Field.AuthorRole", projection.sourceAuthorRole);
  field(list, "Nelflow.Diagnostics.Field.AuthorityRole", projection.processingAuthorityRole);
  field(list, "Nelflow.Diagnostics.Field.Targets", projection.targetCount);
  field(list, "Nelflow.Diagnostics.Field.Saves", `${projection.resolvedSaveCount}/${projection.saveCount}`);
  field(list, "Nelflow.Diagnostics.Field.Applications", `${projection.completedApplicationCount}/${projection.applicationCount}`);
  field(list, "Nelflow.Diagnostics.Field.Undo", projection.undoAvailable ? localize("Nelflow.Diagnostics.Yes") : localize("Nelflow.Diagnostics.No"));
  field(list, "Nelflow.Diagnostics.Field.Autoroll", projection.autorollState);
  field(list, "Nelflow.Diagnostics.Field.Guard", projection.guardState);
  field(
    list,
    "Nelflow.Diagnostics.Field.Failure",
    projection.failure?.code
      ? `${projection.failure.code} · ${localize(`Nelflow.Failure.${projection.failure.code}`)}`
      : null,
  );
  field(list, "Nelflow.Diagnostics.Field.Recovery", projection.recovery.status);
  field(list, "Nelflow.Diagnostics.Field.Revision", projection.revision);
  section.append(list);
  const audit = element("ol", "nelflow-diagnostics__audit");
  for (const entry of projection.audit) {
    audit.append(element("li", null, localize("Nelflow.Diagnostics.AuditEntry", {
      revision: entry.revision,
      event: entry.event,
      state: entry.state,
    })));
  }
  if (audit.childElementCount) {
    section.append(element("strong", null, localize("Nelflow.Diagnostics.RecentAudit")), audit);
  }
  section.append(recoveryControls(descriptor));
  return section;
}

export function renderTransactionDiagnostics(message, html) {
  html.querySelectorAll(".nelflow-diagnostics").forEach((node) => node.remove());
  if (!game.user?.isGM || message.visible === false || message.isContentVisible === false) return false;
  const descriptors = diagnosticDescriptors(message);
  if (!descriptors.length) return false;
  try {
    const details = element("details", "nelflow-diagnostics");
    details.dataset.nelflowTransactionDetails = message.id;
    const summary = element("summary", "nelflow-diagnostics__summary", localize("Nelflow.Diagnostics.Details"));
    summary.setAttribute("aria-label", localize("Nelflow.Diagnostics.DetailsAria"));
    summary.addEventListener("click", () => {
      logger.debug("transaction-details-opened", {
        messageId: shortId(message.id),
        transactionType: descriptors.length === 1 ? descriptors[0].type : "stack",
        safeRole: "gm",
      });
    }, { once: true });
    details.append(summary);
    for (const descriptor of descriptors) details.append(transactionPanel(descriptor));
    (html.querySelector(".message-content") ?? html).append(details);
    return true;
  } catch (error) {
    logger.warn("transaction-details-render-failed", {
      attackMessageId: shortId(message.id),
      stage: "transaction-details",
      reason: error instanceof Error ? error.name : "unknown-error",
    });
    return false;
  }
}
