# Nelflow 0.14.13 — Release Notes

## Slice

Single-Target Spell Attack Damage Auto-Apply

## Baseline

- From: **0.14.12** (`d51e608`, 1,366 tests)
- Strike presentation protocol: **4** (unchanged)
- Basic-save presentation protocol: **3** (unchanged)
- Healing presentation protocol: **1** (unchanged)

## What changed

After a successful **interactive single-target** PF2e spell attack (for example
Ray of Frost), when the user presses the spell’s Damage / Critical Damage
control, NelFlow:

1. Correlates the exact native `DamageRoll` to the attack transaction
2. Auto-applies that roll to the **attack-time** target token
3. Lets PF2e perform IWR
4. Snapshots HP + temp HP and derives actual applied resource loss
5. Emits existing `nelflow.damageApplied`
6. Emits presentation-neutral spell-attack damage stages (protocol 1)

No second manual Apply Damage click is required when correlation is exact.

## Safety

- Exactly one target at attack time; otherwise fail open
- Success / critical success only; misses do not auto-apply ordinary damage
- Ambiguous overlapping casts of the same spell fail open
- Never uses current user targets at damage time as application authority
- No DOM Damage-button interception; no local IWR math; no DamageRoll rebuild

## Presentation

```js
game.nelflow.integrations.spellAttackPresentation
// protocol: 1
// damageRolledHook: "nelflow.spellAttackDamageRolledPresentation"
// damageAppliedHook: "nelflow.spellAttackDamageAppliedPresentation"
// stages: { damageRolled: true, damageApplied: true }
```

NelTactics is **not** modified in this release. Spell attack rolls continue to
render via generic-check; dedicated spell-damage token presentation is a later
NelTactics slice.

## Dev

```js
game.nelflow.dev.getSpellAttackStatus()
game.nelflow.dev.watchSpellAttackFlow()
```

## Preserved

- Strike protocol 4 + player Strike auto-apply
- Basic-save / Toolbelt path
- Healing feed protocol 1
- `nelflow.damageApplied` public contract
- Undo via existing guarded restore

## Docs

- [SPELL_ATTACK_AUTOMATION.md](./SPELL_ATTACK_AUTOMATION.md)
- [SPELL_ATTACK_PRESENTATION_CONTRACT.md](./SPELL_ATTACK_PRESENTATION_CONTRACT.md)
- [NELFLOW_0.14.13_TEST_PLAN.md](./NELFLOW_0.14.13_TEST_PLAN.md)
