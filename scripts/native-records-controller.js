import {
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_FIRST_NATIVE_RECORD_MODES,
} from "./constants.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";

const resultsOpenByStack = new Map();
const failedStacks = new Set();
let initialized = false;

const ROLE_FIELDS = Object.freeze({
  attack: "attackMessageId",
  damage: "damageMessageId",
  application: "applicationMessageId",
});

const INSPECTION_ROLES = new Set(["attack", "damage"]);

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function stackFirstEnabled() {
  return (
    getSetting(SETTINGS.COMPACT_TURN_STACKS) === COMPACT_STACK_MODES.NPC_STRIKES &&
    getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS) &&
    getSetting(SETTINGS.STACK_FIRST_NATIVE_RECORDS) ===
      STACK_FIRST_NATIVE_RECORD_MODES.HIDE_BEHIND_STACK
  );
}

function resultsEnabled() {
  return getSetting(SETTINGS.COMPACT_TURN_STACKS) === COMPACT_STACK_MODES.NPC_STRIKES;
}

function visibleMessage(message) {
  return Boolean(message?.visible && message.isContentVisible);
}

function exactRecord(stack, row, role) {
  const messageId = row[ROLE_FIELDS[role]];
  const message = messageId ? game.messages.get(messageId) : null;
  if (!visibleMessage(message)) return null;

  const marker = message.getFlag(MODULE_ID, "transaction");
  const resolved = TransactionStore.resolveCanonical(message);
  if (
    marker?.role !== role ||
    marker.id !== row.transactionId ||
    resolved?.transaction.id !== row.transactionId ||
    resolved.transaction[ROLE_FIELDS[role]] !== messageId ||
    resolved.transaction.stackRef?.id !== stack.id
  ) {
    return null;
  }
  return { id: messageId, marker, message, role, transaction: resolved.transaction, transactionId: row.transactionId };
}

function exactBatchRecords(stack, row) {
  const records = [];
  const candidates = [
    { id: row.attackMessageId, role: "attack" },
    ...(row.damageMessageIds ?? []).map((id) => ({ id, role: "damage" })),
    ...(row.applicationMessageIds ?? []).map((id) => ({ id, role: "application" })),
  ];
  for (const candidate of candidates) {
    const message = candidate.id ? game.messages.get(candidate.id) : null;
    if (!visibleMessage(message)) continue;
    const marker = message.getFlag(MODULE_ID, "transaction");
    const resolved = TransactionStore.resolveCanonical(message);
    const transaction = resolved?.transaction;
    const exact = candidate.role === "attack"
      ? transaction?.attackMessageId === candidate.id
      : candidate.role === "damage"
        ? Object.values(transaction?.damageGroups ?? {}).some((group) => group?.damageMessageId === candidate.id)
        : transaction?.targets?.some((target) => target.applicationMessageId === candidate.id);
    if (
      marker?.role === candidate.role &&
      marker.id === row.transactionId &&
      transaction?.id === row.transactionId &&
      transaction.stackRef?.id === stack.id &&
      exact
    ) records.push({ ...candidate, marker, message, transaction, transactionId: row.transactionId });
  }
  return records;
}

function renderedMessage(messageId) {
  return Array.from(document.querySelectorAll("[data-message-id]")).find(
    (element) => element.dataset.messageId === messageId,
  );
}

function renderedNativeRecords(stackId) {
  return Array.from(document.querySelectorAll("[data-nelflow-native-stack-id]")).filter(
    (element) => element.dataset.nelflowNativeStackId === stackId,
  );
}

function renderedControls(stackId) {
  return Array.from(
    document.querySelectorAll("[data-nelflow-native-records-stack-id]"),
  ).filter((element) => element.dataset.nelflowNativeRecordsStackId === stackId);
}

function updateControl(button, stackId, count, visible) {
  const label = format("Nelflow.Stack.Results", { count });
  const actionLabel = localize(
    visible ? "Nelflow.Stack.HideResults" : "Nelflow.Stack.ShowResults",
  );
  button.dataset.nelflowNativeRecordsStackId = stackId;
  button.dataset.nelflowNativeRecordCount = String(count);
  button.title = actionLabel;
  button.setAttribute("aria-label", `${label}: ${actionLabel}`);
  button.setAttribute("aria-expanded", String(visible));
  const text = button.querySelector("span");
  if (text) text.textContent = label;
  const icon = button.querySelector("i");
  icon?.classList.toggle("fa-chevron-up", visible);
  icon?.classList.toggle("fa-chevron-down", !visible);
}

function applyVisibility(stackId, pendingControl = null) {
  const controls = renderedControls(stackId);
  if (pendingControl && !controls.includes(pendingControl)) controls.push(pendingControl);
  const visible = resultsOpenByStack.get(stackId) === true;
  for (const article of document.querySelectorAll(".nelflow-stack[data-stack-id]")) {
    if (article.dataset.stackId === stackId) article.classList.toggle("nelflow-stack--results-open", visible);
  }
  for (const button of controls) {
    const count = Number(button.dataset.nelflowNativeRecordCount) || 0;
    updateControl(button, stackId, count, visible);
  }
}

function exactTransactionRecords(transaction) {
  const candidates = transaction?.transactionType === "multi-target-strike"
    ? (transaction.linkedMessageIds ?? []).map((id) => ({ id }))
    : [transaction?.attackMessageId, transaction?.damageMessageId, transaction?.applicationMessageId]
        .filter(Boolean)
        .map((id) => ({ id }));
  const records = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const message = game.messages?.get(candidate.id);
    if (!visibleMessage(message)) continue;
    const marker = message.getFlag?.(MODULE_ID, "transaction");
    const resolved = TransactionStore.resolveCanonical(message);
    if (marker?.id !== transaction.id || resolved?.transaction?.id !== transaction.id) continue;
    let exact = false;
    if (marker.role === "attack") exact = transaction.attackMessageId === message.id;
    else if (marker.role === "damage") {
      exact = transaction.transactionType === "multi-target-strike"
        ? transaction.damageGroups?.[marker.damageGroup]?.damageMessageId === message.id
        : transaction.damageMessageId === message.id;
    } else if (marker.role === "application") {
      exact = transaction.transactionType === "multi-target-strike"
        ? transaction.targets?.find((target) => target.key === marker.targetKey)?.applicationMessageId === message.id
        : transaction.applicationMessageId === message.id;
    }
    if (exact) records.push({ id: message.id, marker, message, role: marker.role, transaction });
  }
  return records;
}

export class NativeRecordsController {
  static initialize() {
    if (initialized) return;
    initialized = true;
    Hooks.on("deleteChatMessage", (message) => {
      const saveResolver = message.getFlag(MODULE_ID, "saveResolver");
      if (saveResolver?.resolverId) {
        for (const element of document.querySelectorAll("[data-nelflow-save-resolver-id]")) {
          if (element.dataset.nelflowSaveResolverId !== saveResolver.resolverId) continue;
          element.classList.remove("nelflow-save-native-hidden", "nelflow-save-native-collapsed");
          delete element.dataset.nelflowSaveResolverId;
        }
      }
      const stack = message.getFlag(MODULE_ID, "stack");
      if (!stack?.id) return;
      for (const element of renderedNativeRecords(stack.id)) {
        element.classList.remove("nelflow-native-record-hidden");
        delete element.dataset.nelflowNativeStackId;
      }
      resultsOpenByStack.delete(stack.id);
      failedStacks.delete(stack.id);
    });
    Hooks.on("nelflowPresentationSettingChanged", () => {
      resultsOpenByStack.clear();
      failedStacks.clear();
      for (const element of document.querySelectorAll(".nelflow-linked-native")) {
        element.classList.remove("nelflow-native-record-hidden");
        if (!getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS)) {
          element.classList.remove("nelflow-native-collapsed");
        }
      }
      for (const element of document.querySelectorAll(".nelflow-save-native-hidden")) {
        element.classList.remove("nelflow-save-native-hidden");
      }
      if (!getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS)) {
        for (const element of document.querySelectorAll(".nelflow-save-native-collapsed")) {
          element.classList.remove("nelflow-save-native-collapsed");
        }
      }
      try {
        const renderResult = ui.chat?.render?.({ force: true });
        if (typeof renderResult?.catch === "function") {
          void renderResult.catch(() => undefined);
        }
      } catch {
        // The fail-open class removal above keeps every native record visible.
      }
    });
  }

  static shouldRenderControl() {
    return resultsEnabled();
  }

  static shouldSuppressLinkedCards() {
    return (
      getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS) &&
      getSetting(SETTINGS.STACK_FIRST_NATIVE_RECORDS) ===
        STACK_FIRST_NATIVE_RECORD_MODES.HIDE_BEHIND_STACK
    );
  }

  static recordsForStack(stack) {
    return this.linkedRecordsForStack(stack).filter((record) => INSPECTION_ROLES.has(record.role));
  }

  static recordsForRow(stack, row) {
    if (!stack || !row) return [];
    const records = row.batch
      ? exactBatchRecords(stack, row)
      : Object.keys(ROLE_FIELDS).map((role) => exactRecord(stack, row, role)).filter(Boolean);
    return records.filter((record) => INSPECTION_ROLES.has(record.role));
  }

  static linkedRecordsForStack(stack) {
    const records = [];
    const seen = new Set();
    for (const row of stack.rows ?? []) {
      if (row.batch) {
        for (const record of exactBatchRecords(stack, row)) {
          if (seen.has(record.id)) continue;
          seen.add(record.id);
          records.push(record);
        }
        continue;
      }
      for (const role of Object.keys(ROLE_FIELDS)) {
        const record = exactRecord(stack, row, role);
        if (!record || seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
      }
    }
    return records;
  }

  static bindStackControl(stack, button, records) {
    if (!resultsEnabled() || !records.length) return;

    updateControl(button, stack.id, records.length, resultsOpenByStack.get(stack.id) === true);
    button.addEventListener("click", () => {
      if (resultsOpenByStack.get(stack.id) === true) resultsOpenByStack.delete(stack.id);
      else resultsOpenByStack.set(stack.id, true);
      applyVisibility(stack.id, button);
    });
    applyVisibility(stack.id, button);
  }

  static recordsForTransaction(transaction) {
    return exactTransactionRecords(transaction).filter((record) => INSPECTION_ROLES.has(record.role));
  }

  static linkedRecordsForTransaction(transaction) {
    return exactTransactionRecords(transaction);
  }

  static refreshRecord(record) {
    if (!record?.id || !record.transaction) return null;
    return exactTransactionRecords(record.transaction).find(
      (candidate) => candidate.id === record.id && candidate.role === record.role,
    ) ?? null;
  }

  static registerNative(html, messageId, linked) {
    const stackId = linked.transaction.stackRef?.id;
    const stackMessage = stackId ? game.messages.get(stackId) : null;
    const stack = stackMessage?.getFlag(MODULE_ID, "stack");
    if (
      !stack ||
      stack.id !== stackId ||
      !visibleMessage(stackMessage) ||
      !this.linkedRecordsForStack(stack).some((record) => record.id === messageId)
    ) {
      return false;
    }
    html.dataset.nelflowNativeStackId = stackId;
    const hide = stackFirstEnabled() && !failedStacks.has(stackId);
    html.classList.toggle("nelflow-native-record-hidden", hide);
    return hide;
  }

  static restoreNative(html) {
    html.classList.remove("nelflow-native-record-hidden");
    delete html.dataset.nelflowNativeStackId;
  }

  static markStackRendered(stack) {
    if (!stack?.id) return;
    failedStacks.delete(stack.id);
    for (const record of this.linkedRecordsForStack(stack)) {
      const element = renderedMessage(record.id);
      if (!element?.classList.contains("nelflow-linked-native")) continue;
      element.dataset.nelflowNativeStackId = stack.id;
      element.classList.toggle("nelflow-native-record-hidden", stackFirstEnabled());
    }
  }

  static failOpen(stackId) {
    if (!stackId) return;
    failedStacks.add(stackId);
    for (const element of renderedNativeRecords(stackId)) {
      element.classList.remove("nelflow-native-record-hidden");
    }
  }
}
