# Nelflow 0.14.12 — Release Notes

## Slice

Authoritative Healing Presentation Feed

## Baseline

- From: **0.14.11** (`ad803aa`, 1,355 tests)
- Strike presentation protocol: **4** (unchanged)
- Basic-save presentation protocol: **3** (unchanged)

## What changed

NelFlow observes PF2e healing applications that produce a `damage-taken`
ChatMessage with `appliedDamage.isHealing === true` and emits:

`nelflow.healingAppliedPresentation`

with:

```js
healing.applied // actual normal HP restored
```

### Integration

```js
game.nelflow.integrations.healingPresentation
// protocol: 1
// appliedHook: "nelflow.healingAppliedPresentation"
// stages: { applying: false, applied: true }
```

Pre-application ownership is **not** claimed. Native PF2e owns chat healing
`applyDamage`; wrapping it would require private patches.

### Semantics

| Case | Result |
|------|--------|
| Missing 30, restores 20 | `applied: 20` |
| Missing 10, roll 30 | `applied: 10` (overheal capped by PF2e deltas) |
| Conclusive zero HP delta in flag | `applied: 0` |
| Temp-HP-only update | no emission |
| Manual HP edit / Undo | no emission |

### Dev

```js
game.nelflow.dev.getHealingPresentationStatus()
game.nelflow.dev.watchHealingPresentationFeed()
```

## Preserved

- Strike protocol 4
- Basic-save protocol 3
- `nelflow.damageApplied` (still rejects healing)
- NelZones integration
- NelCine healing cinematics bridge (independent)

## Docs

- [HEALING_PRESENTATION_CONTRACT.md](./HEALING_PRESENTATION_CONTRACT.md)
- [NELFLOW_0.14.12_TEST_PLAN.md](./NELFLOW_0.14.12_TEST_PLAN.md)
