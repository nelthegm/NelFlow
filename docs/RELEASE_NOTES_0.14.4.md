# Nelflow 0.14.4 — Presentation-neutral Strike feed

Nelflow 0.14.4 adds a presentation-neutral resolved Strike integration feed for
battlefield presentation consumers such as NelTactics. Ordinary single-target
character Strike presentation from 0.14.3 remains fully native.

## Integration feed

Hook:

```text
nelflow.strikeResolvedPresentation
```

Public capability:

```js
game.nelflow.integrations.strikePresentation.getStatus()
// { protocol: 1, hook: "nelflow.strikeResolvedPresentation", available: true, ... }
```

This event means a NelFlow-owned Strike transaction has authoritatively resolved
and may be consumed by presentation modules. It does **not** mean “play NelCine.”

`available` is a NelFlow capability flag and does **not** depend on NelTactics
being installed. When no consumer listens, nothing else happens.

## Distinction from NelCine delivery

| Hook | Role |
| --- | --- |
| `nelflow.strikeResolved` | Legacy/current NelCine-specific presentation delivery |
| `nelflow.strikeResolvedPresentation` | Neutral consumer feed (e.g. NelTactics) |

NelCine continues to use `nelflow.strikeResolved` and the impact-sync path only.
The neutral feed is emitted alongside those paths and does not migrate NelCine.

## Scope preserved from 0.14.3

- Ordinary PC Strike attack and damage cards stay fully native
- NelFlow still correlates/applies silently and adds only the Applied/HP/Undo footer
- NPC compact stacks unchanged
- `nelflow.damageApplied` (0.14.2) semantics unchanged
- No extra damage rolls, HP applications, chat compaction, or card suppression
  from the neutral feed

## Diagnostics

```js
game.nelflow.dev.watchStrikePresentationFeed()
game.nelflow.dev.stopWatchingStrikePresentationFeed()
```

## Known limitations

- Multi-target shared-roll Strikes are not emitted on this feed
- Character Miss / criticalFailure emit only when the authoritative player-Strike
  workflow has enough structured resolution data (today: after correlated damage
  application for hits that reach that path). NPC Miss / criticalFailure emit on
  the existing NPC skip path
- `sceneId` is included only when the canonical Strike presentation payload already
  supplies it; the flat builder does not invent it
- Natural `attack.dieResult` is never reverse-calculated from total − modifier
