# Nelflow

Nelflow is an experimental Foundry VTT module for PF2e combat-resolution
workflows. Slice 1 automates a GM-authored NPC Strike against exactly one
target:

- failure or critical failure stops without a damage roll;
- success invokes the Strike's native normal-damage function;
- critical success invokes the Strike's native critical-damage function;
- optional auto-application follows PF2e's native contextual damage pathway;
- a compact chat status records the result; and
- guarded Undo can restore the recorded HP and temporary HP.

Nelflow does not replace PF2e's attack, damage, or damage-taken cards.

## Requirements

- Foundry VTT generation 14
- Pathfinder Second Edition system
- A GM-authored NPC Strike
- Exactly one targeted token

The integration was source-checked against PF2e 8.3.0 for Foundry 14. Runtime
capability checks fail closed when the expected APIs or message context are not
available.

## Installation for development

Place this folder at `Data/modules/nelflow`, restart Foundry, and enable
**Nelflow** in a disposable PF2e world. There are no runtime dependencies and
no build step.

Run the static checks with:

```powershell
npm run check
```

## Settings

- **Enable NPC Strike Auto-Resolution** — master switch, enabled by default.
- **Automatically Apply Strike Damage** — enabled by default. Disable it to
  autoroll damage while retaining PF2e's normal manual application controls.
- **Show Undo for Automatically Applied Damage** — enabled by default.
- **Enable Debug Logging** — disabled by default. Logs concise, namespaced
  message and transaction summaries.

## Safety model

The attack message receives a transaction flag before damage is rolled. That
flag contains immutable source, target, outcome, user, and timestamp data. The
damage message is correlated during its native creation and linked to the same
transaction. Any existing transaction state prevents the attack from being
processed again.

Damage is never parsed from chat HTML, reconstructed from weapon data, or
subtracted directly from HP. The recorded PF2e DamageRoll is passed through the
same contextual-clone and `Actor#applyDamage` path used by PF2e's chat damage
controls.

Undo checks that the current HP and temporary HP exactly equal the recorded
post-application values. If either changed, restoration is refused.

## Slice 1 limitations

- Only GM-authored NPC Strikes are handled.
- Exactly one target is required.
- Reactions are not detected or paused.
- Damage can be applied before Shield Block, Champion reactions, or house-rule
  reactions are declared.
- Undo restores only HP and temporary HP. It does not reverse conditions,
  persistent damage, shield damage, defeated state, or other resources.
- Spells, saves, area damage, multiple targets, and player-authored attacks are
  outside this slice.
- Spell and save automation is planned for later slices.
- Compact combined turn cards are planned for later slices.
- The module is experimental and should first be tested in a disposable world.

See [the API findings](docs/SLICE_001_API_FINDINGS.md) and
[the manual test plan](docs/SLICE_001_TEST_PLAN.md) for implementation and
validation details.
