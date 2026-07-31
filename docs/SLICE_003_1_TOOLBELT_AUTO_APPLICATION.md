# Slice 3.1: PF2e Toolbelt Target Helper Auto-Application

## Purpose

Slice 3.1 makes PF2e Toolbelt Target Helper the default target and save authority. The Slice 3 custom resolver remains available only as **Legacy Nelflow Resolver (Experimental)**. Toolbelt mode never creates a second resolver message, rolls a save, replaces a target row, clicks a Toolbelt control, or rewrites a Toolbelt flag.

## Source inspection

The configured local Foundry data path contained PF2e 6.2.0 and no installed PF2e Toolbelt, so it was not the requested V14 development world. No installed Toolbelt version was invented. The exact official V14 releases inspected were PF2e Toolbelt **3.52.0** at `2ce976be5d2ccb4c2aa45e0f1723143e4c1d5fca` and **3.52.1** at `f4eeff8e6a5096850bb1e9b76e3268a48d3fa493`. Their exact tag diff changes localization, manifest versions, and one defensive missing-PF2e-context guard in Target Helper; the persisted target/save schema and API are unchanged. The 3.52.1 manifest supports Foundry 14.361 through 14, is verified on 14.365, and requires PF2e 8.3.0 or newer. Release 3.52.0 is explicitly the PF2e 8.3.0 release.

The understood and accepted range is therefore `3.52.0` through `3.52.1`. Other versions fail open to Toolbelt's normal manual controls.

## Public API findings

At `init`, Toolbelt creates `game.toolbelt`, exposes `getToolSetting`, and publishes `game.toolbelt.targetHelper`. Target Helper's public API contains only:

- `getMessageTargets(message)`
- `setMessageFlagTargets(updates, targets)`

There is no exported target-specific damage function and no exported update queue. The internal Target Helper has a private semaphore-backed `updateMessageEmitable`; its native-button handler and damage function are not part of `game.toolbelt`. Nelflow does not call them.

Toolbelt emits `pf2e-toolbelt.rollSave` and `pf2e-toolbelt.rerollSave`, but the durable authority is the updated ChatMessage flag. Nelflow observes document creation/updates instead of depending on hook ordering.

Target Helper enabled state is the world setting `pf2e-toolbelt.targetHelper.enabled`. Toolbelt must be active, this setting must be true, and the exact version must be supported.

## Persisted Toolbelt schema

The adapter alone reads `flags.pf2e-toolbelt.targetHelper`. In 3.52.x the damage record contains:

- `type: "damage"`
- exact `targets` and `splashTargets` token UUID arrays
- `item` and `author` document UUIDs
- `saveVariants`
- `applied[targetTokenId][rollIndex]`
- `splashIndex`, `area`, `isRegen`, `private`, options, and traits

Each save variant contains `basic`, `dc`, `statistic`, and `saves[targetTokenId]`. A persisted save contains the finalized PF2e `success`, serialized native roll, reroll marker, statistic, privacy state, and structured modifiers/adjustments. Nelflow consumes only the exact identifiers, basic/statistic fields, finalized `success`, reroll identity, privacy marker, and applied marker. It does not calculate a degree of success.

## Compatibility adapter

`toolbelt-target-helper-adapter.js` is the sole version-sensitive boundary. It:

- detects module activity, version, public API, and Target Helper setting;
- enforces the supported version range;
- validates a native PF2e DamageRoll and exact Toolbelt damage schema;
- selects exactly one structured basic Fortitude, Reflex, or Will save;
- resolves exact token and actor references;
- separates primary and splash targets;
- reads final save and Toolbelt-applied state;
- builds stable message and per-save fingerprints;
- returns normalized target records without target-name identity.

No other Nelflow mechanical service reads raw Toolbelt flags.

## Eligibility

Toolbelt mode requires an exact native damage message, Toolbelt `type: damage`, one structured basic supported save, one unambiguous non-splash DamageRoll, and at least one valid primary token/actor. Legacy-owned damage, Strike transactions, healing/regeneration, ambiguous shared rolls, unsupported versions, and absent/disabled Target Helper fail open. Persistent damage is identified structurally and every otherwise-applicable row becomes manual.

Player- and GM-authored spell damage are supported. Caster actor type is irrelevant because the elected GM performs actor updates.

## Parent transaction and identity

No ChatMessage is created. The existing Toolbelt/native damage message stores `flags.nelflow.toolbeltBasicSave`:

- schema and deterministic `toolbelt-basic-save:<damageMessageId>` integration ID;
- exact damage/source IDs and author/processing users;
- Toolbelt version and schema fingerprint;
- phase, stable target order, roll index, revision, and timestamps;
- deterministic `<integrationId>:target:<toolbeltTargetKey>` target application records;
- exact token/actor/scene IDs, save result/fingerprint, multiplier, state, health snapshots/delta, native application message, Undo, and reason.

The Toolbelt flag remains untouched.

## Processing GM election

If the damage-message author is an active GM, that GM wins. Otherwise the active GM with the lexically lowest user ID wins. The elected ID is persisted before mechanics. Other GMs render only. Started transactions never transfer automatically; disappearance during processing becomes interrupted/manual review.

## Timing and result authority

The application modes are:

- **When All Saves Are Resolved**: waits for every primary target's persisted supported result.
- **Apply Each Resolved Target**: claims each completed primary row independently.
- **GM Confirmation**: renders one compact GM control on the existing damage card.
- **Off**: no observation or mechanics.

Toolbelt's persisted `success` is the only outcome authority. Pending is never failure. A reroll before claim changes the save fingerprint and stale queued work is refused. A changed result after Applied or No Damage becomes **Result Changed - Manual Review Required**; Nelflow never silently restores or reapplies HP.

## Native damage and Toolbelt API fallback

Toolbelt 3.52.x exposes neither an application API nor its update queue. Nelflow therefore uses the permitted fallback: the exact DamageRoll already on the damage message and the existing PF2e contextual application adapter. It never calls spell damage again.

- Critical Success: records No Damage; no application and no Undo.
- Success: `DamageRoll#alter(0.5, 0)`.
- Failure: the unaltered roll.
- Critical Failure: `DamageRoll#alter(2, 0)`.

The contextual clone and `ActorPF2e#applyDamage` retain typed instances, traits, materials, ephemeral effects, IWR, rounding, and temporary HP. Nelflow captures independent before/after HP and temporary HP, actual combined delta, and an exact application message when uniquely available. It never subtracts HP directly.

## Concurrency and manual-button race

Nelflow serializes mutations per damage message, persists one deterministic GM claim, uses deterministic application IDs, revalidates exact Toolbelt save/applied fingerprints before and after claim, and makes terminal records non-replayable. Rapid create/update hooks and rerenders are idempotent.

Because Toolbelt's semaphore and apply function are private, Nelflow cannot join or lock Toolbelt's manual-button queue. It leaves Toolbelt controls enabled as required and checks the Toolbelt applied marker immediately before native application. A manual click that wins that check is recorded External Application. A truly simultaneous click in the narrow interval after the last recheck cannot be atomically excluded across two modules; GM Confirmation is the safest mode when manual and automatic application may be mixed.

## Splash, persistent damage, and manual fallback

Splash target UUIDs never participate in basic-save readiness or normal target application. Toolbelt's own splash controls remain available. Persistent damage is never auto-applied because Nelflow cannot safely track or undo the resulting condition. Errors, missing exact documents, unsupported schema, and external application all preserve Toolbelt's native controls and damage roll.

## UI and privacy

Nelflow adds a compact semantic status section under the existing damage card. It does not recreate or modify Toolbelt rows or controls. The separate section avoids row-name matching and remains correct if chat render order or another module changes Toolbelt's DOM. It uses flex wrapping and `min-width: 0` for narrow chat.

Foundry message visibility remains authoritative. Non-GMs do not receive status rows for hidden/unnoticed/undetected targets. Private save results are shown only to a GM or an owner allowed by the Toolbelt data. Generic order labels replace inaccessible names. UUIDs, save totals, DCs, private damage, and diagnostics are never rendered.

## Undo and native records

Undo exists only for a Nelflow-applied target. It reuses `guarded-health-restore.js`, requires exact current HP/temp HP to equal the recorded post-state, and restores only the recorded pre-state. It does not change Toolbelt saves or flags, remove effects, reroll damage, or enable another automatic application. Critical Success, manual, external, persistent, and unknown applications have no Nelflow Undo.

Exact native application-message links are shown only when captured and visible. Native application records and their own controls remain intact. Using native PF2e Undo can desynchronize Nelflow's projection; this remains a documented manual-review limitation.

## Reload

Terminal flags reconstruct from the damage message and do not replay. Applied, No Damage, Manual, External, Error, Undone, and blocked records remain terminal. A transaction found in `applying` on initialization is marked Interrupted rather than resumed. Nelflow never rerolls a save or damage after refresh and does not transfer authority.

## Settings migration and legacy mode

The hidden Slice 3 `basicSaveResolver` setting remains registered for compatibility. Migration version 1 runs once for a GM:

- active, enabled, supported Toolbelt selects `toolbelt`;
- otherwise selects `off`;
- it never silently selects `legacy`;
- it records `migrationVersion` and never overwrites a later explicit selection.

Old resolver messages remain renderable. Legacy save correlation registers only in Legacy mode, and Toolbelt mode never injects Start Basic Save Resolver or creates `flags.nelflow.saveResolver`.

## Known limitations

- Runtime acceptance still requires Foundry V14, PF2e 8.3.x, and Toolbelt 3.52.x.
- There was no installed Toolbelt in the configured local Foundry data path.
- Toolbelt's application queue and application routine are private, so Nelflow cannot atomically lock a simultaneous manual click.
- Native PF2e application Undo is not synchronized back into Nelflow state.
- Splash, persistent damage, healing, non-basic effects, and ambiguous multi-roll cards remain manual.
- Authority does not hand off if the processing GM disconnects.
