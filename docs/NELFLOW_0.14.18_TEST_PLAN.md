# Nelflow 0.14.18 Runtime Test Plan — Compact Strike row readability

Use Foundry V14, a supported PF2e 8.x build, and Nelflow 0.14.18. Exercise both
GM and player views. Static validation does not replace this runtime pass.

## A. Outcome and damage lines

1. Make single-target NPC Strikes producing success, critical success, failure,
   and critical failure.
2. Confirm each row displays the stored outcome and exact native attack total on
   its own line (`Hit · 24`, `Critical Hit · 33`, `Miss · 18`, and so on).
3. Confirm a visible exact hit damage record produces a second line beginning
   with **Damage**.
4. Confirm misses without real damage records display neither `Damage · 0` nor a
   damage icon.
5. Remove or make an attack record unavailable to the viewer; confirm the
   authorized outcome remains and no total is invented.

## B. Structured damage and application state

1. Test single-type and mixed-type damage; confirm existing structured damage
   type/component text remains readable.
2. Test resistance, weakness, immunity, and temporary HP. Confirm rolled damage
   stays distinct from the actual applied HP amount.
3. Test auto-apply off, applied, successful Undo, and blocked Undo. Confirm the
   damage line uses the existing Not Applied, Applied, Undone, and guarded state
   semantics without changing mechanics.

## C. Controls and accessibility

1. Open Results and confirm Attack, Damage (or Critical Damage), and eligible
   Undo appear as small icons in one horizontal row with no blank slots.
2. Confirm hit/not-applied has no Undo, and a normal miss has only Attack.
3. Hover and click Attack and Damage; confirm each inspects its exact native
   message, including two rapid identical Strikes.
4. Tab through all controls. Confirm a visible focus indicator and localized
   tooltip/accessibility name. Activate with Enter and Space.
5. Use Undo and confirm only the exact row changes via existing safety checks.

## D. Stack behavior

1. Test MAP 0, MAP −5/−4, and MAP −10/−8 headings.
2. Collapse and expand the stack; confirm the redesigned rows hide/restore while
   the header and authorized Results remain available.
3. Update a live active stack with Keep Active Turn Stack at Bottom enabled;
   confirm Attack, Damage, Undo, Results, Riders, Actions, and disclosure still
   work after the exact DOM node is moved.
4. Rerender and reload. Confirm the same layout returns without rerolls,
   applications, duplicate rows, or duplicate stacks.

## E. Privacy and compatibility

1. Compare GM and player views for public, whisper, blind, and self rolls.
   Confirm totals and exact controls appear only when the linked message is
   visible and no target UUID, transaction ID, diagnostic, or application proof
   leaks to players.
2. Confirm ordinary player-character PF2e Strike cards remain native.
3. Confirm Toolbelt basic-save cards and save automation are unchanged.
4. Test PF2e Workbench, Toolbelt, Dice So Nice, NelCine, NelZones, NelTempo, and
   relevant chat modules separately and together.
5. Confirm native PF2e messages remain intact and usable according to the
   existing stack-first/native-card settings.

Record Foundry, PF2e, Toolbelt, and optional-module versions with results. Do not
claim runtime acceptance until every applicable scenario passes in Foundry.
