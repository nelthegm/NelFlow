import { TRANSACTION_STATES } from "./constants.js";
import {
  formatDamageSummary,
  formatMap,
  strikeOutcomeLabel,
} from "./presentation-format.js";

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function recipientIds(visibility) {
  return Array.from(visibility?.whisper ?? [])
    .map((recipient) => (typeof recipient === "string" ? recipient : recipient?.id))
    .filter(Boolean);
}

/**
 * Stored content is one document shared by all recipients. Only GM-only
 * messages may persist names, damage, HP deltas, or rider counts that the
 * viewer-specific enhanced projection can otherwise reveal selectively.
 */
function isGmOnlyAudience(visibility) {
  const recipients = recipientIds(visibility);
  return Boolean(
    recipients.length &&
      recipients.every((userId) => game.users?.get(userId)?.isGM === true),
  );
}

function rowStateText(row, includePrivateData) {
  if (row.presentationError || row.transactionState === TRANSACTION_STATES.FAILED) {
    return localize("Nelflow.State.Error");
  }
  if (row.transactionState === TRANSACTION_STATES.PROCESSING) {
    return localize("Nelflow.State.Resolving");
  }
  if (row.transactionState === TRANSACTION_STATES.SKIPPED) return "";
  if (row.transactionState === TRANSACTION_STATES.DAMAGE_ROLLED) {
    return localize(
      row.autoApplyRequested
        ? "Nelflow.State.PendingApplication"
        : "Nelflow.State.NotApplied",
    );
  }
  if (row.transactionState === TRANSACTION_STATES.APPLIED) {
    if (row.undoBlocked) return localize("Nelflow.State.UndoBlocked");
    return includePrivateData && Number.isFinite(row.appliedAmount)
      ? format("Nelflow.State.AppliedAmount", { amount: row.appliedAmount })
      : localize("Nelflow.State.Applied");
  }
  if (row.transactionState === TRANSACTION_STATES.UNDONE) {
    return localize("Nelflow.State.Undone");
  }
  return localize("Nelflow.State.Error");
}

function fallbackRow(row, includePrivateData) {
  const map = formatMap(row);
  const target = includePrivateData
    ? row.targetName ?? localize("Nelflow.Native.Target")
    : localize("Nelflow.Native.Target");
  const attack = [
    `<strong>${escapeHtml(row.strikeName ?? localize("Nelflow.Stack.UnknownStrike"))}</strong>`,
    map ? `<span>${escapeHtml(map)}</span>` : "",
    `<span>${escapeHtml(format("Nelflow.Stack.Target", { target }))}</span>`,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const resultParts = [strikeOutcomeLabel(row.outcome)];
  if (includePrivateData) {
    const damage = formatDamageSummary(row.damageSummary);
    if (damage) resultParts.push(damage);
  }
  const state = rowStateText(row, includePrivateData);
  if (state) resultParts.push(state);

  const awareness = row.supplementalActions;
  const supplemental =
    includePrivateData && Number.isFinite(awareness?.count) && awareness.count > 0
      ? `<div class="nelflow-stack-fallback__actions">${escapeHtml(
          format("Nelflow.Fallback.AdditionalActions", { count: awareness.count }),
        )}</div>`
      : "";

  return [
    '<li class="nelflow-stack-fallback__row">',
    `<div class="nelflow-stack-fallback__attack">${attack}</div>`,
    `<div class="nelflow-stack-fallback__result">${resultParts
      .map(escapeHtml)
      .join(" &mdash; ")}</div>`,
    supplemental,
    "</li>",
  ].join("");
}

function visibilityFromMessage(message) {
  return {
    blind: Boolean(message?._source?.blind ?? message?.blind),
    whisper: Array.from(message?._source?.whisper ?? message?.whisper ?? []),
  };
}

/** Generate semantic, non-interactive, privacy-conservative stored HTML. */
export function buildDurableStackContent(stack, visibility) {
  const includePrivateData = isGmOnlyAudience(visibility);
  const heading =
    stack.kind === "combat-turn"
      ? format("Nelflow.Stack.Round", { round: stack.identity?.round ?? "?" })
      : localize("Nelflow.Stack.Standalone");
  const rows = (stack.rows ?? []).map((row) => fallbackRow(row, includePrivateData)).join("");
  return [
    `<article class="nelflow-stack-fallback" data-schema-version="${escapeHtml(
      stack.schemaVersion ?? 1,
    )}">`,
    `<header><strong>${escapeHtml(heading)}</strong></header>`,
    `<ol aria-label="${escapeHtml(localize("Nelflow.Stack.RowsAria"))}">${rows}</ol>`,
    "</article>",
  ].join("");
}

/** Replace only the pending rendered stack body; never update a document. */
export function renderDurableStackFallback(message, html, stack) {
  const content = html.querySelector(".message-content") ?? html;
  const template = document.createElement("template");
  template.innerHTML = buildDurableStackContent(stack, visibilityFromMessage(message));
  content.replaceChildren(template.content.cloneNode(true));
}

export function stackVisibility(message) {
  return visibilityFromMessage(message);
}
