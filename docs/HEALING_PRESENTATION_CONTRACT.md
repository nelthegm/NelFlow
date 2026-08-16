# Healing Presentation Contract

## Protocol

`game.nelflow.integrations.healingPresentation`

| Field | Value |
|-------|--------|
| protocol | **1** |
| appliedHook | `nelflow.healingAppliedPresentation` |
| applyingHook | **not advertised** |
| stages.applying | `false` |
| stages.applied | `true` |

## Why applied-only

Native PF2e chat healing (Heal, Treat Wounds, Battle Medicine, consumables,
focus healing, etc.) runs inside `Actor#applyDamage`. NelFlow does not wrap that
path. Advertising a pre-application ownership stage would be dishonest without a
private PF2e patch.

## Authoritative source

PF2e `damage-taken` ChatMessage with:

```js
flags.pf2e.context.type === "damage-taken"
flags.pf2e.appliedDamage.isHealing === true
```

Actual restoration:

```js
healing.applied = sum of max(0, -update.value)
  for updates where path ends with attributes.hp.value
```

This is the same delta PF2e stores for Undo (`pre − post`). Overheal is already
reflected: only HP that actually increased is present.

## Supported workflows

Any healing that PF2e applies through `Actor#applyDamage` and records as a
healing `damage-taken` message, including typical:

- Heal spell chat apply
- Treat Wounds / Battle Medicine
- Healing consumables
- Lay on Hands / focus healing when applied that way
- Other chat-card healing buttons using the same path

## Unsupported / excluded

- GM manual HP edits
- Undo / `damageUndo`
- Rest / import / macros that edit HP directly
- Arbitrary `updateActor` HP increases
- Temp-HP grants counted as `healing.applied`
- Toolbelt healing (Toolbelt healing remains unsupported by NelFlow adapters)
- Guessed targets when multiple tokens share an actor

## Payloads

### Applied

```js
{
  schemaVersion: 1,
  stage: "healingApplied",
  healingResultId, // healing:<messageId>:<targetTokenUuid>
  targetTokenUuid,
  targetActorUuid?,
  sourceActorUuid?,
  sourceTokenUuid?,
  actionName?,
  itemUuid?,
  sceneId?,
  messageId?,
  healing: {
    applied: 17,        // required — actual normal HP restored
    rolledTotal?: 42    // optional diagnostics only
  },
  createdAt
}
```

### Applying

Not emitted in protocol 1.

## Zero applied

When PF2e records a healing `appliedDamage` whose normal HP delta totals `0`,
the feed may emit `healing.applied = 0`. When PF2e omits `appliedDamage` for a
no-op full-HP apply (`canUndoDamage` false), NelFlow does **not** fabricate an
event.

## Privacy

GM-local `Hooks.callAll` only. No socket broadcast from NelFlow.

## Exactly once

Dedicated registry keyed by `healingResultId`. Duplicate message handling does
not re-emit.

## Non-goals

- Does not change PF2e healing mechanics
- Does not suppress native healing floats (NelTactics may later)
- Does not modify `nelflow.damageApplied` (still rejects `isHealing`)
- Does not modify Strike protocol 4 or basic-save protocol 3
