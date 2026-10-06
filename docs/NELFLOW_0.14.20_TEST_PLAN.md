# Nelflow 0.14.20 Runtime Test Plan — Spell Attack Presentation

Use Foundry V14, a supported PF2e 8.x build, and Nelflow 0.14.20. Static tests
must be green before live checks.

## A. Ray of Frost / character caster

1. Target one enemy. Cast Ray of Frost. Roll Attack → Critical Hit or Hit.
2. Confirm the attack card stays a full native PF2e spell-attack card (spell
   name visible — not "Unknown Strike", not a slim Show Details strip alone).
3. Press Damage. Confirm the damage card stays native and readable.
4. Confirm auto-apply still runs and the damage host shows Applied + Undo.
5. Confirm the separate PF2e application record is not the primary readable
   surface when the damage card is visible.

## B. Miss / fail-open

6. Spell attack miss → no auto-apply; native cards still readable.
7. Two targets selected → no auto-apply; fail open.

## C. Character Strike regression

8. Melee Strike Unarmed Attack still uses native-augmented cards with Applied
   footer unchanged.

## D. NPC Strike regression

9. NPC Strike still uses compact stacks; no spell-attack labeling.

## E. Diagnostics

```js
game.modules.get("nelflow")?.version // "0.14.20"
game.nelflow.dev.watchSpellAttackFlow()
game.nelflow.dev.getSpellAttackStatus()
```
