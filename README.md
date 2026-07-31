# Nelflow

Nelflow is an experimental Foundry VTT module for PF2e NPC Strike workflows.
Slice 1 safely continues one GM-authored NPC Strike against one recorded target
through PF2e's native damage and optional application pathways. Slice 2 groups
supported Strikes from one combatant turn into a durable compact chat stack.
Slice 2.1 compacts each safely linked native audit card and reduces redundant
space inside that stack. Slice 2.2 makes the stack the primary visible record
and warns the GM about structured PF2e Strike riders. Slice 2.2.1 makes those
stacks reload-safe and gives new stack messages durable readable fallback HTML.
Slice 2.2.2 gives simultaneous native damage invocations exact
transaction-scoped correlation.

```text
[Foundry speaker: Stone Giant]
Round 3                                  Native Records (7)
Greatclub → Vincent
Hit · 24 bludgeoning · Applied (24 HP) · Details · Undo
Greatclub · MAP −5 → Vincent
Critical Hit · 47 bludgeoning · Applied (47 HP) · Actions (1) · Details
Fist · MAP −10 → Brynna
Miss · Details
```

Original PF2e attack, damage, and damage-taken messages remain intact. With
stack-first native records enabled, those exact messages are visually hidden
behind one viewer-local stack control. Revealing records shows compact audit
stubs first; Show Details restores each complete native message. Stored
content, rolls, PF2e flags, and native controls are never rewritten.

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
  terminal transactions. The renderer is registered before Foundry initializes
  chat history, so refreshes, reconnects, tab reopening, and older history
  batches use the same read-only projection as live messages.
- Other GM clients render the stack but cannot project a transaction claimed by
  the authoring GM. Compact-row Undo is offered to that authoring GM.

The stack is presentation only. The native attack message's canonical
`flags.nelflow.transaction` remains the sole mechanical state.

## Slice 2.1 native-card compaction

- Linked attack cards summarize the Strike and outcome.
- Linked damage cards summarize the Strike, evaluated total, and structured
  damage types without reading or reconstructing the displayed formula.
- Uniquely linked PF2e damage-application cards show a minimal target and
  applied HP/temp-HP audit line.
- Show Details and Hide Details operate independently on each native message.
  Expansion reveals the original PF2e subtree and all native or companion
  module controls.
- Foundry's outer speaker header remains. The stack's inner header now shows
  only the round or Outside Combat instead of repeating the actor.
- Closed row Details and guarded Undo controls share the wrapped result line;
  opening Details exposes exact attack, damage, and application references.

Compaction requires exact Nelflow message linkage, visible message content, and
the standard direct Foundry message header/content structure. If any check
fails, Nelflow leaves the full native card visible.

## Slice 2.2 stack-first chat

- **Native Records (N)** counts only exact linked attack, damage, and
  application messages visible to the current viewer.
- Records default hidden when compact stacks, native collapse, and the
  stack-first setting are all enabled. The control reveals one-line audit stubs
  without moving or cloning their ChatMessage documents.
- Audit stubs hide the outer message header while collapsed. Expanding one
  restores its complete Foundry header, native PF2e content, and all native or
  companion-module controls.
- Local show/hide state is independent per viewer and resets to the configured
  default after reload. It never mutates transaction or stack mechanics.
- Strike presentation uses **Critical Hit**, **Hit**, **Miss**, and **Critical
  Miss** while preserving PF2e's stored outcome values.
- PF2e NPC Strike `additionalEffects` and melee `attackEffects` produce a
  GM-visible **Actions (N)** indicator. Clicking it reveals, expands, focuses,
  and highlights the exact linked native attack message.
- Supplemental awareness is advisory. Nelflow never evaluates legality,
  executes a rider, or recreates an Improved Grab, Knockdown, Push, Whip
  Reposition, or other action.
- Row Details uses compact inline `Records: Attack · Damage · Application`
  links. Guarded Undo remains the existing Slice 1 operation.

When structured metadata is absent, Nelflow may locally recognize actual PF2e
semantic controls inside visible roll notes on the already-linked attack
message. It does not search prose or persist DOM-derived mechanics.

## Slice 2.2.1 reload rehydration

- Existing schema-1 and schema-2 stack messages rebuild directly from
  `flags.nelflow.stack` whenever Foundry renders them.
- Live messages, initial chat history, reconnects, rerenders, and later
  historical batches all use the same synchronous read-only renderer.
- Rendering is never gated by the authoring GM. Any permitted viewer can render
  the privacy-filtered stack and use local Native Records controls, without
  gaining transaction or persistent-stack mutation authority.
- Native records reconcile in either order: records rendered first are attached
  when their exact stack control appears, and records rendered later recognize
  an already-rendered exact control.
- New and legitimately updated Nelflow stack messages store semantic fallback
  HTML alongside their stack flag in the same document update. The fallback
  has no fake buttons, UUIDs, raw flags, or native-card duplication.
- Broadly visible fallback content uses a neutral target and omits damage,
  applied HP, and GM-only rider counts. Viewer-specific enhanced rendering may
  show additional information only when Foundry permissions allow it.
- Old placeholder-only messages are not bulk migrated. They still enhance from
  flags after reload; a later legitimate stack update repairs their stored
  fallback.

## Slice 2.2.2 concurrent damage correlation

- Every native `strike.damage` or `strike.critical` invocation receives one
  namespaced option through PF2e's supported damage-roll options parameter.
  PF2e carries that exact option into the created damage message's structured
  context flags.
- One central creation dispatcher resolves that option to an isolated
  transaction scope, then validates author, native DamageRoll, source
  actor/token/item, target actor/token, and success versus critical-success
  context.
- A session-local atomic claim registry prevents one damage message from being
  linked to two transactions. Persisted attack/damage flags remain authority
  and reconstruct terminal claims after reload.
- Concurrent identical Strikes can resolve in either order without name,
  timestamp, prose, or "latest message" matching. No global or actor queue is
  added.
- Before automatic application, Nelflow revalidates transaction state,
  processing-GM authority, claim ownership, exact native context, outcome, and
  target snapshot.
- If a DamageRoll returns but exact message ownership cannot be proven, the row
  shows **Damage rolled · Manual application required**. Nelflow does not
  reroll, link a guess, apply a candidate, or offer Nelflow Undo; native cards
  remain visible and usable.
- Debug mode records concise correlation lifecycle events without message
  content or formulas.

PF2e Workbench can independently autoroll damage on hits. For predictable NPC
automation, disable Workbench damage autoroll for users whose NPC Strikes
Nelflow processes; other Workbench features may remain enabled. Nelflow does
not automatically disable another module or claim its untagged damage cards.
Dice So Nice rendering order does not affect document-level correlation.

## Settings

- **Enable NPC Strike Auto-Resolution** — master switch, enabled by default.
- **Automatically Apply Strike Damage** — enabled by default. Disable it to
  roll damage while retaining PF2e's native application controls.
- **Show Undo for Automatically Applied Damage** — enabled by default.
- **Compact Turn Stacks** — `NPC Strikes Only` by default; choose `Off` to keep
  Slice 1 per-message status presentation.
- **Collapse Linked Native Cards** — enabled by default. When disabled, compact
  stacks remain active, native PF2e cards stay fully expanded, and Nelflow adds
  no replacement collapse controls.
- **Stack-First Native Records** — `Hide Behind Stack Control` by default;
  choose `Always Show Audit Stubs` to keep compact native summaries visible.
  This setting never hides messages when native collapse or compact stacks are
  disabled.
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
- PF2e application-card revert remains native and available after expansion,
  but does not reconcile Nelflow's separate transaction or stack state.
- Healing, zero-effect application messages without structured applied-damage
  data, and ambiguous concurrent application captures are left unlinked and
  fully native.
- Reloading while resolution is actively in flight reconstructs the last
  durable row but does not replay it, avoiding a duplicate roll or application.
- Chat modules that replace Foundry's standard message header/body structure
  may prevent visual collapse; Nelflow then leaves the native body visible.
- Supplemental Strike metadata indicates associated options, not whether the
  observed outcome currently makes them legal or useful.
- Custom riders without structured PF2e attack effects or recognizable
  semantic roll-note controls cannot be detected safely.
- Native-message focus requires the exact message element to be present in
  Foundry's rendered chat window; the stored record remains available even when
  it is not currently mounted.
- If enhancement fails on an old placeholder-only stack before it receives a
  legitimate projection update, the client attempts a read-only fallback from
  flags but does not write a migration during page load.
- Refreshing during an in-flight native damage call does not resume or transfer
  its ephemeral correlation scope. Nelflow preserves the last durable state
  and does not risk a second native roll.
- Manual PF2e application after a correlation fallback is intentionally not
  tracked as a Nelflow application and has no Nelflow Undo.
- A third party that copies Nelflow's exact namespaced correlation option can
  force safe ambiguity; Nelflow will not choose between two exact candidates.
- The observed external `preUpdateActor` / unqualified `setProperty` console
  error has no matching call or hook in Nelflow's source.

## Testing and design documentation

Static checks validate syntax, JSON/localization, imports, module assets,
settings, and safety invariants. They are not Foundry runtime acceptance.

- [Slice 2 architecture](docs/SLICE_002_COMPACT_TURN_STACKS.md)
- [Slice 2 runtime test plan](docs/SLICE_002_TEST_PLAN.md)
- [Slice 2.1 native-card compaction](docs/SLICE_002_1_NATIVE_CARD_COMPACTION.md)
- [Slice 2.1 runtime test plan](docs/SLICE_002_1_TEST_PLAN.md)
- [Slice 2.2 stack-first chat](docs/SLICE_002_2_STACK_FIRST_CHAT.md)
- [Slice 2.2 runtime test plan](docs/SLICE_002_2_TEST_PLAN.md)
- [Slice 2.2.1 reload rehydration](docs/SLICE_002_2_1_RELOAD_REHYDRATION.md)
- [Slice 2.2.1 runtime test plan](docs/SLICE_002_2_1_TEST_PLAN.md)
- [Slice 2.2.2 concurrent damage correlation](docs/SLICE_002_2_2_CONCURRENT_DAMAGE_CORRELATION.md)
- [Slice 2.2.2 runtime test plan](docs/SLICE_002_2_2_TEST_PLAN.md)
- [Slice 1 API findings](docs/SLICE_001_API_FINDINGS.md)
- [Slice 1 regression plan](docs/SLICE_001_TEST_PLAN.md)
