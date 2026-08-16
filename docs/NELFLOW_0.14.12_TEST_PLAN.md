# Nelflow 0.14.12 — Runtime Test Plan

Run with Foundry V14, PF2e 8.x, published Nelflow **0.14.12**.

```js
game.nelflow.dev.watchHealingPresentationFeed()
```

## A. Normal heal

Target missing 30 HP; apply healing that restores 20.

Expected:

```
HEALING APPLIED … applied=20
```

PF2e HP increases by 20.

## B. Overheal (critical)

Target missing 10; heal roll 30; apply full healing.

Expected:

```
HEALING APPLIED … applied=10
```

Not 30.

## C. Full HP

If PF2e records a healing appliedDamage with zero normal HP delta → `applied=0`.
If PF2e omits appliedDamage for a no-op → **no** NelFlow event (do not invent).

## D. Multi-target

3-action Heal (or multi-token apply): each target gets its own applied amount.

## E. Manual HP edit

Increase HP on the actor sheet.

Expected: **no** healing presentation event.

## F. Undo

Undo a damage transaction (HP restores).

Expected: **no** healing presentation event.

## G. Strike

No regression — protocol 4 attack / damageRolled / damageApplied / resolved.

## H. Basic save

No regression — protocol 3 targetResolved / applying / applied.

## I. Temp HP

If a workflow grants only temporary HP, expect **no** `healing.applied` emission.

## Dev status

```js
game.nelflow.dev.getHealingPresentationStatus()
// protocol 1, applyingHook null, appliedHook set, tempHpIncluded false
```
