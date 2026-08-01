import { MODULE_ID, SETTINGS } from "./constants.js";
import { logger } from "./logger.js";
import { NativeRecordsController } from "./native-records-controller.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { formatDamageSummary, strikeOutcomeLabel } from "./presentation-format.js";
import { getSetting } from "./settings.js";
import { SupplementalActionAwareness } from "./supplemental-action-awareness.js";
import { TransactionStore } from "./transaction-store.js";

const reportedFailures = new Set();

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function debugFailureOnce(message, reason) {
  const key = `${message.id}:${reason}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  logger.debug("Native card compaction skipped", {
    messageId: message.id,
    stage: "native-card-render",
    reason,
  });
}

function identifyLinkedMessage(message) {
  const toolbeltMarker = message.getFlag(MODULE_ID, "saveResolverNative");
  if (toolbeltMarker?.role === "toolbelt-application" && toolbeltMarker.damageMessageId) {
    const parent = game.messages.get(toolbeltMarker.damageMessageId);
    const integration = parent?.getFlag(MODULE_ID, "toolbeltBasicSave");
    const target = integration?.targets?.[toolbeltMarker.targetKey];
    if (
      integration?.integrationId === toolbeltMarker.integrationId &&
      target?.applicationMessageId === message.id
    ) {
      const canSeeAmount = Boolean(
        game.user.isGM || message.token?.actor?.isOwner || message.token?.hasPlayerOwner,
      );
      return {
        marker: { id: target.applicationId, role: "application" },
        transaction: {
          id: target.applicationId,
          applicationMessageId: message.id,
          appliedAmount: canSeeAmount ? target.actualHpDelta : null,
          targetName: null,
          stackRef: null,
        },
        canonicalMessage: parent,
      };
    }
  }
  const marker = message.getFlag(MODULE_ID, "transaction");
  if (!marker?.id || !["attack", "damage", "application"].includes(marker.role)) return null;
  const resolved = TransactionStore.resolveCanonical(message);
  if (!resolved || resolved.transaction.id !== marker.id) return null;
  // Slice 4 keeps player-facing native Damage/Critical Damage controls fully
  // visible. Player Strike status is additive and never enters an NPC stack.
  if (resolved.transaction.transactionType === "player-strike") return null;

  const expectedIds = {
    attack: resolved.transaction.attackMessageId,
    damage: resolved.transaction.damageMessageId,
    application: resolved.transaction.applicationMessageId,
  };
  if (!expectedIds[marker.role] || expectedIds[marker.role] !== message.id) return null;
  return { marker, ...resolved };
}

/**
 * PF2e may obscure token names for players. Use the persisted name only when
 * the current viewer is a GM or PF2e reports that the rendered token name is
 * visible; otherwise use a neutral localized label.
 */
function visibleApplicationTarget(message, transaction) {
  const recorded =
    transaction.targetName ??
    transaction.snapshot?.targetName ??
    localize("Nelflow.Native.Target");
  if (game.user.isGM) return recorded;
  const token = message.token;
  const nameVisibilityEnabled = Boolean(game.pf2e?.settings?.tokens?.nameVisibility);
  if (token && (!nameVisibilityEnabled || token.playersCanSeeName)) {
    return recorded;
  }
  return localize("Nelflow.Native.Target");
}

function visibleRecordedTarget(transaction) {
  if (!game.user.isGM) return localize("Nelflow.Native.Target");
  return (
    transaction.targetName ??
    transaction.snapshot?.targetName ??
    localize("Nelflow.Native.Target")
  );
}

function summaryText(message, role, transaction) {
  const strike = transaction.snapshot?.strikeName ?? localize("Nelflow.Stack.UnknownStrike");
  if (role === "attack") {
    return format("Nelflow.Native.AttackSummary", {
      strike,
      target: visibleRecordedTarget(transaction),
      outcome: strikeOutcomeLabel(transaction.snapshot?.outcome),
    });
  }
  if (role === "damage") {
    const rollSummary =
      transaction.damageSummary ??
      PF2eAdapter.summarizeDamageRoll(message.rolls?.find((roll) => roll?.instances));
    const damage = formatDamageSummary(rollSummary);
    return damage
      ? format("Nelflow.Native.DamageSummary", { strike, damage })
      : format("Nelflow.Native.DamageSummaryUnavailable", { strike });
  }

  const target = visibleApplicationTarget(message, transaction);
  return Number.isFinite(transaction.appliedAmount)
    ? format("Nelflow.Native.ApplicationSummary", {
        target,
        amount: transaction.appliedAmount,
      })
    : format("Nelflow.Native.ApplicationSummaryUnavailable", { target });
}

function makeToggle() {
  const label = localize("Nelflow.Native.ShowDetails");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nelflow-native-toggle";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-chevron-down";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.append(icon, text);
  return button;
}

function setExpanded(element, expanded) {
  element.classList.toggle("nelflow-native-collapsed", !expanded);
  const button = element.querySelector(":scope > .nelflow-native-summary .nelflow-native-toggle");
  if (!button) return;

  const label = localize(expanded ? "Nelflow.Native.HideDetails" : "Nelflow.Native.ShowDetails");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", String(expanded));
  const text = button.querySelector("span");
  if (text) text.textContent = label;
  const toggleIcon = button.querySelector("i");
  toggleIcon?.classList.toggle("fa-chevron-up", expanded);
  toggleIcon?.classList.toggle("fa-chevron-down", !expanded);
}

function restoreFullCard(html) {
  NativeRecordsController.restoreNative(html);
  html.classList.remove(
    "nelflow-linked-native",
    "nelflow-native-collapsed",
    "nelflow-native-highlight",
  );
  html.querySelector(":scope > .nelflow-native-summary")?.remove();
  for (const element of html.querySelectorAll(
    ".nelflow-native-detail, .nelflow-native-header",
  )) {
    element.classList.remove("nelflow-native-detail", "nelflow-native-header");
  }
}

function compactCard(message, html, linked) {
  const directChildren = Array.from(html.children);
  const header = directChildren.find((element) => element.classList.contains("message-header"));
  const content = directChildren.find((element) => element.classList.contains("message-content"));
  if (!header || !content) {
    debugFailureOnce(message, "standard direct message header/content not available");
    return;
  }

  if (linked.marker.role === "attack") {
    SupplementalActionAwareness.inspectLinkedAttackDom(message, content, linked.transaction);
  }

  const summary = document.createElement("div");
  summary.className = `nelflow-native-summary nelflow-native-summary--${linked.marker.role}`;
  summary.dataset.nelflowRole = linked.marker.role;
  const text = document.createElement("span");
  text.className = "nelflow-native-summary__text";
  text.textContent = summaryText(message, linked.marker.role, linked.transaction);
  const button = makeToggle();
  button.addEventListener("click", () => {
    setExpanded(html, html.classList.contains("nelflow-native-collapsed"));
  });
  summary.append(text, button);

  // Mutate only the pending rendered HTMLElement. The stored PF2e content and
  // its native listener-bearing descendants remain untouched.
  header.after(summary);
  header.classList.add("nelflow-native-header");
  content.classList.add("nelflow-native-detail");
  html.classList.add("nelflow-linked-native", "nelflow-native-collapsed");
  NativeRecordsController.registerNative(html, message.id, linked);
}

function findRenderedMessage(messageId) {
  return Array.from(document.querySelectorAll("[data-message-id]")).find(
    (element) => element.dataset.messageId === messageId,
  );
}

export class NativeCardCompactor {
  static render(message, html) {
    const existing = html.querySelector(":scope > .nelflow-native-summary");
    if (!getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS)) {
      if (existing) restoreFullCard(html);
      else NativeRecordsController.restoreNative(html);
      return;
    }

    const linked = identifyLinkedMessage(message);
    if (!linked || !message.visible || !message.isContentVisible) {
      if (existing) restoreFullCard(html);
      else NativeRecordsController.restoreNative(html);
      return;
    }
    if (existing) {
      NativeRecordsController.registerNative(html, message.id, linked);
      return;
    }

    try {
      compactCard(message, html, linked);
    } catch (error) {
      restoreFullCard(html);
      debugFailureOnce(
        message,
        error instanceof Error ? error.message : "unexpected presentation failure",
      );
    }
  }

  static reveal(messageId, { focus = false, highlight = false } = {}) {
    const element = findRenderedMessage(messageId);
    if (!element) return false;
    if (element.querySelector(":scope > .nelflow-native-summary")) setExpanded(element, true);
    element.classList.remove("nelflow-native-highlight");
    if (highlight) {
      void element.offsetWidth;
      element.classList.add("nelflow-native-highlight");
    }
    element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (focus) {
      if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
      element.focus({ preventScroll: true });
    }
    return true;
  }
}
