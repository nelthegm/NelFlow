import {
  BASIC_SAVE_RESOLVER_MODES,
  COMPACT_STACK_MODES,
  MODULE_ID,
  SETTINGS,
  STACK_FIRST_NATIVE_RECORD_MODES,
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
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.AUTO_APPLY_BASIC_SAVE_DAMAGE,
    name: "Nelflow.Settings.AutoApplyBasicSaveDamage.Name",
    hint: "Nelflow.Settings.AutoApplyBasicSaveDamage.Hint",
    default: true,
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
      config: true,
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
