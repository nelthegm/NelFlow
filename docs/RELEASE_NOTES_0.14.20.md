# NelFlow 0.14.20

## Spell Attack Native Presentation

Spell attacks such as Ray of Frost now keep PF2e's native attack and damage
cards readable — the same surface as character Strikes — instead of collapsing
into Strike-shaped compact summaries labeled **Unknown Strike**.

### What changed

- `spell-attack` transactions select **native-augmented** presentation
- Compact summary text prefers `snapshot.actionName` when `strikeName` is absent
- Applied / Undo status augments only the exact native damage host (application
  record remains a privacy-safe fallback)
- Attack-time `targetName` is optional snapshot metadata for presentation

### Unchanged

- Spell-attack auto-apply mechanics and fail-open policy
- `spellAttackPresentation` protocol **1** (`damageRolled` / `damageApplied`)
- Strike stacks, Shield Block, Toolbelt, Undo HP restore, NelCine / NelZones

### Verify

```js
game.modules.get("nelflow")?.version // "0.14.20"
game.nelflow.dev.watchSpellAttackFlow()
```

See [NELFLOW_0.14.20_TEST_PLAN.md](./NELFLOW_0.14.20_TEST_PLAN.md) and
[SPELL_ATTACK_AUTOMATION.md](./SPELL_ATTACK_AUTOMATION.md).
