import {
  BASIC_SAVE_RESOLVER_MODES,
  BASIC_SAVE_WORKFLOW_MODES,
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_FIRST_NATIVE_RECORD_MODES,
  SETTINGS_MIGRATION_VERSION,
  TOOLBELT_APPLICATION_MODES,
  TOOLBELT_BASIC_SAVE_SOURCE_MODES,
} from "./constants.js";

function refreshPresentation() {
  Hooks.callAll("nelflowPresentationSettingChanged");
}

const SETTING_DEFINITIONS = [
  {
    key: SETTINGS.ENABLED,
    name: "Nelflow.Settings.Enabled.Name",
    hint: "Nelflow.Settings.Enabled.Hint",
    default: true,
  },
  {
    key: SETTINGS.AUTO_APPLY,
    name: "Nelflow.Settings.AutoApply.Name",
    hint: "Nelflow.Settings.AutoApply.Hint",
    default: true,
  },
  {
    key: SETTINGS.ENABLE_UNDO,
    name: "Nelflow.Settings.EnableUndo.Name",
    hint: "Nelflow.Settings.EnableUndo.Hint",
    default: true,
  },
  {
    key: SETTINGS.COMPACT_TURN_STACKS,
    name: "Nelflow.Settings.CompactTurnStacks.Name",
    hint: "Nelflow.Settings.CompactTurnStacks.Hint",
    type: String,
    choices: {
      [COMPACT_STACK_MODES.OFF]: "Nelflow.Settings.CompactTurnStacks.Off",
      [COMPACT_STACK_MODES.NPC_STRIKES]: "Nelflow.Settings.CompactTurnStacks.NpcStrikes",
    },
    default: COMPACT_STACK_MODES.NPC_STRIKES,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS,
    name: "Nelflow.Settings.CollapseLinkedNativeCards.Name",
    hint: "Nelflow.Settings.CollapseLinkedNativeCards.Hint",
    default: true,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.STACK_FIRST_NATIVE_RECORDS,
    name: "Nelflow.Settings.StackFirstNativeRecords.Name",
    hint: "Nelflow.Settings.StackFirstNativeRecords.Hint",
    type: String,
    choices: {
      [STACK_FIRST_NATIVE_RECORD_MODES.ALWAYS_SHOW]:
        "Nelflow.Settings.StackFirstNativeRecords.AlwaysShow",
      [STACK_FIRST_NATIVE_RECORD_MODES.HIDE_BEHIND_STACK]:
        "Nelflow.Settings.StackFirstNativeRecords.HideBehindStack",
    },
    default: STACK_FIRST_NATIVE_RECORD_MODES.HIDE_BEHIND_STACK,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.BASIC_SAVE_RESOLVER,
    name: "Nelflow.Settings.BasicSaveResolver.Name",
    hint: "Nelflow.Settings.BasicSaveResolver.Hint",
    type: String,
    choices: {
      [BASIC_SAVE_RESOLVER_MODES.OFF]: "Nelflow.Settings.BasicSaveResolver.Off",
      [BASIC_SAVE_RESOLVER_MODES.NPC_SPELLS]:
        "Nelflow.Settings.BasicSaveResolver.NpcSpells",
    },
    default: BASIC_SAVE_RESOLVER_MODES.NPC_SPELLS,
    config: false,
  },
  {
    key: SETTINGS.BASIC_SAVE_WORKFLOW,
    name: "Nelflow.Settings.BasicSaveWorkflow.Name",
    hint: "Nelflow.Settings.BasicSaveWorkflow.Hint",
    type: String,
    choices: {
      [BASIC_SAVE_WORKFLOW_MODES.OFF]: "Nelflow.Settings.BasicSaveWorkflow.Off",
      [BASIC_SAVE_WORKFLOW_MODES.TOOLBELT]: "Nelflow.Settings.BasicSaveWorkflow.Toolbelt",
      [BASIC_SAVE_WORKFLOW_MODES.LEGACY]: "Nelflow.Settings.BasicSaveWorkflow.Legacy",
    },
    default: BASIC_SAVE_WORKFLOW_MODES.TOOLBELT,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION,
    name: "Nelflow.Settings.ToolbeltApplication.Name",
    hint: "Nelflow.Settings.ToolbeltApplication.Hint",
    type: String,
    choices: {
      [TOOLBELT_APPLICATION_MODES.ALL_RESOLVED]: "Nelflow.Settings.ToolbeltApplication.AllResolved",
      [TOOLBELT_APPLICATION_MODES.PER_TARGET]: "Nelflow.Settings.ToolbeltApplication.PerTarget",
      [TOOLBELT_APPLICATION_MODES.GM_CONFIRM]: "Nelflow.Settings.ToolbeltApplication.GmConfirm",
      [TOOLBELT_APPLICATION_MODES.OFF]: "Nelflow.Settings.ToolbeltApplication.Off",
    },
    default: TOOLBELT_APPLICATION_MODES.ALL_RESOLVED,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS,
    name: "Nelflow.Settings.GuardToolbeltControls.Name",
    hint: "Nelflow.Settings.GuardToolbeltControls.Hint",
    default: true,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.TOOLBELT_BASIC_SAVE_SOURCES,
    name: "Nelflow.Settings.ToolbeltSources.Name",
    hint: "Nelflow.Settings.ToolbeltSources.Hint",
    type: String,
    choices: {
      [TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS]: "Nelflow.Settings.ToolbeltSources.Spells",
      [TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS_AND_NPC_ABILITIES]:
        "Nelflow.Settings.ToolbeltSources.SpellsAndNpcAbilities",
    },
    default: TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS_AND_NPC_ABILITIES,
  },
  {
    key: SETTINGS.MIGRATION_VERSION,
    name: "Nelflow internal migration version",
    hint: "",
    type: Number,
    default: 0,
    config: false,
  },
  {
    key: SETTINGS.AUTO_APPLY_BASIC_SAVE_DAMAGE,
    name: "Nelflow.Settings.AutoApplyBasicSaveDamage.Name",
    hint: "Nelflow.Settings.AutoApplyBasicSaveDamage.Hint",
    default: true,
    config: false,
  },
  {
    key: SETTINGS.DEBUG,
    name: "Nelflow.Settings.Debug.Name",
    hint: "Nelflow.Settings.Debug.Hint",
    default: false,
  },
];

/** Register all Nelflow world settings. */
export function registerSettings() {
  for (const definition of SETTING_DEFINITIONS) {
    game.settings.register(MODULE_ID, definition.key, {
      name: definition.name,
      hint: definition.hint,
      scope: "world",
      config: definition.config ?? true,
      restricted: true,
      type: definition.type ?? Boolean,
      choices: definition.choices,
      default: definition.default,
      onChange: definition.onChange,
    });
  }
}

/** Read a Nelflow setting. */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/** Versioned workflow migrations; never enable or replace the legacy resolver. */
export async function migrateSettings({ toolbeltReady }) {
  if (!game.user?.isGM) return false;
  const version = Number(getSetting(SETTINGS.MIGRATION_VERSION) ?? 0);
  if (version >= SETTINGS_MIGRATION_VERSION) return false;
  if (version < 1) {
    await game.settings.set(
      MODULE_ID,
      SETTINGS.BASIC_SAVE_WORKFLOW,
      toolbeltReady ? BASIC_SAVE_WORKFLOW_MODES.TOOLBELT : BASIC_SAVE_WORKFLOW_MODES.OFF,
    );
  }
  if (
    version < 2 &&
    getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) === BASIC_SAVE_WORKFLOW_MODES.TOOLBELT
  ) {
    await game.settings.set(
      MODULE_ID,
      SETTINGS.TOOLBELT_BASIC_SAVE_SOURCES,
      TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS_AND_NPC_ABILITIES,
    );
  }
  await game.settings.set(MODULE_ID, SETTINGS.MIGRATION_VERSION, SETTINGS_MIGRATION_VERSION);
  return true;
}
