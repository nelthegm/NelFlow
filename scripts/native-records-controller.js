import {
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_FIRST_NATIVE_RECORD_MODES,
} from "./constants.js";
import { getSetting } from "./settings.js";
import { TransactionStore } from "./transaction-store.js";

const visibleByStack = new Map();
let initialized = false;

const ROLE_FIELDS = Object.freeze({
  attack: "attackMessageId",
  damage: "damageMessageId",
  application: "applicationMessageId",
});

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
  return { id: messageId, message, role, transactionId: row.transactionId };
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
  const label = format("Nelflow.Stack.NativeRecords", { count });
  const actionLabel = localize(
    visible ? "Nelflow.Stack.HideNativeRecords" : "Nelflow.Stack.ShowNativeRecords",
  );
  button.dataset.nelflowNativeRecordsStackId = stackId;
  button.dataset.nelflowNativeRecordCount = String(count);
  button.title = actionLabel;
  button.setAttribute("aria-label", `${label}: ${actionLabel}`);
  button.setAttribute("aria-expanded", String(visible));
  const text = button.querySelector("span");
  if (text) text.textContent = label;
  const icon = button.querySelector("i");
  icon?.classList.toggle("fa-folder-open", visible);
  icon?.classList.toggle("fa-box-archive", !visible);
}

function applyVisibility(stackId, pendingControl = null) {
  const controls = renderedControls(stackId);
  if (pendingControl && !controls.includes(pendingControl)) controls.push(pendingControl);
  const hasControl = controls.length > 0;
  const visible = visibleByStack.get(stackId) === true;
  const hide = stackFirstEnabled() && hasControl && !visible;

  for (const element of renderedNativeRecords(stackId)) {
    element.classList.toggle("nelflow-native-record-hidden", hide);
  }
  for (const button of controls) {
    const count = Number(button.dataset.nelflowNativeRecordCount) || 0;
    updateControl(button, stackId, count, !hide);
  }
}

export class NativeRecordsController {
  static initialize() {
    if (initialized) return;
    initialized = true;
    Hooks.on("deleteChatMessage", (message) => {
      const stack = message.getFlag(MODULE_ID, "stack");
      if (!stack?.id) return;
      for (const element of renderedNativeRecords(stack.id)) {
        element.classList.remove("nelflow-native-record-hidden");
        delete element.dataset.nelflowNativeStackId;
      }
      visibleByStack.delete(stack.id);
    });
    Hooks.on("nelflowPresentationSettingChanged", () => {
      visibleByStack.clear();
      for (const element of document.querySelectorAll(".nelflow-linked-native")) {
        element.classList.remove("nelflow-native-record-hidden");
        if (!getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS)) {
          element.classList.remove("nelflow-native-collapsed");
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
    return stackFirstEnabled();
  }

  static recordsForStack(stack) {
    const records = [];
    const seen = new Set();
    for (const row of stack.rows ?? []) {
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
    if (!stackFirstEnabled() || !records.length) return;

    updateControl(button, stack.id, records.length, visibleByStack.get(stack.id) === true);
    button.addEventListener("click", () => {
      if (visibleByStack.get(stack.id) === true) visibleByStack.delete(stack.id);
      else visibleByStack.set(stack.id, true);
      applyVisibility(stack.id, button);
    });

    // Native messages are separate documents. Attach only already compacted
    // roots whose exact IDs survived the canonical record validation above.
    for (const record of records) {
      const element = renderedMessage(record.id);
      if (!element?.classList.contains("nelflow-linked-native")) continue;
      element.dataset.nelflowNativeStackId = stack.id;
    }
    applyVisibility(stack.id, button);
  }

  static registerNative(html, messageId, linked) {
    const stackId = linked.transaction.stackRef?.id;
    const stackMessage = stackId ? game.messages.get(stackId) : null;
    const stack = stackMessage?.getFlag(MODULE_ID, "stack");
    if (
      !stack ||
      stack.id !== stackId ||
      !this.recordsForStack(stack).some((record) => record.id === messageId)
    ) {
      return;
    }
    html.dataset.nelflowNativeStackId = stackId;
    const hasControl = renderedControls(stackId).length > 0;
    const hide = stackFirstEnabled() && hasControl && visibleByStack.get(stackId) !== true;
    html.classList.toggle("nelflow-native-record-hidden", hide);
  }

  static restoreNative(html) {
    html.classList.remove("nelflow-native-record-hidden");
    delete html.dataset.nelflowNativeStackId;
  }

  static show(stackId) {
    if (!stackId) return;
    visibleByStack.set(stackId, true);
    applyVisibility(stackId);
  }

  static failOpen(stackId) {
    if (!stackId) return;
    for (const element of renderedNativeRecords(stackId)) {
      element.classList.remove("nelflow-native-record-hidden");
    }
  }
}
