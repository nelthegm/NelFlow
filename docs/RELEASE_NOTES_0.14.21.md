# NelFlow 0.14.21

## Damage Resource Accounting

NelFlow now accounts for all damage-bearing resource loss from PF2e's
authoritative application:

- Ordinary HP
- Temporary HP
- Stamina (when the PF2e Stamina variant is enabled)

### Display

Primary line:

```text
Applied 20 Damage
```

When Temp HP or Stamina participated:

```text
Applied 20 Damage
10 Temp HP · 6 Stamina · 4 HP
```

HP-only applications stay compact (no zero-component clutter).

### Semantics

`totalApplied = hpLoss + tempHpLoss + staminaLoss` (each clamped ≥ 0).

Incoming/requested damage is never treated as applied damage. Resistance,
immunity, and overkill follow actual post-PF2e resource deltas.

### Compatibility

- `appliedAmount` / presentation totals = `totalApplied`
- `nelflow.damageApplied` protocol **1** unchanged; additive `resourceLoss` /
  `totalAppliedDamage` when available
- Undo still restores snapshotted resources (now including Stamina when present)
- PC native cards and NPC stacks keep their architectures

See [NELFLOW_0.14.21_DAMAGE_RESOURCE_AUDIT.md](./NELFLOW_0.14.21_DAMAGE_RESOURCE_AUDIT.md)
and [NELFLOW_0.14.21_TEST_PLAN.md](./NELFLOW_0.14.21_TEST_PLAN.md).
