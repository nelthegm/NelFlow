# Nelflow 0.14.7 — Presentation-neutral basic-save result feed

Nelflow 0.14.7 publishes authoritative per-target Toolbelt basic-save results
for optional presentation consumers (for example NelTactics) without changing
save mechanics.

## What changed

- New hook: `nelflow.basicSaveTargetResolvedPresentation`
- New API: `game.nelflow.integrations.basicSavePresentation` (protocol **1**)
- Dev helpers: `watchBasicSavePresentationFeed()` / `getBasicSavePresentationStatus()`
- Adapter lifts Toolbelt `die`, `value`, and `modifiers` when present

## What did not change

- Toolbelt still rolls and stores saves
- NelFlow still observes and applies damage on existing modes
- Degree multipliers, Undo, NelCine, Strike feeds, and `damageApplied` unchanged
- No clickable save dice; no Toolbelt patches; no NelTactics changes in this slice

## Contract summary

See [BASIC_SAVE_PRESENTATION_CONTRACT.md](BASIC_SAVE_PRESENTATION_CONTRACT.md).

Ideal NelTactics display when die + modifier exist:

```text
[d20 14] +22 = 36
       SAVED!
```

When only total + degree exist:

```text
36
SAVED!
```

NelFlow never fabricates missing natural/modifier values.

## Manual acceptance

1. Enable `game.nelflow.dev.watchBasicSavePresentationFeed()`
2. Run a normal Toolbelt basic Reflex save
3. Confirm watcher output appears as soon as the Toolbelt result is READY
4. Multi-target: each target prints independently in Toolbelt order
5. Confirm HP / NelCine behavior unchanged
