# Nelflow `damageApplied` integration (0.14.2)

## Hook

`nelflow.damageApplied`

## Protocol

`1`

## Timing

Emitted **after** successful `Actor#applyDamage` on the NelFlow contextual-clone
path, and only when NelFlow uniquely captured the matching PF2e `damage-taken`
ChatMessage for that application.

Undo / health restore never emits this event.

## Correlation

1. NelFlow begins an application with a stable `applicationId` (per-target).
2. `createApplicationCapture` registers match criteria (origin item/actor,
   target token/actor, `context.type === "damage-taken"`, `isHealing === false`).
3. PF2e `applyDamage` runs (IWR included).
4. Exactly one matching `damage-taken` candidate → capture succeeds.
5. Event emits with that same `applicationId` as `transactionId`.

Ambiguous concurrent captures → no event (fail closed for typed consumers).

## Payload (conceptual)

```js
{
  protocol: 1,
  type: "damageApplied",
  transactionId, // per-target application id
  target: { actorUuid, tokenUuid },
  source: {
    kind: "damage-roll",
    damageRollMessageUuid,
    damageRollMessageId,
    immediateDamageTypes, // PRE-IWR unique types from DamageInstance.type
    hasUntypedImmediate,
    persistentDistinctionReliable,
    originActorUuid,
    originItemUuid,
    sourceLevel, // item/cast rank / origin actor level when known; else null
  },
  appliedDamage: { // plain subset of PF2e AppliedDamageFlag
    uuid, isHealing, updates: [{ path, value }], shield
  },
  applicationMessageId,
  isUndo: false
}
```

## Semantics

`immediateDamageTypes` means type **presence** on the originating DamageRoll that
could contribute to this HP application. It does **not** mean post-IWR residual
typed amounts. Those do not exist in PF2e.

## Diagnostics

```js
game.nelflow.integrations.damageApplied
```
