# Nelflow 0.7.0 release notes

Nelflow 0.7.0 adds attacker-scoped NPC compact stacks and shared-roll
multi-target Strikes. The development manifest targets the eventual
`v0.7.0-rc1` package; no release or tag is created by this implementation.

## Attacker stacks

- NPC stacks follow the explicit attacking token during any active-combat turn window.
- Reactions, readied/triggered Strikes and manual out-of-turn attacks receive the attacker's own stack.
- Multiple tokens for one actor remain separate.
- Out-of-turn rows use a neutral **Out of Turn** label unless PF2e explicitly identifies a Reaction.

## Shared-roll multi-target Strikes

- Two or more explicitly targeted tokens activate one parent batch for supported NPC and character Strikes.
- One native attack total is compared independently with each prepared AC.
- Natural 20/1 and supported predicate degree adjustments apply per target; MAP applies once.
- Normal hits share one native normal damage roll; critical hits share one native critical roll.
- PF2e applies each group result separately per target with full contextual IWR and native application records.
- Concealed/hidden targets receive independent flat checks; unsafe children become Review without cancelling siblings.
- Per-target Undo and Undo All use the established exact HP/temp-HP guard.

## Presentation and safety

- An NPC batch occupies one parent stack row with compact child target lines.
- A character batch adds one summary to one deterministic viewer-visible native host.
- Native Records remains exact-ID and visibility gated.
- Transaction internals remain absent from ordinary chat.
- Previous-session uncertain work is never automatically rerolled or reapplied.

## Configuration

**Shared-Roll Multi-Target Strikes** is a world setting with **Off**, **NPC
Strikes Only**, and **Player and NPC Strikes**. The default is **Player and NPC
Strikes**. Zero- and one-target Strikes retain established behavior in every
mode.

## Testing status

The repository includes 100 focused 0.7.0 automated/static scenarios in
addition to the complete existing suite. Foundry/Forge runtime acceptance is
pending; see `docs/NELFLOW_0.7.0_TEST_PLAN.md`.
