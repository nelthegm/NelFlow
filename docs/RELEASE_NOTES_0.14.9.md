# Nelflow 0.14.9 — Basic-save target damage presentation feed

Nelflow 0.14.9 extends `game.nelflow.integrations.basicSavePresentation` from
protocol 1 to protocol 2 with a GM-local, presentation-neutral per-target damage
result hook:

```text
nelflow.basicSaveTargetDamageAppliedPresentation
```

The existing `nelflow.basicSaveTargetResolvedPresentation` hook and all protocol-1
semantics remain intact.

## Authoritative damage meaning

`damage.applied` is the positive magnitude of actual normal plus temporary HP
lost by the exact target after PF2e's real contextual application. Nelflow derives
it from the transaction's already-existing before/after normal and temporary HP
snapshots. It does not recreate immunity, weakness, resistance, hardness, damage
types, or save multiplier logic.

This differs intentionally from Strike Stage 2, whose `damage.total` is rolled
damage before target IWR.

## Timing and zero

- Normal/per-target/all-resolved/GM-confirm paths emit after the exact target's
  persisted application result is known.
- NelCine impact-synchronized targets emit only after the delayed HP commit.
- Existing conclusive critical-success `no-damage` transitions emit zero.
- PF2e applications reduced to zero by IWR emit zero from unchanged snapshots.
- External/manual/unrelated targets do not receive fabricated events.
- Undo emits no reverse presentation event in this release.

## Compatibility

- Toolbelt 3.54.0 remains observe-only; no Toolbelt APIs or flags are mutated.
- NelTactics 0.3.2 continues consuming protocol 1 fields and may ignore Stage 2.
- NelCine is not wired to the new hook.
- `nelflow.damageApplied` and NelZones mechanics integration are unchanged.
- Strike presentation protocol 3 is unchanged.
- Native PF2e floating damage text is not suppressed.

Foundry runtime acceptance should follow
[`NELFLOW_0.14.9_TEST_PLAN.md`](NELFLOW_0.14.9_TEST_PLAN.md).
