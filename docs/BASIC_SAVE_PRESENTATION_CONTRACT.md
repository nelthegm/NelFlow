# Basic Save Presentation Contract (protocol 1)

Presentation-neutral per-target basic-save result feed for optional consumers
such as NelTactics.

## Ownership

- **Toolbelt** owns save execution: target selection, rolling saves, durable
  result storage under Target Helper flags, and Toolbelt’s own hooks/UI.
- **NelFlow** observes authoritative Toolbelt results after they are written.
- This feed **does not** request, delay, or roll a save.
- This feed **does not** mutate Toolbelt flags or call Toolbelt private APIs.

## Hook

```text
nelflow.basicSaveTargetResolvedPresentation
```

Meaning: one exact target’s authoritative basic saving throw result has become
available for presentation.

This is **not** batch complete, damage applied, save requested, or NelCine.

## Integration API

```js
game.nelflow.integrations.basicSavePresentation
```

```js
{
  protocol: 1,
  targetResolvedHook: "nelflow.basicSaveTargetResolvedPresentation",
  available: true,
  stages: { targetResolved: true },
  getStatus()
}
```

`nelflow.basicSaveBatchResolved` is **not** advertised here. That hook is
NelCine-gated and post-HP; it is not a presentation-neutral batch contract.

## Timing

For each target:

1. Toolbelt writes authoritative save instance
2. NelFlow projection reaches `READY`
3. Emit `nelflow.basicSaveTargetResolvedPresentation` immediately
4. Existing NelFlow HP / NelCine / mode processing continues unchanged

Multi-target example (Fireball A/B/C/D resolving A, C, B, D):

```text
TARGET RESOLVED A
TARGET RESOLVED C
TARGET RESOLVED B
TARGET RESOLVED D
```

## Payload (schemaVersion 1)

Plain JSON only. Optional roll fields are omitted when Toolbelt does not expose
them — never fabricated.

```js
{
  schemaVersion: 1,
  stage: "targetResolved",
  batchId,            // Toolbelt integration id
  targetResultId,     // applicationId + saveFingerprint
  sceneId?,
  sourceActorUuid?,
  sourceTokenUuid?,   // omitted when unsafe
  targetTokenUuid,    // required
  targetActorUuid?,
  actionName?,
  itemUuid?,
  save: {
    type: "reflex" | "fortitude" | "will",
    dc?,              // only if Toolbelt variant dc is finite
    basic: true
  },
  roll: {
    degreeOfSuccess,  // criticalSuccess|success|failure|criticalFailure
    dieResult?,       // Toolbelt `die` 1–20
    modifier?,        // sum of non-excluded Toolbelt `modifiers[].modifier`
    total?            // Toolbelt `value`
  },
  rerolled?,          // Toolbelt reroll type when present
  createdAt
}
```

### Authoritative Toolbelt sources (3.52.0–3.53.1)

| Payload field | Toolbelt source |
| --- | --- |
| target token | `targetHelper.targets[]` UUID → token |
| save type | `saveVariants.*.statistic` |
| DC | `saveVariants.*.dc` |
| degree | `saves[tokenId].success` |
| total | `saves[tokenId].value` |
| natural d20 | `saves[tokenId].die` |
| modifier | sum of non-excluded `saves[tokenId].modifiers[]` |
| private | `saves[tokenId].private` |

Hard rule: never compute `die = total − modifier`, never recompute degree from
total/DC, never recompute caster DC from actor statistics.

## Exactly once

`targetResultId = applicationId + ":fp:" + saveFingerprint`

Fingerprint includes Toolbelt `success`, `rerolled`, and `roll` JSON string.
Ordinary message updates with the same fingerprint do not re-emit.

Hero Point / Toolbelt reroll that replaces the durable instance changes the
fingerprint → new `targetResultId` → a second presentation event is allowed.

Registry (`emittedByTargetResultId`) is independent of HP application, Undo,
NelCine, and Strike registries.

## Privacy

- Emit path is GM-local (`Hooks.callAll` on the processing GM client).
- Toolbelt `private: true` saves **do not emit**.
- Missing/unsafe target token UUID → no battlefield presentation event.
- NelFlow does not broadcast private roll details to players.

## Unchanged

Toolbelt rolls, degree multipliers, HP application timing (`all-resolved` /
`per-target`), Undo, NelCine single/batch/impact sync, Strike presentation
protocol 3, `nelflow.damageApplied`, NelZones.
