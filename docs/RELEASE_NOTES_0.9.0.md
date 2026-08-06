# Nelflow 0.9.0 — NelCine Basic-Save Batch Bridge

## Summary

Optional world setting `nelcineSaveBatchCinematics` (default **false**) causes
NelFlow to emit one `nelflow.basicSaveBatchResolved` presentation payload after
a multi-target NPC basic-save spell or ability finishes resolving.

Companion setting `nelcineSaveBatchMinimumTargets` (default **2**, range 2–24)
controls the minimum authoritative target count required to emit.

## Ownership

- **NelFlow** owns saves, shared damage, scaling, IWR, HP, Undo, and transaction
  IDs.
- **NelCine** owns presentation, privacy redaction, and network delivery only.
- No number returned by NelCine is used mechanically.
- **HP applies before the cinematic** in this release.
- **No batch impact-commit protocol** exists yet.

## Emission timing

After Toolbelt `phase === "complete"` (or legacy complete/partial), once
per-target applications and Undo metadata exist:

```text
Hooks.callAll("nelflow.basicSaveBatchResolved", payload)
```

## Identifiers

- Batch ID: existing `integrationId` / `resolverId`
- Result ID: existing per-target `applicationId`
- Truncation: first 24 targets when more than 24 resolve

## Safety

- Setting off / NelCine absent / inactive / non-GM / below minimum → no emit
- Exactly-once emission registry (memory-bounded)
- Hook failures do not retry and do not affect mechanics
- Aggregation is memory-only; GM reload mid-resolution may skip the cinematic

## Scope

Supported NPC basic-save Toolbelt spells/abilities and the experimental legacy
resolver. Strike impact sync (`nelcineImpactSync`) is unchanged.
