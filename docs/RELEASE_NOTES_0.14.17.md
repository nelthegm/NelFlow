# Nelflow 0.14.17 — Compact Strike stack grouping repair

## Root cause

Combat-turn parent stack identity included two volatile inputs:

1. **`turnIndex` (`combat.turn`)** in `combatStackKey`
2. **`combat._stats.modifiedTime` (or `Date.now()`)** inside `flags.nelflow.turnMarker.markerId`

During a single Gorewing activation, NelTempo / Dynamic Initiative (or any Combat
document update) can reshape `combat.turn` or bump Combat `_stats.modifiedTime`
without ending the logical activation. Each Strike then minted a **new**
`turnMarkerId` / key → a new deterministic stack ChatMessage (`1 Strike` cards).

## Fix

- `markerId = hash(combatId|round|combatantId|activationSeq)` — no modifiedTime,
  no turn index
- `activationSeq` increments only when **round** or **active combatant** changes
- `combatStackKey` no longer includes `turnIndex` (observational only)
- `combatTurnChange` ignores turn-index-only noise when the same combatant remains
  active
- Stack-follow (`isActiveCombatStack`) matches durable `turnMarkerId`, not
  live `combat.turn`

## Unchanged

Strike/damage mechanics, Undo, Toolbelt, NelCine, NelZones, presentation
protocols, Workbench settings.

## Reload

Existing `stackRef` freeze + deterministic stack message IDs are preserved.
Same-activation Strikes continue appending rows to one parent.
