# Nelflow 0.14.21 — Damage Resource Accounting Audit

## PF2e paths (installed `pf2e.mjs`)

| Resource | Actor path | Notes |
|----------|------------|--------|
| HP | `system.attributes.hp.value` | Always present |
| Temporary HP | `system.attributes.hp.temp` | Always present (may be 0) |
| Stamina | `system.attributes.hp.sp.value` | Only when Stamina variant enabled |

### Stamina variant

- Setting: `game.settings.get("pf2e", "staminaVariant")` / `game.pf2e.settings.variants.stamina`
- When disabled: PF2e's `calculateHealthDelta` never writes `system.attributes.hp.sp.value`
- NelFlow snapshots Stamina as `0` when disabled or absent

### Authoritative distribution

PF2e `ActorPF2e.calculateHealthDelta` applies post-IWR delta in order:

1. Temporary HP
2. Stamina (if variant enabled and `sp` present)
3. Ordinary HP

NelFlow does **not** reimplement this order. It observes before/after snapshots
and/or `AppliedDamageFlag.updates` differences.

### AppliedDamageFlag

`flags.pf2e.appliedDamage.updates[]` entries are `{ path, value }` where `value`
is `(pre - post)` for that path — i.e. the loss amount for damage.

## Existing NelFlow capture path

1. `PF2eAdapter.healthSnapshot(actor)` before `applyDamageRollToRecordedTarget`
2. PF2e `Actor#applyDamage` (IWR included)
3. Unique `damage-taken` capture → `nelflow.damageApplied`
4. Post snapshot → `appliedAmount` / `resourceLoss` on the transaction

## Undo

- Stores `preApplication` / `postApplication` on the transaction
- `guardedHealthRestore` requires current resources to still match `postApplication`
- Restores via `PF2eAdapter.restoreHealth` to `preApplication`
- 0.14.21 extends snapshots/restore with Stamina when recorded; does **not**
  derive Undo from the presentation breakdown

## `nelflow.damageApplied` semantics

Protocol remains **1**. Existing fields unchanged.

0.14.21 **adds** (optional, additive):

```js
resourceLoss: { hp, tempHp, stamina, total }
totalAppliedDamage: number // same as resourceLoss.total when present
```

When `AppliedDamageFlag.updates` identify HP/Temp/SP paths, those populate
`resourceLoss`. Consumers that ignore unknown fields remain compatible.
