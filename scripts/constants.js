export const MODULE_ID = "nelflow";
export const MODULE_TITLE = "Nelflow";
export const LOG_PREFIX = `${MODULE_TITLE} |`;

export const SETTINGS = Object.freeze({
  ENABLED: "enabled",
  AUTO_APPLY: "autoApply",
  ENABLE_UNDO: "enableUndo",
  COMPACT_TURN_STACKS: "compactTurnStacks",
  COLLAPSE_LINKED_NATIVE_CARDS: "collapseLinkedNativeCards",
  DEBUG: "debug",
});

export const COMPACT_STACK_MODES = Object.freeze({
  OFF: "off",
  NPC_STRIKES: "npc-strikes",
});

export const STACK_SCHEMA_VERSION = 1;

export const TRANSACTION_STATES = Object.freeze({
  DETECTED: "detected",
  PROCESSING: "processing",
  SKIPPED: "skipped",
  DAMAGE_ROLLED: "damage-rolled",
  APPLIED: "applied",
  FAILED: "failed",
  UNDONE: "undone",
});

export const TERMINAL_OR_CLAIMED_STATES = new Set(Object.values(TRANSACTION_STATES));

export const DEGREE_OF_SUCCESS = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess",
]);
