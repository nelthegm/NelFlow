# Nelflow 0.14.0 release notes

Nelflow 0.14.0 bridges **NPC combat defeat** to NelCine Defeated battlefield
markers after mechanics complete (presentation only).

## Authoritative boundary

Primary event: Foundry `updateCombatant` when `changed.defeated === true`
(Combatant `defeated` false → true). This matches PF2e `applyDamage` →
`toggleDefeated` and manual combat-tracker toggles.

HP reaching zero alone is **not** treated as the presentation boundary.

## Eligibility

- Genuine PF2e NPC actors only (`isOfType("npc")` / `type === "npc"`)
- Represented by a Combatant in the **active** combat
- Authoritative / elected processing GM only

Suppressed: PCs, hazards, vehicles, loot, party, army, out-of-combat Actor HP
edits, undefeated transitions (`true → false`).

## Cause correlation

Exact NelFlow lethal-application notes recorded when post-application HP is 0:

1. Strike transaction ID → `cause.type = "strike"`
2. Save-batch / Toolbelt basic-save identity → `cause.type = "save"`
3. Other NelFlow damage paths → `cause.type = "damage"` when exact
4. Otherwise `cause: null` (including manual defeat)

No timestamp-only guessing. Multi-target batches emit one Defeated event per
defeated NPC; NelCine owns concurrent marker display.

## Companion

Requires NelCine **0.10.2+** (`broadcastDefeated`). Presentation failure never
changes HP, Combatant.defeated, or combat state.

## Setting

- `nelcineDefeatedCinematics` — Show NPC Defeated Cinematics (default On)

## Runtime acceptance

Pending; see `docs/NELFLOW_0.14.0_TEST_PLAN.md`.
