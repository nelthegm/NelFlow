# Nelflow 0.9.2 release notes

Nelflow 0.9.2 fixes PC Strike chat continuation while preserving the 0.9.x
NelCine integration architecture. The development manifest targets the eventual
`v0.9.2-rc1` package; no release or tag is created by this implementation.

## Regression

After a successful character Strike, Nelflow could collapse the native PF2e
attack card while the canonical projection showed only **Waiting for damage**
and **Results**. The native Damage / Critical Damage controls were hidden with
that card, forcing players back to the actor sheet.

This is the accepted behavioral fix from `hotfix/0.7.1-pc-strike-actionable`
(`f56b7bd`), ported onto current main so 0.8.x / 0.9.x NelCine bridges remain
intact. **0.7.1 is not published.**

## Fix

- Canonical waiting presentation shows the strike result (name, target when
  authorized, outcome, and authorized roll total) without requiring Results.
- Hits expose a chat **Damage** or **Critical Damage** action that delegates to
  the exact native PF2e `strike-damage` control for that attack message.
- Native attack cards are suppressed only when that actionable replacement and
  the native continuation both exist. Otherwise the native card stays visible.
- Misses and critical failures show the attack result without a damage action.
- NPC autoroll, multi-target shared rolls, damage application, IWR, Undo,
  privacy, correlation guards, and NelCine delivery/impact/save-batch bridges
  are unchanged.

## Testing status

Focused automated coverage for actionable PC Strike presentation and NelCine
preservation is included. Foundry/Forge runtime acceptance remains pending; see
`docs/NELFLOW_0.9.2_TEST_PLAN.md`.
