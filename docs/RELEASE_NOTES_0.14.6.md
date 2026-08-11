# Nelflow 0.14.6 — Immediate Strike damage-rolled feed

Nelflow 0.14.6 adds Stage 2 of the presentation-neutral Strike feed:
`nelflow.strikeDamageRolledPresentation`. Consumers such as NelTactics can pan
the target and show rolled damage as soon as the authoritative native PF2e
DamageRoll exists — without waiting for IWR application or HP verification.

## Three-stage contract (protocol 3)

| Stage | Hook | Meaning |
| --- | --- | --- |
| 1 | `nelflow.strikeAttackResolvedPresentation` | Authoritative attack check resolved |
| 2 | `nelflow.strikeDamageRolledPresentation` | Exact native Strike DamageRoll exists |
| 3 | `nelflow.strikeResolvedPresentation` | Existing final resolved Strike event |

```js
game.nelflow.integrations.strikePresentation.getStatus()
// {
//   protocol: 3,
//   attackHook: "nelflow.strikeAttackResolvedPresentation",
//   damageRolledHook: "nelflow.strikeDamageRolledPresentation",
//   resolvedHook: "nelflow.strikeResolvedPresentation",
//   hook: "nelflow.strikeResolvedPresentation",
//   stages: { attack: true, damageRolled: true, resolved: true },
//   available: true
// }
```

`hook` remains a compatibility alias for `resolvedHook`.

## Rolled vs applied damage

Stage 2 `damage.total` is the evaluated native DamageRoll total (for example
32), **not** the post-IWR HP loss (for example 22 after resistance 10).

`nelflow.damageApplied` remains the later post-application integration event.

## Timing

- PC: after exact damage-message correlation and before `applyDamageRoll…`
- NPC: after successful `rollStrikeDamage` / DAMAGE_ROLLED link and before apply
- Miss: no Stage 2
- Hit with no Damage click: Stage 1 only
- Application failure after Stage 2 does not retract Stage 2

All three stages share the same `transactionId`.

## Unchanged

Native PC cards, NPC stacks, NelCine `nelflow.strikeResolved` / impact-sync,
Undo, Toolbelt, and NelZones/`damageApplied` semantics.
