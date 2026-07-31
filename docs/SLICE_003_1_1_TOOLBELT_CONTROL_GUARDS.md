# Slice 3.1.1: Toolbelt Damage-Control Guards

## Purpose

Slice 3.1 proved that Nelflow can apply each finalized Toolbelt basic-save result through PF2e's native damage pathway. Toolbelt still rendered active Damage, Half, Double, and Triple controls afterward, which made a second accidental HP application possible. Slice 3.1.1 adds a presentation-only guard for the exact handled target. The persisted Nelflow transaction remains mechanical authority; the guard never drives application.

## Verified Toolbelt 3.52.x markup

Toolbelt 3.52.0 and 3.52.1 clone PF2e's `.damage-application` block for each target. The clone carries `data-target-uuid` and `data-target-roll-index`. Native action names are prefixed with `target-`: HP application is `data-action="target-applyDamage"`, with `data-multiplier` 0.5, 1, 2, or 3 for Half, Damage, Double, and Triple. Shield Block is `target-shieldBlock`; it toggles PF2e's shield-block selection state and does not apply HP damage. Save, reroll, and ping actions are `roll-save`, `reroll-save`, and `ping-target`. Nelflow therefore leaves Block and all non-application actions untouched.

## Exact identity and fail-open rule

The renderer requires the ChatMessage ID, normalized Toolbelt target key, token UUID, actor UUID, Toolbelt roll index, deterministic Nelflow application ID, persisted target state, and a row already visible to the viewer. It selects exactly one target container by token UUID plus roll index and then recognizes only semantic `target-applyDamage` controls with the four verified multipliers. Names, labels, row order, timing, and proximity alone are never identity. Missing, ambiguous, or replaced markup remains fully usable and produces one debug-only diagnostic.

## Guarded and manual states

Applied and No Damage are guarded. External Application is guarded only while Toolbelt's current structured applied marker confirms it. Result Changed remains guarded. Undo Blocked, Interrupted, and manual-review-required are guarded only when persisted pre/post HP snapshots and an application ID prove a completed prior Nelflow application.

Pending Save, Ready, Claimed, Applying, ordinary Manual, Error, Undone, unsupported, persistent-damage, splash-only, and otherwise uncertain states fail open. Successful Undo changes the transaction to Undone, so the next synchronous render removes only Nelflow's presentation attributes and restores the control's original disabled, ARIA, title, and tooltip values.

## Render and interception architecture

`ToolbeltControlGuard.render` is called from the existing setup-time `renderChatMessageHTML` projection. It reconciles old Nelflow guards, revalidates current structured state, and applies an idempotent guard. A WeakSet allows one capture-phase click and keydown listener per rendered message root. Enter, Space, and pointer activation are blocked only after a second exact persisted/normalized identity check. Disabling the world setting bypasses interception and restores presentation. There is no polling, timeout, MutationObserver, simulated click, Toolbelt-listener call, or document write caused by rendering.

## Status, Undo, and manual override

An exact successfully guarded row shows **Damage Controls Guarded**. Undo continues through Slice 3.1's guarded-health restore. A refused Undo becomes Undo Blocked and stays guarded.

The processing GM can choose **Enable Manual Damage** for a conclusive target. Foundry's modal confirmation warns about duplicate or superseding application. Confirmation persists optional `manualControlsEnabled`, `manualControlsEnabledBy`, and `manualControlsEnabledAt` fields without changing HP, save data, multiplier, or Nelflow state. **Guard Damage Controls** clears the override. Older 0.3.1 records have no field and therefore behave as `false`; no bulk migration or schema break is required. Manual damage used after an override is intentionally not tracked.

No Damage has no Nelflow Undo but is guarded and can be explicitly overridden. External Application offers no Nelflow Undo. Result Changed preserves the existing application record and guarded Undo; it never automatically undoes, reapplies, or changes the multiplier.

## Reload, authority, privacy, and compatibility

Every decision derives from the existing ChatMessage flag and current normalized Toolbelt data, so reload, chat reopening, historical rendering, and ordinary rerenders reconstruct the projection without replaying mechanics. Only the transaction's processing GM can persist override changes. Other GMs and players can render only rows they already have permission to see; UUIDs, processing-user identity, private HP, and override-user identity are never added to visible status.

The implementation is source-checked against Toolbelt 3.52.0 and 3.52.1 and preserves PF2e native cards, Workbench, Dice So Nice, Better Chat Message, native application records, native revert, Nelflow Undo, and NPC Strike automation. Modules that replace the expected semantic markup cause a safe fail-open result.

## Diagnostics

Debug mode can emit: `toolbelt-control-guard-applied`, `toolbelt-control-guard-skipped`, `toolbelt-control-guard-restored`, `toolbelt-manual-controls-enabled`, `toolbelt-manual-controls-reguarded`, `toolbelt-guard-identity-missing`, `toolbelt-guard-control-unrecognized`, and `toolbelt-guard-blocked-activation`. Payloads contain shortened identifiers, message/target keys, roll index, action, and reason—not target names, message content, or full Toolbelt flags.

## Known limitations

- Native PF2e application Undo does not reconcile Nelflow's independent transaction.
- Damage applied after Manual Override is not tracked or automatically re-guarded.
- Toolbelt markup changed by another module fails open.
- Persistent, splash, and healing applications remain outside Nelflow automation.
- Toolbelt exposes no private atomic application queue, so GM Confirmation remains safest when manual and automatic actions could race.
