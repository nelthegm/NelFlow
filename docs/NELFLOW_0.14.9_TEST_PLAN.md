# Nelflow 0.14.9 Runtime Test Plan

Use Foundry VTT 14, PF2e 8.x, Nelflow 0.14.9, and PF2e Toolbelt 3.54.0.
NelTactics may remain 0.3.2 and should ignore the new hook safely.

Before testing:

```js
game.nelflow.dev.getBasicSavePresentationStatus()
game.nelflow.dev.watchBasicSavePresentationFeed()
game.nelflow.dev.watchBasicSaveDamagePresentationFeed()
```

Expect protocol 2, both hooks, `damageProducerAvailable: true`,
`appliedDamageSource: "transaction-before-after"`, and `tempHpAware: true`.

## A. Failure

1. Use a supported Toolbelt basic-save spell against one target that fails.
2. Confirm `BASIC SAVE TARGET RESULT` occurs first.
3. Confirm `BASIC SAVE TARGET DAMAGE` occurs only after HP application.
4. Compare `applied` with the target's actual normal plus temporary HP loss.
5. Confirm the shared roll total is never substituted when the applied amount differs.

## B. Success plus IWR

1. Use a target whose success and resistance produce a materially different total.
2. Confirm Stage 1 reports authoritative success.
3. Confirm Stage 2 `damage.applied` matches actual target resource loss.
4. Confirm optional `base roll` is contextual only.

## C. Zero

1. Test immunity/resistance-to-zero if convenient.
2. Test an authoritative critical success.
3. Confirm zero emits only for a target conclusively in the supported workflow.
4. Confirm external/manual/persistent-only targets do not receive fake zero events.

## D. Temporary HP

1. Give a target enough temporary HP to absorb all damage.
2. Confirm `damage.applied` reports temporary HP consumed, not false zero.
3. Test damage consuming both temporary and normal HP; confirm the combined loss.

## E. Multi-target and modes

1. Test several targets with different degrees and IWR.
2. Confirm one independent Stage 2 event per actual application.
3. Confirm amounts and target identities remain distinct.
4. Test all-resolved mode; application still waits for every save.
5. Test per-target mode; each event follows that target's application.
6. Test GM-confirm mode; no Stage 2 event occurs before confirmation/application.

## F. NelCine impact synchronization

1. Enable the existing save-batch and impact-sync settings.
2. Confirm Stage 1 occurs when the save becomes READY.
3. Confirm Stage 2 does not occur while the target is awaiting impact.
4. Confirm Stage 2 occurs after the impact-delayed HP commit.
5. Confirm timeout fallback preserves the same ordering.

## G. Reroll, privacy, reload, and Undo

1. Reroll before damage application; confirm no abandoned Stage 2 event.
2. Apply the final result; confirm exactly one Stage 2 event.
3. Repeat message/actor updates; confirm no duplicate Stage 2 event.
4. Test a private Toolbelt save; confirm neither presentation hook leaks it.
5. Reload after a terminal application; confirm no replay or re-emission.
6. Undo applied damage; confirm mechanics remain guarded and no reverse Stage 2 event emits.

## H. Regressions

1. Confirm Toolbelt still rolls saves and owns Target Helper state.
2. Confirm native PF2e floating damage text remains visible.
3. Confirm `nelflow.damageApplied` still fires with its unchanged payload/timing.
4. Confirm NelZones consumers behave unchanged.
5. Confirm NelCine single-save, batch, and impact-sync behavior is unchanged.
6. Confirm Strike protocol 3 attack/damageRolled/resolved hooks are unchanged.
7. Confirm Strike Stage 2 still reports rolled damage rather than target HP loss.
8. Confirm Nelflow works with NelTactics absent.

Runtime acceptance must not be claimed until these checks are performed in Foundry.
