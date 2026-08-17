# Spell Attack Automation (0.14.13)

## Scope

NelFlow auto-applies **interactive single-target PF2e spell-attack** damage when
correlation is exact.

Supported example: Ray of Frost — attack hit → press Damage → native
`DamageRoll` → NelFlow applies that exact roll to the **attack-time** target.

## Eligibility

All of the following must hold:

| Requirement | Rule |
|-------------|------|
| Message type | PF2e `attack-roll` |
| Source item | Spell (or spell item with attack workflow) |
| Not a Strike | No `action: "strike"` / Strike flags |
| Not a save spell | Save / Toolbelt basic-save path excluded |
| Targets | Exactly **one** durable target token UUID at attack time |
| Outcome | Authoritative `success` or `criticalSuccess` only |

Zero targets, two or more targets, miss/crit-fail, or missing outcome → **fail open**
(no auto-apply; normal PF2e workflow remains).

## Target capture

Target identity is snapshotted with the **attack** transaction:

- `targetTokenUuid` (required)
- `targetActorUuid`
- `sceneId` when available

`game.user.targets` at **damage** time is never used as application authority.
If the caster retargets before pressing Damage, damage still applies to the
original attack target.

## Transaction

- Kind: `spell-attack`
- Id: `nelflow-spell-attack-<attackMessageId>`
- State progression reuses the shared `TransactionStore` (waiting → correlate →
  claim → applying → applied)

## Damage correlation

When a native spell `DamageRoll` chat message appears, NelFlow selects open
`WAITING_FOR_DAMAGE` spell-attack transactions that match:

- source actor UUID
- source item/spell UUID
- authoring user
- optional source token UUID when both sides have one

**Exactly one** match → correlate and apply.  
**Zero or two+** matches → fail open (`ambiguous` / missing). Timestamps and
“current target” alone never break ties.

## Application

- Reuses `PF2eAdapter.applyDamageRollToRecordedTarget`
- Uses the exact PF2e `DamageRoll` already created (no reroll / formula rebuild)
- `skipIWR: false` — PF2e owns weakness, resistance, immunity, temp HP, etc.
- Pre/post HP + temp HP snapshots → actual applied resource loss
- Emits existing `nelflow.damageApplied` for mechanics consumers (e.g. NelZones)
- Undo reuses guarded restore via `StrikeResolver.undoFromMessage`

## Fail-open policy

Wrong-target damage is worse than requiring manual Apply. Ambiguous overlapping
casts of the same spell do **not** auto-apply.

## Out of scope (this slice)

- Multi-target spell attacks
- Area / basic-save spells (Toolbelt path unchanged)
- Weapon Strikes (existing Strike automation unchanged)
- Persistent / splash / rider damage automation
- NelTactics spell-damage presentation (feed only; see presentation contract)
- NelCine spell cinematics
- DOM Damage-button interception

## Dev

```js
game.nelflow.dev.getSpellAttackStatus()
game.nelflow.dev.watchSpellAttackFlow()
```

Setting: **Spell Attack Auto-Apply** (`spellAttackAutoApply`, default on).
