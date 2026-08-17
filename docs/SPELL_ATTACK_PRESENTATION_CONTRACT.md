# Spell Attack Presentation Contract

## Protocol

`game.nelflow.integrations.spellAttackPresentation`

| Field | Value |
|-------|--------|
| protocol | **1** |
| damageRolledHook | `nelflow.spellAttackDamageRolledPresentation` |
| damageAppliedHook | `nelflow.spellAttackDamageAppliedPresentation` |
| stages.damageRolled | `true` |
| stages.damageApplied | `true` |

No attack-roll presentation in this feed. Attack display remains with generic-check
consumers (e.g. NelTactics 0.6.0). This feed covers **damage lifecycle only**.

## Stage 1 — damageRolled

**When:** after exact DamageRoll correlation/claim, **before** PF2e apply.

**Identity:**

- `transactionId` — `nelflow-spell-attack-<attackMessageId>`
- `damageResultId` — `<transactionId>:damage-rolled`

**Semantics:**

```js
damage.total // native DamageRoll total BEFORE IWR
```

Payload is plain JSON (no Documents / Roll objects). Prefer GM-local emission;
do not broadcast hidden target details.

## Stage 2 — damageApplied

**When:** after authoritative PF2e application and post HP/temp snapshots.

**Identity:**

- same `transactionId`
- `damageResultId` — `<transactionId>:damage-applied`

**Semantics:**

```js
damage.applied // actual normal HP + temp HP resource loss
damage.rolledTotal? // optional pre-IWR context
```

Examples:

| Case | rolled | applied |
|------|--------|---------|
| Weakness +10 | 20 | 30 |
| Resistance −10 | 30 | 20 |
| Overkill (5 HP left) | 30 | 5 |
| Temp 10 + HP 15 | 25 | 25 |
| Immunity | 20 | 0 |

## Exactly once

Dedicated registries for rolled and applied stages. ChatMessage re-renders must
not duplicate either hook.

## Privacy

Follow existing NelFlow presentation privacy: GM-local hooks; no guessed source
metadata.

## Non-goals

- NelCine-specific cinematic payloads
- NelTactics rendering changes in the 0.14.13 NelFlow release
- Attack-stage presentation
