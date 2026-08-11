# Nelflow 0.14.6 runtime test plan

Foundry generation 14 + Nelflow **0.14.6**. Optional NelTactics for consumer
checks. Do not modify NelTactics from this plan.

```js
game.modules.get("nelflow")?.version // "0.14.6"
game.nelflow.integrations.strikePresentation.getStatus()
// protocol: 3, damageRolledHook: "nelflow.strikeDamageRolledPresentation"

game.nelflow.dev.watchStrikePresentationFeed()
```

## A — PC Hit

1. Roll PC Strike → expect `STRIKE ATTACK` immediately.
2. Do not click Damage yet → no `STRIKE DAMAGE ROLLED`.
3. Click native Damage → expect `STRIKE DAMAGE ROLLED` as soon as the native
   DamageRoll is correlated, **before** `STRIKE RESOLVED`.
4. Native attack/damage cards remain fully visible; one Applied/Undo footer.

## B — Visual timing

Confirm Stage 2 arrives early enough that a consumer can pan the target when
Damage is clicked, without waiting for HP application completion.

## C — IWR

Native roll 30, resistance reduces HP loss to 20.

Expected:

- DAMAGE ROLLED total: **30**
- later application / damageApplied reflects applied result
- Stage 2 does not wait for or substitute the 20

## D — Two attacks first

Attack A, Attack B, then Damage A, Damage B.

Expected:

- ATTACK A, ATTACK B
- DAMAGE ROLLED A, DAMAGE ROLLED B
- exact shared transaction IDs per Strike

## E — PC Miss

ATTACK only. No damageRolled.

## F — NPC Hit

ATTACK → DAMAGE ROLLED (as soon as damage roll exists) → RESOLVED.

## G — NPC Miss

No damageRolled.

## H — NelCine

One cinematic when ON; none when OFF; impact-sync once; Stage 2 does not add
NelCine playback.

## I — NelZones

`nelflow.damageApplied` unchanged after application.
