# Nelflow 0.14.11 — Authoritative Strike Target Damage Applied Presentation

Nelflow 0.14.11 extends `game.nelflow.integrations.strikePresentation` from
protocol 3 to protocol 4 with a GM-local, presentation-neutral post-application
Strike hook:

```text
nelflow.strikeDamageAppliedPresentation
```

## Stages

1. `attack` — `nelflow.strikeAttackResolvedPresentation`
2. `damageRolled` — `nelflow.strikeDamageRolledPresentation`
   - `damage.total` = native rolled DamageRoll total **before** IWR
3. `damageApplied` — `nelflow.strikeDamageAppliedPresentation` **(new)**
   - `damage.applied` = actual target normal + temporary HP loss **after** PF2e application
4. `resolved` — `nelflow.strikeResolvedPresentation` (unchanged)

## Actual damage source

NelFlow does **not** reimplement IWR. Actual applied damage is observed from
authoritative pre/post HP + temporary HP snapshots after the existing PF2e
application path:

```text
max(0, preHp + preTempHp − postHp − postTempHp)
```

Source label: `hp-temp-snapshots` (`tempHpAware: true`).

## Compatibility

- Stage 2 rolled semantics are unchanged.
- Protocol ≥ 3 consumers continue to work.
- `nelflow.damageApplied` mechanics integration is unchanged (NelZones).
- Basic-save presentation protocol 3 is unchanged.
- Undo emits no reverse Strike presentation event.
- Native PF2e floating damage text is not suppressed.
- Multi-target Strike presentation limitation is unchanged.
- NelTactics is not modified in this release.

Foundry runtime acceptance should follow
[`NELFLOW_0.14.11_TEST_PLAN.md`](NELFLOW_0.14.11_TEST_PLAN.md).
