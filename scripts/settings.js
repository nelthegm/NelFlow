import { MODULE_ID, SETTINGS } from "./constants.js";

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
    key: SETTINGS.DEBUG,
    name: "Nelflow.Settings.Debug.Name",
    hint: "Nelflow.Settings.Debug.Hint",
    default: false,
  },
];

/** Register all Slice 1 world settings. */
export function registerSettings() {
  for (const definition of SETTING_DEFINITIONS) {
    game.settings.register(MODULE_ID, definition.key, {
      name: definition.name,
      hint: definition.hint,
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: definition.default,
    });
  }
}

/** Read a Nelflow setting. */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
