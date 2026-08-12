# Nelflow 0.14.10 Runtime Test Plan

Use Foundry VTT 14, PF2e 8.x, Nelflow 0.14.10, and PF2e Toolbelt 3.54.0.
NelTactics may remain 0.3.2 and should ignore the new hook safely.

Before testing:

```js
game.nelflow.dev.getBasicSavePresentationStatus()
game.nelflow.dev.watchBasicSavePresentationFeed()
game.nelflow.dev.watchBasicSaveDamagePresentationFeed()
```

Expect protocol 3, all three hooks, `damageProducerAvailable: true`,
`appliedDamageSource: "transaction-before-after"`, and `tempHpAware: true`.

## A. Applying ownership reservation

1. Use a supported Toolbelt basic-save spell against one target that fails.
2. Confirm `BASIC SAVE TARGET RESULT` occurs first.
3. Confirm `BASIC SAVE TARGET DAMAGE APPLYING` occurs after validation and
   immediately before HP application.
4. Confirm `BASIC SAVE TARGET DAMAGE` occurs only after HP application.
5. Compare applied-stage `damage.applied` with the target's actual normal plus
   temporary HP loss.

## B. Success plus IWR

1. Use a target whose success and resistance produce a materially different total.
2. Confirm Stage 1 reports authoritative success.
3. Confirm applying-stage has the same `damageResultId` / target and no
   `damage.applied` field.
4. Confirm applied-stage `damage.applied` matches actual target resource loss.

## C. Zero

1. Test immunity/resistance-to-zero if convenient.
2. Test an authoritative critical success.
3. Confirm zero emits only for a target conclusively in the supported workflow.
4. Confirm external/manual/persistent-only targets do not receive fake events.

## D. Temporary HP

1. Give a target enough temporary HP to absorb all damage.
2. Confirm applied-stage `damage.applied` reports temporary HP consumed.
3. Test damage consuming both temporary and normal HP; confirm the combined loss.

## E. Multi-target and modes

1. Test several targets with different degrees and IWR.
2. Confirm one independent applying and applied event pair per actual application.
3. Test all-resolved, per-target, and GM-confirm modes.

## F. NelCine impact synchronization

1. Enable the existing save-batch and impact-sync settings.
2. Confirm Stage 1 occurs when the save becomes READY.
3. Confirm applying/applied stages do not occur while awaiting impact.
4. Confirm both stages occur after the impact-delayed HP commit.

## G. Reroll, privacy, reload, and Undo

1. Reroll before damage application; confirm no abandoned applying/applied events.
2. Apply the final result; confirm exactly one applying and one applied event.
3. Test a private Toolbelt save; confirm no presentation hook leaks it.
4. Reload after a terminal application; confirm no replay or re-emission.
5. Undo applied damage; confirm mechanics remain guarded and no reverse events emit.

## H. Regressions

1. Confirm Toolbelt still rolls saves and owns Target Helper state.
2. Confirm native PF2e floating damage text remains visible.
3. Confirm `nelflow.damageApplied` still fires with its unchanged payload/timing.
4. Confirm NelZones consumers behave unchanged.
5. Confirm NelCine single-save, batch, and impact-sync behavior is unchanged.
6. Confirm Strike protocol 3 attack/damageRolled/resolved hooks are unchanged.
7. Confirm Nelflow works with NelTactics absent.

Runtime acceptance must not be claimed until these checks are performed in Foundry.
