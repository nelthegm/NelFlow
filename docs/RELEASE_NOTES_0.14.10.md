# Nelflow 0.14.10 — Basic-save damage applying ownership reservation

Nelflow 0.14.10 extends `game.nelflow.integrations.basicSavePresentation` from
protocol 2 to protocol 3 with a GM-local, presentation-neutral per-target damage
ownership reservation hook:

```text
nelflow.basicSaveTargetDamageApplyingPresentation
```

The existing `nelflow.basicSaveTargetResolvedPresentation` and
`nelflow.basicSaveTargetDamageAppliedPresentation` hooks and all prior protocol
semantics remain intact.

## Timing

The applying hook emits immediately before PF2e `applyDamage` after validation.
The applied hook continues to report actual normal plus temporary HP loss from
durable before/after snapshots after PF2e save/IWR handling.

## Compatibility

- Toolbelt 3.54.0 remains observe-only; no Toolbelt APIs or flags are mutated.
- NelTactics may continue consuming protocol 1–2 fields and ignore Stage 3.
- NelCine is not wired to the new hook.
- `nelflow.damageApplied` and NelZones mechanics integration are unchanged.
- Strike presentation protocol 3 is unchanged.
- Native PF2e floating damage text is not suppressed.
- Undo emits no reverse presentation event in this release.

Foundry runtime acceptance should follow
[`NELFLOW_0.14.10_TEST_PLAN.md`](NELFLOW_0.14.10_TEST_PLAN.md).

## Stages

1. `targetResolved` — authoritative save result
2. `targetDamageApplying` — ownership reservation immediately before PF2e application
3. `targetDamageApplied` — authoritative actual target damage after PF2e application

Failure after reservation does not emit a false applied event; consumers should
treat ownership as time-bounded. Critical-success conclusive zeros skip applying.
