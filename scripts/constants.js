export const MODULE_ID = "nelflow";
export const MODULE_TITLE = "Nelflow";
export const LOG_PREFIX = `${MODULE_TITLE} |`;

export const SETTINGS = Object.freeze({
  ENABLED: "enabled",
  AUTO_APPLY: "autoApply",
  ENABLE_UNDO: "enableUndo",
  COMPACT_TURN_STACKS: "compactTurnStacks",
  COLLAPSE_LINKED_NATIVE_CARDS: "collapseLinkedNativeCards",
  STACK_FIRST_NATIVE_RECORDS: "stackFirstNativeRecords",
  BASIC_SAVE_RESOLVER: "basicSaveResolver",
  AUTO_APPLY_BASIC_SAVE_DAMAGE: "autoApplyBasicSaveDamage",
  BASIC_SAVE_WORKFLOW: "basicSaveWorkflow",
  TOOLBELT_BASIC_SAVE_APPLICATION: "toolbeltBasicSaveApplication",
  TOOLBELT_BASIC_SAVE_SOURCES: "toolbeltBasicSaveSources",
  AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL: "automaticBasicSaveDamageRoll",
  GUARD_TOOLBELT_DAMAGE_CONTROLS: "guardToolbeltDamageControls",
  PLAYER_STRIKE_AUTO_APPLY: "playerStrikeAutoApply",
  SHOW_TRANSACTION_DIAGNOSTICS: "showTransactionDiagnostics",
  MIGRATION_VERSION: "migrationVersion",
  DEBUG: "debug",
});

export const COMPACT_STACK_MODES = Object.freeze({
  OFF: "off",
  NPC_STRIKES: "npc-strikes",
});

export const STACK_FIRST_NATIVE_RECORD_MODES = Object.freeze({
  ALWAYS_SHOW: "always-show",
  HIDE_BEHIND_STACK: "hide-behind-stack",
});

export const STACK_SCHEMA_VERSION = 2;

export const BASIC_SAVE_RESOLVER_MODES = Object.freeze({
  OFF: "off",
  NPC_SPELLS: "npc-spells",
});

export const BASIC_SAVE_WORKFLOW_MODES = Object.freeze({
  OFF: "off",
  TOOLBELT: "toolbelt",
  LEGACY: "legacy",
});

export const TOOLBELT_APPLICATION_MODES = Object.freeze({
  ALL_RESOLVED: "all-resolved",
  PER_TARGET: "per-target",
  GM_CONFIRM: "gm-confirm",
  OFF: "off",
});

export const TOOLBELT_BASIC_SAVE_SOURCE_MODES = Object.freeze({
  SPELLS: "spells",
  SPELLS_AND_NPC_ABILITIES: "spells-and-npc-abilities",
});

export const AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES = Object.freeze({
  OFF: "off",
  GM: "gm",
  ALL: "all",
});

export const PLAYER_STRIKE_AUTO_APPLY_MODES = Object.freeze({
  OFF: "off",
  HOSTILE: "hostile",
  ALL: "all",
});

export const TRANSACTION_DIAGNOSTIC_MODES = Object.freeze({
  OFF: "off",
  ERRORS_ONLY: "errors-only",
  ALWAYS: "always",
});

export const PLAYER_STRIKE_TRANSACTION_SCHEMA_VERSION = 1;

export const AUTO_DAMAGE_ROLL_SCHEMA_VERSION = 1;

export const TOOLBELT_TRANSACTION_SCHEMA_VERSION = 1;
export const SETTINGS_MIGRATION_VERSION = 4;

export const SAVE_RESOLVER_SCHEMA_VERSION = 1;

export const TRANSACTION_STATES = Object.freeze({
  DETECTED: "detected",
  PROCESSING: "processing",
  SKIPPED: "skipped",
  DAMAGE_ROLLED: "damage-rolled",
  APPLIED: "applied",
  FAILED: "failed",
  UNDONE: "undone",
  INTERRUPTED: "interrupted",
  MANUAL: "manual",
  ABANDONED: "abandoned",
  WAITING_FOR_DAMAGE: "waiting-for-damage",
  DAMAGE_OBSERVED: "damage-observed",
  VALIDATING: "validating",
  CLAIMED: "claimed",
  APPLYING: "applying",
  AMBIGUOUS: "ambiguous",
});

export const TERMINAL_OR_CLAIMED_STATES = new Set(Object.values(TRANSACTION_STATES));

export const DEGREE_OF_SUCCESS = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess",
]);
