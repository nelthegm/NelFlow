# Nelflow

Nelflow is an experimental Foundry VTT module for PF2e NPC Strike workflows.
Slice 1 safely continues one GM-authored NPC Strike against one recorded target
through PF2e's native damage and optional application pathways. Slice 2 groups
supported Strikes from one combatant turn into a durable compact chat stack.

```text
Stone Giant — Round 3
Greatclub → Vincent · Success · 24 bludgeoning · Applied · Undo
Greatclub · MAP −5 → Vincent · Critical Success · 47 bludgeoning · Applied
Fist · MAP −10 → Brynna · Failure
```

Original PF2e attack, damage, and damage-taken messages remain intact. With
native collapse enabled, Nelflow hides only their rendered body until Show
Details is selected; stored content and native controls are not rewritten.

## Requirements

- Foundry VTT generation 14
- Pathfinder Second Edition system (integration source-checked with PF2e 8.3.0)
- A GM-authored NPC Strike
- Exactly one targeted token

## Install or update

For a normal installation, extract `nelflow.zip` into Foundry's
`Data/modules/nelflow` directory so `module.json` is directly inside that
folder. Restart Foundry, enable **Nelflow** in a disposable PF2e world, and
perform the runtime test plan before using it in a live campaign.

For development, use this repository directly as `Data/modules/nelflow`. There
are no runtime dependencies and no build step.

Run static validation:

```powershell
npm run check
```

Build the upload archive from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```

The output is `dist/nelflow.zip`, with `module.json` at the ZIP root.

## Slice 2 behavior

- The first qualifying Strike in an active combatant turn creates one compact
  stack; later qualifying Strikes from that same turn append durable rows.
- Combat, round, combatant, turn marker, authoring GM, and roll visibility all
  participate in identity. Combat-order edits that leave the same combatant
  active do not merge genuinely separate turns.
- Rows are deterministically identified by the existing Slice 1 transaction
  and ordered by native attack-message creation order with an ID tie-breaker.
- Each row records its Strike icon/name, actual structured MAP penalty, recorded
  target references, outcome, structured damage total/types, application
  amount/state, Undo status, and native message references.
- A qualifying out-of-combat Strike receives its own standalone one-row result;
  unrelated attacks never merge.
- Reload renders stacks from ChatMessage flags. It does not reroll or reapply
  terminal transactions.
- Other GM clients render the stack but cannot project a transaction claimed by
  the authoring GM. Compact-row Undo is offered to that authoring GM.

The stack is presentation only. The native attack message's canonical
`flags.nelflow.transaction` remains the sole mechanical state.

## Settings

- **Enable NPC Strike Auto-Resolution** — master switch, enabled by default.
- **Automatically Apply Strike Damage** — enabled by default. Disable it to
  roll damage while retaining PF2e's native application controls.
- **Show Undo for Automatically Applied Damage** — enabled by default.
- **Compact Turn Stacks** — `NPC Strikes Only` by default; choose `Off` to keep
  Slice 1 per-message status presentation.
- **Collapse Linked Native Cards** — enabled by default. When disabled, compact
  stacks remain active and native PF2e cards stay fully expanded.
- **Enable Debug Logging** — disabled by default.

## Safety and Undo

The attack message receives its transaction and immutable target snapshot
before any damage roll begins. The native PF2e DamageRoll is passed through the
same contextual-clone and `Actor#applyDamage` path used by PF2e's chat controls.
Nelflow does not parse chat HTML for mechanics, reconstruct damage, subtract HP
directly, delete native messages, or monkey-patch PF2e.

Compact-row Undo calls the existing Slice 1 Undo for that exact attack
transaction. Current HP and temporary HP must exactly match the recorded
post-application state. A mismatch refuses restoration and marks only that row
Undo Blocked.

## Known limitations

- Only GM-authored NPC Strikes with exactly one target are supported.
- Spells, saves, areas, PC attacks, reaction handling, conditions, movement,
  and action tracking are outside this slice.
- Automatic application can precede Shield Block, Champion reactions, or
  table-specific reaction handling.
- Undo restores only guarded HP and temporary HP, not conditions, persistent
  damage, shields, effects, defeated state, or other resources.
- Manual use of PF2e's damage controls while auto-application is disabled is
  not tracked as an automatic application; the row remains Not Applied.
- A user-deleted native message cannot be reopened from row Details. The row
  and canonical transaction remain intact.
- Reloading while resolution is actively in flight reconstructs the last
  durable row but does not replay it, avoiding a duplicate roll or application.
- Chat modules that replace Foundry's standard message header/body structure
  may prevent visual collapse; Nelflow then leaves the native body visible.

## Testing and design documentation

Static checks validate syntax, JSON/localization, imports, module assets,
settings, and safety invariants. They are not Foundry runtime acceptance.

- [Slice 2 architecture](docs/SLICE_002_COMPACT_TURN_STACKS.md)
- [Slice 2 runtime test plan](docs/SLICE_002_TEST_PLAN.md)
- [Slice 1 API findings](docs/SLICE_001_API_FINDINGS.md)
- [Slice 1 regression plan](docs/SLICE_001_TEST_PLAN.md)
