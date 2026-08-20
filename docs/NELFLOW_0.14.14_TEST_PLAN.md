# Nelflow 0.14.14 Runtime Test Plan

Use Foundry VTT 14, PF2e 8.x, Nelflow 0.14.14, PF2e Toolbelt 3.54.1, and
NelTactics 0.7.0. Runtime acceptance must not be claimed from static tests.

## A. Startup and diagnostics

1. Enable Toolbelt Target Helper and Nelflow.
2. Confirm no unsupported-Toolbelt warning appears.
3. Run `game.nelflow.dev.getStatus()`.
4. Confirm Toolbelt version `3.54.1`, `supported: true`, range
   `3.52.0 - 3.54.1`, availability `true`, and schema
   `3.54.1-audited`.
5. Confirm `getBasicSavePresentationStatus()` reports protocol 3 and the same
   Toolbelt compatibility state.

## B. Basic save

1. Use Fireball or another supported Target Helper basic save.
2. Confirm Toolbelt writes its normal save results.
3. Confirm each target moves from pending to ready as before.
4. Confirm `targetResolved` emits exactly once with exact target, statistic, DC,
   natural die, modifier, total, degree, privacy, and reroll data.
5. Confirm damage auto-application retains current mode/timing.
6. Confirm `targetDamageApplying` occurs immediately before PF2e application.
7. Confirm `targetDamageApplied` occurs afterward with actual normal plus
   temporary HP resource loss.

## C. Multi-target

1. Test at least three targets.
2. Confirm A/B/C save results and application records remain independent.
3. Confirm batch identity remains shared while target and damage-result
   identities remain distinct.
4. Confirm no duplicate application and no cross-target overwrite.
5. Test all-resolved and per-target modes if both are used by the world.

## D. Degrees, IWR, and zero

1. Exercise critical success, success, failure, and critical failure.
2. Confirm existing basic-save multipliers remain unchanged.
3. With resistance or weakness, confirm PF2e remains authoritative.
4. Confirm applied presentation reports actual HP/temp-HP loss rather than the
   shared base roll.
5. Confirm a conclusive zero remains zero without a fabricated application.

## E. Reroll and privacy

1. Reroll one Toolbelt save if practical.
2. Confirm the replacement result has a new fingerprint and superseded data is
   not applied or duplicated.
3. Confirm unchanged message metadata does not duplicate presentation.
4. Test a private/secret save and confirm no hidden result or target leak.

## F. Regression checks

1. Test a normal Strike; Strike protocol 4 and automation remain unchanged.
2. Test the current single-target spell-attack flow, including native damage
   correlation, PF2e application, diagnostics, and guarded Undo.
3. Confirm spell-attack presentation remains protocol 1.
4. Test healing and confirm healing presentation remains protocol 1.
5. Confirm NelCine basic-save consumers retain their existing timing/payloads.
6. Confirm `nelflow.damageApplied` still reaches NelZones consumers unchanged.
7. Confirm native PF2e cards and floating damage remain intact.

## G. Unsupported future version guard

When a controlled fixture is available, verify Toolbelt 3.54.2 reports
unsupported, does not start Target Helper automation, and leaves manual controls
available. Do not install an unaudited version merely to complete acceptance.
