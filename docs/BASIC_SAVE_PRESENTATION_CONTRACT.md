# Basic Save Presentation Contract (protocol 2)

Presentation-neutral, GM-local per-target basic-save data for optional consumers
such as NelTactics. Protocol 2 preserves the complete protocol-1 save-result
contract and adds a separate target-damage stage.

## Ownership and compatibility

- **Toolbelt** owns save execution and durable target-result data.
- **PF2e** owns contextual damage application, save-adjusted DamageRoll handling,
  IWR, and actor resource mutation.
- **NelFlow** observes Toolbelt's final degree and the exact PF2e application's
  durable before/after HP snapshots.
- The feed does not roll saves or damage, mutate Toolbelt, recreate IWR, apply
  HP, broadcast to players, or create UI.
- A protocol-1 consumer that checks `protocol >= 1` and reads
  `targetResolvedHook` remains compatible when the advertised protocol is 2.

## Integration API

```js
game.nelflow.integrations.basicSavePresentation
```

```js
{
  protocol: 2,
  targetResolvedHook: "nelflow.basicSaveTargetResolvedPresentation",
  targetDamageAppliedHook: "nelflow.basicSaveTargetDamageAppliedPresentation",
  available: true,
  stages: {
    targetResolved: true,
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

Payload (`schemaVersion: 1`):

```js
{
  schemaVersion: 1,
  stage: "targetResolved",
  batchId,
  targetResultId,     // applicationId + saveFingerprint
  sceneId?,
  sourceActorUuid?,
  sourceTokenUuid?,
  targetTokenUuid,
  targetActorUuid?,
  actionName?,
  itemUuid?,
  save: { type, dc?, basic: true },
  roll: {
    degreeOfSuccess,
    dieResult?,
    modifier?,
    total?
  },
  rerolled?,
  createdAt
}
```

Toolbelt sources remain `saveVariants.*` and `saves[tokenId]`. NelFlow never
reconstructs natural dice, modifiers, DCs, or degree.

## Stage 2 — targetDamageApplied

Hook:

```text
nelflow.basicSaveTargetDamageAppliedPresentation
```

Meaning: one exact target's supported Toolbelt basic-save damage resolution has
reached its real application point and authoritative target damage is known.

Payload (`schemaVersion: 1`):

```js
{
  schemaVersion: 1,
  stage: "targetDamageApplied",
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
    type: "reflex" | "fortitude" | "will",
    basic: true,
    degreeOfSuccess
  },
  damage: {
    applied,              // positive magnitude of actual target resource loss
    baseRollTotal?,       // shared native roll, context only
    degreeAdjustedAmount? // existing transformed roll total, when available
  },
  createdAt
}
```

### Applied-damage semantics

`damage.applied` is intentionally different from Strike Stage 2:

- Strike `damageRolled` reports the authoritative rolled DamageRoll total before
  target IWR.
- Basic-save `targetDamageApplied` reports actual damage taken by that target
  after the authoritative save degree, multiplier, PF2e IWR, and application.

NelFlow's existing Toolbelt transaction already stores:

```text
preApplicationHp
preApplicationTempHp
postApplicationHp
postApplicationTempHp
```

The audited source is `transaction-before-after`:

```text
applied = max(0,
  preApplicationHp + preApplicationTempHp
  - postApplicationHp - postApplicationTempHp)
```

This observes PF2e's completed application. It is not an IWR calculation.
Temporary-HP-only damage is therefore represented correctly.

`baseRollTotal` and `degreeAdjustedAmount` are optional context. Neither is used
as a substitute for `damage.applied`.

## Current application lifecycle audit

### Toolbelt all-resolved

1. Toolbelt results are normalized.
2. Every primary save must be resolved before keys become eligible.
3. Stage 1 emits independently as each target becomes READY.
4. `process()` applies eligible target keys in existing order through `applyOne()`.
5. `PF2eAdapter.applyDamageRollToRecordedTarget()` calls contextual
   `applyDamage({ skipIWR: false })` once.
6. The adapter uniquely captures PF2e's `damage-taken` message and emits the
   unchanged `nelflow.damageApplied` contract.
7. `applyOne()` reads and persists exact normal/temp HP snapshots.
8. Stage 2 emits immediately afterward for that target.
9. Undo proof and optional NelCine batch completion continue unchanged.

### Toolbelt per-target

The same path runs as each target becomes READY; Stage 2 follows each exact
application independently. No batching or order is changed.

### Toolbelt GM-confirm

No automatic key is released until the existing GM confirmation. Confirmed
targets then use the same `applyOne()` path and Stage 2 timing.

### NelCine impact synchronization

Eligible targets enter `awaiting-impact`. A NelCine impact or existing emergency
timeout restores that exact target to READY and invokes the unchanged `applyOne()`
commit handler. Stage 2 therefore occurs after delayed HP mutation, never before.

### Critical success and zero

The existing exact `multiplier === 0` branch persists `no-damage` without calling
PF2e damage application. That conclusive supported transition emits
`damage.applied: 0`. A normal PF2e application that leaves normal and temp HP
unchanged also emits zero. External, manual, failed, persistent-only, or unrelated
targets do not receive fabricated zero events.

### Legacy resolver

The legacy resolver also stores exact normal/temp before/after snapshots, but it
is not a protocol-1 Toolbelt target-result producer and lacks that feed's private
save linkage. Protocol 2 intentionally does not add a legacy Stage 2 producer;
its rolling, application, Undo, and NelCine behavior remain unchanged.

## Identity and exactly once

```text
targetResultId = applicationId + ":fp:" + saveFingerprint
damageResultId = targetResultId + ":damage:" + applicationId
```

The fingerprint changes for a final Toolbelt reroll, so only the final applied
save instance publishes its own damage result. A dedicated
`damagePresentationEmittedByDamageResultId` registry is independent from Stage 1,
HP state, Undo, NelCine, Strike registries, and `nelflow.damageApplied`.

Reloaded terminal transactions are not mechanically reprocessed, so they cannot
republish Stage 2. Undo does not use the application path and emits no reverse
damage event in 0.14.9.

## Privacy and diagnostics

- Both stages use GM-local `Hooks.callAll` only.
- Toolbelt `private: true` results emit neither stage.
- Exact `targetTokenUuid` is required.
- NelFlow does not redistribute data to player clients.
- `game.nelflow.dev.watchBasicSaveDamagePresentationFeed()` prints safe local
  diagnostics with unavailable optional fields explicitly identified.
- `game.nelflow.dev.getBasicSavePresentationStatus()` reports protocol 2,
  both hooks, `damageProducerAvailable`, `appliedDamageSource`, and `tempHpAware`.

## Unchanged contracts

Toolbelt ownership, save multipliers, PF2e IWR, HP timing, Undo, native floating
text, NelCine single/batch/impact sync, Strike protocol 3, `nelflow.damageApplied`,
NelZones, and NelTactics 0.3.2 behavior are unchanged.
