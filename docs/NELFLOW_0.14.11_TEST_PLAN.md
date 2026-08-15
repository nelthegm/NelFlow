# Nelflow 0.14.11 Runtime Test Plan

Use Foundry VTT 14, PF2e 8.x, Nelflow 0.14.11, and PF2e Toolbelt 3.54.0.

## Diagnostics

```js
game.nelflow.dev.watchStrikePresentationFeed()
game.nelflow.integrations.strikePresentation.getStatus()
```

Expect:

- `protocol: 4`
- `damageAppliedHook: "nelflow.strikeDamageAppliedPresentation"`
- `actualDamageSource: "hp-temp-snapshots"`
- `tempHpAware: true`
- stages: `attack`, `damageRolled`, `damageApplied`, `resolved`

## A. Normal Strike

Rolled 20, no IWR.

Expected:

```text
STRIKE DAMAGE ROLLED
rolled: 20

STRIKE DAMAGE APPLIED
rolled: 20
applied: 20
```

## B. Weakness (critical)

Rolled 20, weakness fire 10, PF2e applies 30.

Expected:

```text
STRIKE DAMAGE ROLLED → rolled: 20
STRIKE DAMAGE APPLIED → applied: 30
```

## C. Resistance

Rolled 20, actual 10 → `applied: 10`.

## D. Temporary HP

Temp-only or mixed temp + normal loss must appear in `applied` (not 0 when only
temp was consumed).

## E. Zero

Immunity / resistance-to-zero with a real application → `applied: 0`.

Miss → no damageRolled / no damageApplied.

## F. Basic save

Protocol 3 unchanged (`targetResolved` / `targetDamageApplying` /
`targetDamageApplied`).

## G. NelZones / nelflow.damageApplied

Mechanics bridge unchanged; no regression.

## Contract reminder

| Stage | Amount meaning |
| --- | --- |
| Strike `damageRolled` | rolled native DamageRoll total |
| Strike `damageApplied` | actual target damage after PF2e IWR + temp HP |
