# Basic Save Presentation Contract (protocol 3)

Presentation-neutral, GM-local per-target basic-save data for optional consumers
such as NelTactics. Protocol 3 preserves protocol-1 and protocol-2 semantics and
adds a pre-application ownership reservation stage.

## Ownership and compatibility

- **Toolbelt** owns save execution and durable target-result data.
- **PF2e** owns contextual damage application, save-adjusted DamageRoll handling,
  IWR, and actor resource mutation.
- **NelFlow** observes Toolbelt's final degree and the exact PF2e application's
  durable before/after HP snapshots.
- The feed does not roll saves or damage, mutate Toolbelt, recreate IWR, apply
  HP, broadcast to players, create UI, or suppress native floating text.
- Consumers checking `protocol >= 1` or `protocol >= 2` remain compatible when
  the advertised protocol is 3.

## Integration API

```js
game.nelflow.integrations.basicSavePresentation
```

```js
{
  protocol: 3,
  targetResolvedHook: "nelflow.basicSaveTargetResolvedPresentation",
  targetDamageApplyingHook: "nelflow.basicSaveTargetDamageApplyingPresentation",
  targetDamageAppliedHook: "nelflow.basicSaveTargetDamageAppliedPresentation",
  available: true,
  stages: {
    targetResolved: true,
    targetDamageApplying: true,
    targetDamageApplied: true
  },
  getStatus()
}
```

`nelflow.basicSaveBatchResolved` remains a separate NelCine-gated contract and
is not advertised here.

## Stage 1 — targetResolved

Hook:

```text
nelflow.basicSaveTargetResolvedPresentation
```

Meaning: one exact target's authoritative Toolbelt basic-save result is READY.
It emits before HP application, NelCine timing, or batch completion.

## Stage 2 — targetDamageApplying

Hook:

```text
nelflow.basicSaveTargetDamageApplyingPresentation
```

Meaning: presentation ownership reservation. NelFlow has passed final
pre-application validation for this exact target and is immediately about to
invoke its existing PF2e `applyDamage({ skipIWR: false })` path.

This is **not** a damage amount, damage roll, or request for a consumer to apply
damage.

Payload (`schemaVersion: 1`):

```js
{
  schemaVersion: 1,
  stage: "targetDamageApplying",
  batchId,
  targetResultId,
  damageResultId,
  sceneId?,
  sourceTokenUuid?,
  sourceActorUuid?,
  targetTokenUuid,
  targetActorUuid?,
  actionName?,
  itemUuid?,
  save: {
    type,
    basic: true,
    degreeOfSuccess
  },
  createdAt
}
```

There is intentionally **no** `damage.applied` field.

Emission point:

1. Toolbelt target application validation succeeds
2. Adapter validation for the exact PF2e apply path succeeds
3. Emit `targetDamageApplyingPresentation`
4. Immediately call PF2e `applyDamage`

Do **not** emit when a target is merely READY. Ineligible / stale / wrong-GM /
failed-validation targets never receive a false reservation.

Critical-success / conclusive no-damage paths that never call `applyDamage`
also do **not** emit applying.

## Stage 3 — targetDamageApplied

Hook:

```text
nelflow.basicSaveTargetDamageAppliedPresentation
```

Meaning: authoritative actual target damage after PF2e application/IWR/temp-HP.

`damage.applied` is observed from durable before/after normal+temp HP snapshots:

```text
applied = max(0,
  preApplicationHp + preApplicationTempHp
  - postApplicationHp - postApplicationTempHp)
```

## Identity correlation

Applying and applied share:

```text
batchId
targetResultId = applicationId + ":fp:" + saveFingerprint
damageResultId = targetResultId + ":damage:" + applicationId
targetTokenUuid
```

## Exactly once

- One applying event per real PF2e application (dedicated applying registry)
- One applied event per authoritative damage result (dedicated applied registry)
- Retries / message updates must not duplicate either stage

## Failure after reservation

If `applyDamage` throws or fails after the applying reservation:

- do **not** emit `targetDamageAppliedPresentation`
- the reservation may already have been emitted

Consumers should treat ownership as time-bounded. This release does not invent a
rollback protocol.

## Zero damage

| Case | Applying | Applied |
| --- | --- | --- |
| Real PF2e application reduced to 0 by IWR | yes | `applied: 0` |
| Critical-success / conclusive no-damage (no `applyDamage`) | no | `applied: 0` |

## NelCine impact sync

For delayed save-batch impact commits:

```text
save resolves
→ NelCine delay (no applying)
→ impact reached
→ applyOne → targetDamageApplying
→ applyDamage
→ targetDamageApplied
```

## Lifecycle for a normal real application

```text
targetResolvedPresentation
→ ... eligibility / modes / optional NelCine delay ...
→ targetDamageApplyingPresentation
→ PF2e applyDamage
→ nelflow.damageApplied (unchanged mechanics event)
→ targetDamageAppliedPresentation
```

## Privacy

GM-local Hooks.callAll. Private Toolbelt saves and unsafe/hidden target token
identities do not emit presentation stages.

## Unchanged

Toolbelt save ownership, degree multipliers, HP timing, Undo, NelCine, Strike
presentation protocol 3, `nelflow.damageApplied`, NelZones, native floating text.
