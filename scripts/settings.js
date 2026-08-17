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
  AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES,
  PLAYER_STRIKE_AUTO_APPLY_MODES,
  MULTI_TARGET_STRIKE_MODES,
  TRANSACTION_DIAGNOSTIC_MODES,
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
    key: SETTINGS.AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL,
    name: "Nelflow.Settings.AutomaticDamageRoll.Name",
    hint: "Nelflow.Settings.AutomaticDamageRoll.Hint",
    type: String,
    choices: {
      [AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF]:
        "Nelflow.Settings.AutomaticDamageRoll.Off",
      [AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.GM]:
        "Nelflow.Settings.AutomaticDamageRoll.Gm",
      [AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.ALL]:
        "Nelflow.Settings.AutomaticDamageRoll.All",
    },
    default: AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.ALL,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.PLAYER_STRIKE_AUTO_APPLY,
    name: "Nelflow.Settings.PlayerStrikeAutoApply.Name",
    hint: "Nelflow.Settings.PlayerStrikeAutoApply.Hint",
    type: String,
    choices: {
      [PLAYER_STRIKE_AUTO_APPLY_MODES.OFF]: "Nelflow.Settings.PlayerStrikeAutoApply.Off",
      [PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE]: "Nelflow.Settings.PlayerStrikeAutoApply.Hostile",
      [PLAYER_STRIKE_AUTO_APPLY_MODES.ALL]: "Nelflow.Settings.PlayerStrikeAutoApply.All",
    },
    default: PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.SPELL_ATTACK_AUTO_APPLY,
    name: "Nelflow.Settings.SpellAttackAutoApply.Name",
    hint: "Nelflow.Settings.SpellAttackAutoApply.Hint",
    default: true,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.SHARED_ROLL_MULTI_TARGET_STRIKES,
    name: "Nelflow.Settings.MultiTargetStrikes.Name",
    hint: "Nelflow.Settings.MultiTargetStrikes.Hint",
    type: String,
    choices: {
      [MULTI_TARGET_STRIKE_MODES.OFF]: "Nelflow.Settings.MultiTargetStrikes.Off",
      [MULTI_TARGET_STRIKE_MODES.NPC_STRIKES]: "Nelflow.Settings.MultiTargetStrikes.NpcOnly",
      [MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES]:
        "Nelflow.Settings.MultiTargetStrikes.PlayerAndNpc",
    },
    default: MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES,
    onChange: refreshPresentation,
  },
  {
    key: SETTINGS.SHOW_TRANSACTION_DIAGNOSTICS,
    name: "Nelflow.Settings.ShowTransactionDiagnostics.Name",
    hint: "Nelflow.Settings.ShowTransactionDiagnostics.Hint",
    scope: "client",
    restricted: true,
    type: String,
    choices: {
      [TRANSACTION_DIAGNOSTIC_MODES.OFF]: "Nelflow.Settings.ShowTransactionDiagnostics.Off",
      [TRANSACTION_DIAGNOSTIC_MODES.ERRORS_ONLY]:
        "Nelflow.Settings.ShowTransactionDiagnostics.ErrorsOnly",
      [TRANSACTION_DIAGNOSTIC_MODES.ALWAYS]:
        "Nelflow.Settings.ShowTransactionDiagnostics.Always",
    },
    default: TRANSACTION_DIAGNOSTIC_MODES.ERRORS_ONLY,
    // Compatibility-only: retain the client key and stored values, but no
    // mode may project transaction internals into ordinary chat in 0.6.5.
    config: false,
  },
  {
    key: SETTINGS.NELCINE_IMPACT_SYNC,
    name: "Nelflow.Settings.NelcineImpactSync.Name",
    hint: "Nelflow.Settings.NelcineImpactSync.Hint",
    default: false,
  },
  {
    key: SETTINGS.NELCINE_IMPACT_TIMEOUT_MS,
    name: "Nelflow.Settings.NelcineImpactTimeoutMs.Name",
    hint: "Nelflow.Settings.NelcineImpactTimeoutMs.Hint",
    type: Number,
    default: 5000,
    range: { min: 500, max: 15000, step: 100 },
  },
  {
    key: SETTINGS.NELCINE_STRIKE_CINEMATICS,
    name: "Nelflow.Settings.NelcineStrikeCinematics.Name",
    hint: "Nelflow.Settings.NelcineStrikeCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_SAVE_BATCH_CINEMATICS,
    name: "Nelflow.Settings.NelcineSaveBatchCinematics.Name",
    hint: "Nelflow.Settings.NelcineSaveBatchCinematics.Hint",
    default: false,
  },
  {
    key: SETTINGS.NELCINE_SAVE_BATCH_MINIMUM_TARGETS,
    name: "Nelflow.Settings.NelcineSaveBatchMinimumTargets.Name",
    hint: "Nelflow.Settings.NelcineSaveBatchMinimumTargets.Hint",
    type: Number,
    default: 2,
    range: { min: 2, max: 24, step: 1 },
  },
  {
    key: SETTINGS.NELCINE_SAVE_BATCH_IMPACT_SYNC,
    name: "Nelflow.Settings.NelcineSaveBatchImpactSync.Name",
    hint: "Nelflow.Settings.NelcineSaveBatchImpactSync.Hint",
    default: false,
  },
  {
    key: SETTINGS.NELCINE_EFFECT_CINEMATICS,
    name: "Nelflow.Settings.NelcineEffectCinematics.Name",
    hint: "Nelflow.Settings.NelcineEffectCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_HEALING_CINEMATICS,
    name: "Nelflow.Settings.NelcineHealingCinematics.Name",
    hint: "Nelflow.Settings.NelcineHealingCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_CONDITION_CINEMATICS,
    name: "Nelflow.Settings.NelcineConditionCinematics.Name",
    hint: "Nelflow.Settings.NelcineConditionCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_GENERIC_EFFECT_CINEMATICS,
    name: "Nelflow.Settings.NelcineGenericEffectCinematics.Name",
    hint: "Nelflow.Settings.NelcineGenericEffectCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_ACTION_CINEMATICS,
    name: "Nelflow.Settings.NelcineActionCinematics.Name",
    hint: "Nelflow.Settings.NelcineActionCinematics.Hint",
    default: true,
  },
  {
    key: SETTINGS.NELCINE_DEFEATED_CINEMATICS,
    name: "Nelflow.Settings.NelcineDefeatedCinematics.Name",
    hint: "Nelflow.Settings.NelcineDefeatedCinematics.Hint",
    default: true,
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
      scope: definition.scope ?? "world",
      config: definition.config ?? true,
      restricted: definition.restricted ?? true,
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

/** Pure migration policy used to prove existing-world opt-in is one-shot. */
export function shouldDisablePlayerStrikeForMigration({ version, hasStoredMigration }) {
  return hasStoredMigration === true && Number(version) < 4;
}

/** Versioned workflow migrations; never enable or replace the legacy resolver. */
export async function migrateSettings({ toolbeltReady }) {
  if (!game.user?.isGM) return false;
  const version = Number(getSetting(SETTINGS.MIGRATION_VERSION) ?? 0);
  if (version >= SETTINGS_MIGRATION_VERSION) return false;
  const storage = game.settings.storage?.get?.("world");
  const hasStoredMigration = storage?.has?.(`${MODULE_ID}.${SETTINGS.MIGRATION_VERSION}`) === true;
  if (!hasStoredMigration && version === 0) {
    // A fresh world keeps registered defaults, including Slice 3.3 autoroll.
    await game.settings.set(MODULE_ID, SETTINGS.MIGRATION_VERSION, SETTINGS_MIGRATION_VERSION);
    return true;
  }
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
  if (version < 3) {
    // Existing worlds opt in explicitly so an update never adds a damage roll
    // to an established workflow without the GM's choice.
    await game.settings.set(
      MODULE_ID,
      SETTINGS.AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL,
      AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF,
    );
  }
  if (shouldDisablePlayerStrikeForMigration({ version, hasStoredMigration })) {
    // Existing campaigns explicitly opt in to player-authored HP changes.
    await game.settings.set(
      MODULE_ID,
      SETTINGS.PLAYER_STRIKE_AUTO_APPLY,
      PLAYER_STRIKE_AUTO_APPLY_MODES.OFF,
    );
  }
  await game.settings.set(MODULE_ID, SETTINGS.MIGRATION_VERSION, SETTINGS_MIGRATION_VERSION);
  return true;
}
