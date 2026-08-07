# Nelflow 0.11.0 release notes

Nelflow 0.11.0 adds a **presentation-only** bridge that shows real PF2e healing
and condition changes through NelCine **after** mechanics complete.

## What changed

- World settings (defaults **On**):
  - `nelcineEffectCinematics` — master gate
  - `nelcineHealingCinematics` — healing presentations
  - `nelcineConditionCinematics` — condition gain/remove presentations
- Healing cinematics use PF2e `appliedDamage` HP deltas (actual recovered HP,
  not raw roll totals). Overheal shows only what was recovered. Routine zero
  heals are suppressed.
- Condition gain/remove observe embedded condition Item create/update/delete
  after `game.ready`. Valued increases present as `condition-gain` with the new
  value. Routine valued decrements are suppressed. `condition-remove` fires only
  when the condition document is actually deleted.
- Calls `game.nelcine.integrations.nelflow.broadcastEffect(...)` from the
  authoritative primary GM only. NelCine failures never affect mechanics.
- Diagnostics: `game.nelflow.integrations.nelcineEffects.getStatus()` /
  `getRecent()`, plus `game.nelflow.dev.watchEffectCinematics()` and preview
  helpers.

## What did not change

- Strike delivery and impact sync
- Save-batch presentation and impact sync
- Toolbelt Target Helper save behavior / Undo / compact stacks
- No healing or condition delay for NelCine (no impact-sync protocol for effects)

## Companion

Requires NelCine **0.9.x** effect API (`integrations.nelflow.broadcastEffect`).
NelCine is not modified by this release.

## Runtime acceptance

Foundry runtime acceptance is pending; see `docs/NELFLOW_0.11.0_TEST_PLAN.md`.
