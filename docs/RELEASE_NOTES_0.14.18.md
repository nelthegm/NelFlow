# Nelflow 0.14.18 — Compact Strike row readability

## Layout

Each single-target NPC Strike row has four compact presentation regions:

```text
Greatclub · MAP −5 → Vincent
Critical Hit · 34
Damage · 47 Bludgeoning · Applied (47 HP)
[attack] [critical damage] [undo]
```

The heading retains the existing Strike name, MAP projection, and authorized
target label. The attack line shows the stored authoritative PF2e/Nelflow degree
of success and, when available to the viewer, the evaluated total from the exact
linked native attack roll. It never recalculates a degree against AC, rebuilds a
formula, or parses chat HTML.

The damage line exists only when Nelflow can resolve an exact authorized native
damage record for that transaction and row. It uses the existing structured
damage summary and existing transaction/application state. Rolled damage and
actual applied HP remain separate, so `Damage · 18 Slashing · Applied (12 HP)`
correctly represents PF2e resistance or other IWR handling. A miss without a
real linked damage record has no damage line or damage control.

## Exact icon controls

When the viewer opens **Results**, the exact attack and damage inspection
buttons appear in the same nowrap control row as guarded Undo. The controls use
bundled Font Awesome classes:

- Attack: `fa-solid fa-dice-d20`
- Damage / critical damage: `fa-solid fa-burst`
- Undo: `fa-solid fa-rotate-left`

No empty slots are reserved. Each control is a semantic `button` with a
localized `aria-label` and `title`, normal keyboard focus, Enter/Space button
activation, and a theme-compatible `:focus-visible` outline. Attack and damage
buttons refresh and inspect only the exact transaction-linked native message;
they never search by name, time, or chat proximity. Undo still calls the
existing guarded `StrikeResolver.undoFromMessage` pathway.

## Privacy and rehydration

`NativeRecordsController.recordsForRow` remains the visibility and exact-link
gate. If the viewer cannot access the exact attack record, its total is omitted.
If the viewer cannot access the exact damage record, no damage line or damage
inspection button is projected. The redesign adds no IDs, UUIDs, formulas,
proof records, or GM diagnostics to player-visible text.

Rows are rebuilt from durable stack/transaction flags and existing native
messages after reload. Rendering does not roll, apply, update, delete, or create
documents. Existing stack follow reparents the same DOM node, preserving all
listeners.

## Unchanged

Strike and damage mechanics, targeting, exact correlation, stack identity,
PF2e IWR and `Actor#applyDamage`, Shield Block, multi-target behavior, guarded
Undo, native cards, Results disclosure, stack follow/collapse, Riders, Actions,
Toolbelt, NelCine, NelZones, NelTempo, Dice So Nice, and all presentation
protocol versions are unchanged.

## Known limitations

- This layout applies to single-target compact NPC Strike rows; shared-roll
  multi-target rows retain their established target-list presentation.
- Exact attack/damage icons follow the existing Results disclosure state. The
  redesign does not automatically open or close Results.
- An authorized outcome may remain visible without a total when the exact native
  attack message is unavailable or not visible to that viewer.
- Runtime acceptance in Foundry V14/PF2e still requires the manual checklist;
  repository tests and static validation are not runtime acceptance.
