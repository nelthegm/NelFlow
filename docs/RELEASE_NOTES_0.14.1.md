# Nelflow 0.14.1 release notes

Nelflow 0.14.1 is a presentation/readability repair: Strike riders stay visible
after chat compaction, and supported action/immunity results are easier to read.

## Strike riders

Authoritative source: `flags.pf2e.context.notes` on linked attack/damage
ChatMessages (`RollNotePF2e.toObject`).

Critical specialization appears only when PF2e already emitted a note titled
`PF2E.Actor.Creature.CriticalSpecialization` (typically on strike-damage).
NelFlow does **not** recreate weapon-group specialization tables.

Deadly/Fatal/Sneak Attack damage components are not shown as riders — they
remain in the DamageRoll summary.

Riders auto-expand on critical hits. Actionable follow-ups keep **Open Details**
so native PF2e/Workbench controls remain reachable even under stack-first
collapse.

## Action / immunity

Compact supported action checks as:

`DEMORALIZE → Cyclops Zombie` / `IMMUNE — MENTAL`

Target names resolve from structured token/actor UUIDs with PF2e name-visibility
privacy. The awkward `Unknown (Cyclops Zombie)` pattern comes from Workbench /
Asymonous Benefactor macros (`Unknown <span data-visibility="gm">(name)</span>`),
not NelFlow.

**Click to apply effects and immunity** is a Workbench compendium macro link
that applies Frightened and/or Demoralize Immunity CD. NelFlow never auto-clicks
it; Details always preserves access.

## Runtime acceptance

Pending; see `docs/NELFLOW_0.14.1_TEST_PLAN.md`.
