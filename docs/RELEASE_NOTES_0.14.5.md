# Nelflow 0.14.5 — Two-stage presentation-neutral Strike feed

Nelflow 0.14.5 adds an immediate attack-check presentation feed so battlefield
consumers (for example NelTactics) can show the d20/math/outcome as soon as the
authoritative PF2e attack resolves — without waiting for a player to click
Damage.

## Stage 1 — attack

Hook:

```text
nelflow.strikeAttackResolvedPresentation
```

Emitted when the authoritative Strike attack check has resolved (all four
degrees). Contains natural die, modifier, total, degree, attacker/target, and
action identity. Does **not** wait for damage and does not invent damage.

## Stage 2 — resolved / damage

Hook (unchanged from 0.14.4):

```text
nelflow.strikeResolvedPresentation
```

Emitted for the existing final presentation path (NPC damage/final, PC damage
application correlation, NPC miss skip path).

## Integration API (protocol 2)

```js
game.nelflow.integrations.strikePresentation.getStatus()
// {
//   protocol: 2,
//   attackHook: "nelflow.strikeAttackResolvedPresentation",
//   resolvedHook: "nelflow.strikeResolvedPresentation",
//   hook: "nelflow.strikeResolvedPresentation",
//   available: true,
//   stages: { attack: true, damage: true }
// }
```

## Transaction identity

Both stages use `TransactionStore.deterministicId(attackMessage)` =
`nelflow-${attackMessage.id}`.

Valid sequence for two Strikes before either damage click:

```text
ATTACK A
ATTACK B
RESOLVED A
RESOLVED B
```

## Sources

| Path | Stage 1 emission |
| --- | --- |
| PC | `PlayerStrikeService.observeAttack` after structured attack normalize |
| NPC | `strike-resolver` immediately after transaction claim, before damage roll |

## Preserved

- Native PC attack + damage cards
- `nelflow.strikeResolved` / NelCine impact-sync
- `nelflow.damageApplied`
- NPC compact stacks
- Undo / targeting / saves / healing / effects / defeated / NelZones

## Diagnostics

```js
game.nelflow.dev.watchStrikePresentationFeed()
```

Logs `STRIKE ATTACK` and `STRIKE RESOLVED` clearly.

## Known limitations

- Multi-target shared-roll Strikes remain unsupported on this feed
- Natural `attack.dieResult` is never reverse-calculated from total − modifier
- Stage 2 for NPC misses remains for compatibility; PC misses emit Stage 1 only
