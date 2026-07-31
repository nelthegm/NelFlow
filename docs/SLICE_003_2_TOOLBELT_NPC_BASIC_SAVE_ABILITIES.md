# Slice 3.2: Toolbelt NPC Basic-Save Abilities

## Purpose

Slice 3.2 extends the existing Toolbelt basic-save application pipeline from spells to a narrowly verified class of NPC abilities. Toolbelt remains the target/save/reroll authority, the native PF2e `DamageRoll` remains damage authority, and `flags.nelflow.toolbeltBasicSave` remains the sole Nelflow transaction. No resolver card, save roll, damage roll, formula reconstruction, or direct HP subtraction is added.

## Confirmed PF2e 8.3.0 source structures

PF2e 8.3.0 identifies creature ability documents as item type `action`, implemented by `AbilityItemPF2e`; the NPC actor explicitly permits embedded `action` items. An action card stores `flags.pf2e.origin` from `ItemPF2e#getOriginData`, including exact actor UUID, item UUID, item type, and roll options. Clicking an enhanced inline `@Damage` link builds a native `DamageRoll` through `DamagePF2e.roll`. Its damage message independently stores the exact item origin and a structured `flags.pf2e.context` with `type: "damage-roll"`; non-attack inline ability damage uses `sourceType: "save"` and no attack outcome. The roll itself retains typed instances, materials, categories, and alteration support.

PF2e NPC feat documents are not a supported source: `FeatPF2e` is character-oriented in 8.3.0. Hazards are separate actor types. Melee/weapon origins and PF2e strike flags are rejected.

## Toolbelt 3.52.0–3.52.1 findings

Both supported versions use the same relevant Target Helper schema. An action card with one structured inline basic-save check receives `type: "action"`, exact `author`, exact `item`, targets, and one basic save variant. When its inline damage control is used, Toolbelt's one-shot upstream `preCreateChatMessage` hook transfers those structured fields to the exact new damage message and changes the type to `damage`. Final target outcomes live under that save variant; primary target UUIDs, splash target UUIDs, applied markers keyed by target and roll index, and `splashIndex` are persisted.

Toolbelt does not persist the originating action-card message ID on the damage transaction. Nelflow never reconstructs it by timing or adjacency. Eligibility instead requires Toolbelt's actor/item evidence and PF2e's independently persisted actor/item origin to agree on the same damage message.

Toolbelt save data is message-level rather than mapped to a specific one of several regular damage rolls. Therefore Nelflow supports one exact regular native damage roll, optionally accompanied by a structurally marked splash-only roll. Two or more regular rolls are ambiguous and remain manual. Toolbelt 3.52.1 only adds a missing-context guard relative to 3.52.0; the relevant schema is unchanged.

## Classification and eligibility

`basic-save-source-classifier.js` receives normalized Toolbelt source evidence from the version-gated adapter; it never reads raw Toolbelt flags. The adapter remains the sole raw-flag reader. The classifier returns `spell`, `npc-ability`, or a structured rejection.

An NPC ability requires all of the following:

- one structured basic Fortitude, Reflex, or Will variant on the exact Toolbelt damage message;
- one exact non-splash native `DamageRoll` index;
- an exact PF2e origin item and Toolbelt source item UUID match;
- an exact PF2e origin actor, Toolbelt author actor, message actor, and item parent actor match;
- NPC actor type and PF2e item type `action`;
- PF2e damage context type `damage-roll`, source type `save`, and no attack outcome or strike flag;
- eligible primary Toolbelt target entries and finalized structured outcomes before application.

The persisted transaction records `sourceKind`, actor/item types, optional action slug, exact source UUIDs, roll index, classifier version, and eligibility-evidence version. Evidence strings are used only during normalization and are not exposed in UI. Existing Slice 3.1 spell transactions without `sourceKind` remain compatible and are treated as spell transactions.

## Unsupported/manual sources

Player abilities, hazards, NPC feats, unknown item types, Strikes, attack-plus-save damage, non-basic saves, plain-description saves, missing or mismatched origins, manually created damage rolls, healing/recovery, persistent damage, splash-only results, multiple ambiguous regular rolls, legacy resolver damage, and target-specific/otherwise unsafe damage remain native and manual. Nelflow never searches prose for “basic save” or selects the first/newest roll.

## Application lifecycle

All existing timing modes apply equally to spells and abilities: all resolved, per target, GM confirmation, or Off. Only primary targets participate. Toolbelt outcomes normalize to Critical Success, Success, Failure, and Critical Failure; Nelflow does not calculate them.

Critical Success becomes terminal No Damage. Success delegates the existing native half transformation, Failure uses the same native roll unchanged, and Critical Failure delegates native double. Before each target claim and again after the durable claim, Nelflow re-normalizes the exact message, source, roll index, save fingerprint, applied marker, processing GM, and transaction revision. It then uses the existing PF2e contextual application path, preserving IWR, damage types/materials, temporary HP, and native application messages. Completed targets are persisted immediately and never replayed if a later target fails.

Persistent damage is marked Manual Application Required before application. Splash rows never become Nelflow target records. A structurally proven Toolbelt applied marker becomes External Application Detected rather than a second application.

## Control guards and Undo

Slice 3.1.1's exact message/target/roll/application guard is reused unchanged. Applied, No Damage, structurally External, Result Changed, and proven prior-application terminal states guard only Damage/Half/Double/Triple. Block, Save, Reroll, details, application records, Manual Override, and Re-guard retain their existing behavior.

Undo continues through `guarded-health-restore.js` for one exact target. Current HP and temporary HP must match the recorded post-state. Success restores the recorded pre-state and releases Nelflow's control restrictions; refusal becomes Undo Blocked and remains guarded. Conditions, persistent damage, and other effects are not undone.

## Reload, authority, and privacy

The deterministic existing processing-GM election is reused. The active authoring GM is preferred; otherwise the stable active-GM ordering elects one processor. The claim is persisted before mechanics, other GMs are render-only, and there is no handoff.

Reload reconstructs the transaction, target states, application records, Undo, and guards from flags. Applying work is marked Interrupted and never resumed. No action or damage is invoked again. The UI resolves a source label only for a GM or an owner/player-owned source; other viewers receive **Basic Save Ability**. Target visibility and private-result rules are unchanged. UUIDs, slugs, processing users, raw flags, and classifier evidence are not rendered.

## Settings and migration

**Toolbelt Basic Save Sources** stores `spells` or `spells-and-npc-abilities` and defaults to the latter. Migration version 2 changes this setting once for existing worlds already using the Toolbelt workflow. Off and Legacy workflow selections are not changed. The existing application-timing and guard settings are reused.

## Diagnostics and compatibility

GM debug diagnostics cover classification, eligibility/rejection, roll ambiguity, observation, target/all-save readiness, application start/completion/manual/external, and interruption. They contain shortened integration/message identifiers, source kind/item type, roll index, hashed target key, and reason—never message content, descriptions, documents, names, or raw/private rolls.

The implementation is source-checked against PF2e 8.3.0 commit `fe99f9b5` and Toolbelt tags 3.52.0 (`2ce976b`) and 3.52.1 (`f4eeff8`). Native PF2e cards, Toolbelt rows, Dice So Nice, Better Chat Message, Workbench, Strike stacks, and the Legacy resolver remain separate. Changed or missing structured source/DOM data fails open.

## Known limitations

- Only PF2e 8.3.0 NPC `action`/`AbilityItemPF2e` sources with exact Toolbelt/PF2e agreement are supported.
- Toolbelt does not preserve the originating action-card ID on the damage flag.
- More than one regular damage roll is manual because Toolbelt 3.52.x has no exact save-to-roll mapping.
- Persistent, splash, healing, conditions-by-degree, forced movement, reactions, and attack-plus-save abilities are manual.
- Native application Undo does not synchronize Nelflow state; deliberate manual damage after override is not tracked.
- Runtime acceptance still requires the Foundry scenarios in the Slice 3.2 test plan.
