# Nelflow 0.14.8 — Toolbelt 3.54.0 compatibility

Nelflow 0.14.8 repairs live Forge compatibility with PF2e Toolbelt **3.54.0**
and removes a ready-order race that could make NelTactics report presentation
feeds unavailable even when NelFlow was active.

## Root cause

1. NelFlow 0.14.7 verified Toolbelt only through **3.53.1**. Active Toolbelt
   **3.54.0** failed the inclusive max gate, so Target Helper automation and the
   basic-save presentation producer stayed manual/off.
2. Presentation integration APIs were installed only inside async Foundry
   `ready` work. NelTactics probing at `ready` could see
   `strike-feed-unavailable` / `basic-save-feed-unavailable` before install
   completed — independent of Toolbelt support.

## Schema audit (3.53.1 → 3.54.0)

Target Helper durable fields used by NelFlow are unchanged:

`targets[]`, `saveVariants.*.{basic,dc,statistic,saves}`, and per-token
`die` / `value` / `success` / `modifiers` / `private` / `rerolled` / `roll`.

3.54.0 only adds troop/token decode dedupe and a dice sound when Dice So Nice
is absent. No adapter normalization repair was required.

## Compatibility range

`TOOLBELT_MIN_VERSION = 3.52.0`  
`TOOLBELT_MAX_VERSION = 3.54.0`

`3.55.x` and later remain rejected until audited.

## Initialization

`game.nelflow.integrations.strikePresentation` and
`game.nelflow.integrations.basicSavePresentation` register synchronously at
Foundry `init`, then reinstall idempotently during ready.

Unsupported Toolbelt versions still fail open for Toolbelt automation and do
**not** remove Strike protocol 3.

## Diagnostics

```js
game.nelflow.dev.getBasicSavePresentationStatus()
// protocol, hook, toolbeltVersion, toolbeltSupported, producerAvailable, ...
```

## Unchanged

Basic-save presentation protocol 1 payload, Strike protocol 3, HP application,
Undo, NelCine, `nelflow.damageApplied`, and Toolbelt save ownership.
