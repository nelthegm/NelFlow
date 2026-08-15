# Strike Presentation Contract (protocol 4)

Presentation-neutral Strike feed for optional consumers (for example NelTactics).

```js
game.nelflow.integrations.strikePresentation
// {
//   protocol: 4,
//   attackHook: "nelflow.strikeAttackResolvedPresentation",
//   damageRolledHook: "nelflow.strikeDamageRolledPresentation",
//   damageAppliedHook: "nelflow.strikeDamageAppliedPresentation",
//   resolvedHook: "nelflow.strikeResolvedPresentation",
//   hook: "nelflow.strikeResolvedPresentation",
//   stages: {
//     attack: true,
//     damageRolled: true,
//     damageApplied: true,
//     resolved: true,
//   },
// }
```

## Lifecycle

```text
ATTACK RESOLVED
→ nelflow.strikeAttackResolvedPresentation

DAMAGE ROLLED (pre-application)
→ nelflow.strikeDamageRolledPresentation
  damage.total = native DamageRoll total BEFORE IWR

PF2e applies damage (authoritative)

DAMAGE APPLIED (post-application)
→ nelflow.strikeDamageAppliedPresentation
  damage.applied = actual normal+temp HP loss AFTER PF2e application

RESOLVED
→ nelflow.strikeResolvedPresentation
```

## Amount semantics

| Field | Meaning |
| --- | --- |
| Stage 2 `damage.total` | Rolled DamageRoll total (unchanged from protocol 3) |
| Stage 3 `damage.applied` | Actual resource loss: `max(0, preHp+preTemp − postHp−postTemp)` |
| Stage 3 `damage.rolledTotal` | Optional rolled context (may equal Stage 2 total) |

Do **not** compute presentation damage as rolled ± weakness/resistance.
Observe the existing application result.

## Identity

- Shared `transactionId` across stages
- `damageResultId` = `{transactionId}:damage-applied`

## Privacy

GM-local feed; no all-client broadcast; no hidden-token leakage.

## Exactly once

Dedicated `damageApplied` registry per `transactionId`. Document/chat updates
must not duplicate.

## Non-goals

- Does not suppress native floating text
- Does not change `nelflow.damageApplied`
- Does not emit reverse events on Undo
- Does not expand multi-target Strike presentation
