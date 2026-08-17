# Nelflow 0.14.13 — Runtime Test Plan

Run with Foundry V14, PF2e 8.x, published Nelflow **0.14.13**.
NelTactics 0.6.0 may remain enabled (unchanged).

```js
game.nelflow.dev.watchSpellAttackFlow()
```

## A. Ray of Frost / standard spell attack

Target one enemy. Roll spell attack. On success, press Damage.

Expected:

- Native DamageRoll appears
- NelFlow correlates and auto-applies to that target
- No second Apply Damage click
- HP changes exactly once

## B. Target change (critical safety)

Attack Target A successfully. Before Damage, retarget to B. Press Damage.

Expected: **A** takes damage; **B** takes none. If B is damaged → FAIL.

## C. No target

Spell attack with no exact target → no auto-apply; manual PF2e workflow remains.

## D. Multiple targets

Two targets selected for a single-target spell attack → no auto-apply; do not
pick the first target.

## E. Miss

Failure / critical failure → do not auto-apply ordinary damage if Damage is
rolled manually.

## F. Critical success

Use PF2e Critical Damage. Exact critical DamageRoll auto-applies once (no
NelFlow double-crit).

## G. Weakness

Rolled 20; weakness +10 → watcher `rolled=20` `applied=30`.

## H. Resistance

Rolled 30; actual 20 → `applied=20`.

## I. Temp HP

Temp + normal loss both counted in `applied`.

## J. Overkill

5 HP left; rolled 30 → `applied=5`.

## K. Two casts before damage

Same spell twice before either Damage roll → exact correlation **or** explicit
ambiguous fail-open. Never wrong-target apply.

## L. Fireball / basic save

Toolbelt/basic-save path unchanged.

## M. Weapon Strike

Strike auto-apply / presentation protocol 4 unchanged.

## N. Healing

Healing feed protocol 1 unchanged.

## O. NelZones

Spell auto-applied damage still emits `nelflow.damageApplied`; supported
reactions continue.

## Dev status

```js
game.nelflow.dev.getSpellAttackStatus()
// enabled, supportedTargetCount: 1, presentation.protocol: 1
```
