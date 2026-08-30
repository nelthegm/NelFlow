import {
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_DEFAULT_STATES,
} from "./constants.js";
import { logger } from "./logger.js";
import { getSetting } from "./settings.js";

const MAX_RENDER_ATTEMPTS = 18;

export function stackRenderRevision(stack) {
  const source = JSON.stringify({ updatedAt: stack?.updatedAt ?? null, rows: stack?.rows ?? [] });
  let hash = 0x811c9dc5;
  for (const character of source) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${stack?.updatedAt ?? ""}:${(hash >>> 0).toString(36)}`;
}

export function defaultStackExpanded(value) {
  return value !== STACK_DEFAULT_STATES.COLLAPSED;
}

export function hasStackRowProjectionChange(changed = {}) {
  const stack = changed?.flags?.[MODULE_ID]?.stack;
  if (stack && (Object.hasOwn(stack, "rows") || Object.hasOwn(stack, "updatedAt"))) return true;
  return Object.keys(changed).some((key) =>
    key === `flags.${MODULE_ID}.stack` ||
    key.startsWith(`flags.${MODULE_ID}.stack.rows`) ||
    key === `flags.${MODULE_ID}.stack.updatedAt`,
  );
}

export function isActiveCombatStack(stack, combat) {
  const identity = stack?.identity;
  if (stack?.kind !== "combat-turn" || !combat?.started || !identity) return false;
  if (
    identity.combatId !== combat.id ||
    identity.round !== combat.round ||
    identity.combatantId !== combat.combatant?.id ||
    identity.turnIndex !== combat.turn
  ) return false;
  const marker = combat.getFlag?.(MODULE_ID, "turnMarker");
  return Boolean(marker?.markerId && marker.markerId === identity.turnMarkerId);
}

function chatRoots(chat) {
  return [chat?.element, chat?.popout?.element].filter((root, index, roots) =>
    root && roots.indexOf(root) === index,
  );
}

export function repositionRenderedStack({ documentRef, chat, messageId, revision }) {
  const roots = chatRoots(chat);
  const nodes = Array.from(documentRef?.querySelectorAll?.("[data-nelflow-stack-id]") ?? []).filter((node) =>
    node.dataset?.nelflowStackId === messageId &&
    node.dataset?.nelflowStackRevision === revision &&
    roots.some((root) => root.contains?.(node)),
  );
  for (const node of nodes) node.parentElement?.append(node);
  return nodes.length;
}

export function createStackPresentationController({
  settings = getSetting,
  combat = () => globalThis.game?.combat,
  chat = () => globalThis.ui?.chat,
  documentRef = () => globalThis.document,
  scheduleFrame = (callback) => globalThis.requestAnimationFrame(callback),
  debug = (message, data) => logger.debug(message, data),
  localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key,
} = {}) {
  const expandedOverrides = new Map();
  const pendingFollows = new Map();

  function expandedFor(messageId) {
    if (expandedOverrides.has(messageId)) return expandedOverrides.get(messageId);
    return defaultStackExpanded(settings(SETTINGS.STACK_DEFAULT_STATE));
  }

  function applyDisclosure(view, expanded) {
    view.article.classList.toggle("nelflow-stack--collapsed", !expanded);
    view.rows.hidden = !expanded;
    view.button.setAttribute("aria-expanded", String(expanded));
    view.button.setAttribute(
      "aria-label",
      localize(
        expanded ? "Nelflow.Stack.CollapseAria" : "Nelflow.Stack.ExpandAria",
      ),
    );
    view.chevron.className = `fa-solid ${expanded ? "fa-chevron-up" : "fa-chevron-down"}`;
  }

  function enhanceDisclosure(view) {
    let expanded = expandedFor(view.messageId);
    applyDisclosure(view, expanded);
    view.button.addEventListener("click", () => {
      expanded = !expanded;
      expandedOverrides.set(view.messageId, expanded);
      applyDisclosure(view, expanded);
    });
  }

  function followWhenRendered(messageId, revision, attempt = 0) {
    if (pendingFollows.get(messageId) !== revision) return;
    const chatLog = chat();
    const count = repositionRenderedStack({
      documentRef: documentRef(), chat: chatLog, messageId, revision,
    });
    if (!count && attempt < MAX_RENDER_ATTEMPTS) {
      scheduleFrame(() => followWhenRendered(messageId, revision, attempt + 1));
      return;
    }
    pendingFollows.delete(messageId);
    if (!count) {
      debug("Active stack follow skipped because its rendered node was unavailable", { messageId });
      return;
    }
    try {
      Promise.resolve(chatLog?.scrollBottom?.({
        popout: true,
        waitImages: true,
        scrollOptions: { behavior: "smooth", block: "end" },
      })).catch((error) => debug("Active stack scroll failed open", {
        messageId, reason: error instanceof Error ? error.message : String(error),
      }));
    } catch (error) {
      debug("Active stack scroll failed open", {
        messageId, reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleChatMessageUpdate(message, changed) {
    try {
      if (!hasStackRowProjectionChange(changed)) return false;
      if (settings(SETTINGS.COMPACT_TURN_STACKS) !== COMPACT_STACK_MODES.NPC_STRIKES) return false;
      if (!settings(SETTINGS.KEEP_ACTIVE_STACK_AT_BOTTOM)) return false;
      if (message?.visible === false || message?.isContentVisible === false) return false;
      const stack = message?.getFlag?.(MODULE_ID, "stack");
      if (!stack?.rows?.length || !isActiveCombatStack(stack, combat())) return false;
      const revision = stackRenderRevision(stack);
      pendingFollows.set(message.id, revision);
      scheduleFrame(() => followWhenRendered(message.id, revision));
      return true;
    } catch (error) {
      debug("Active stack follow failed open", {
        messageId: message?.id, reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  return {
    enhanceDisclosure,
    expandedFor,
    forget(messageId) {
      expandedOverrides.delete(messageId);
      pendingFollows.delete(messageId);
    },
    handleChatMessageUpdate,
  };
}

export const StackPresentationController = createStackPresentationController();
