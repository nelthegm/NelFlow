# Nelflow

Nelflow is an experimental Foundry VTT module for PF2e NPC Strike workflows.
Nelflow 0.7.0 adds attacker-scoped NPC stacks and opt-out shared-roll
multi-target Strikes for NPCs and characters. An NPC in the active combat now
receives a stack for its actual token even when it attacks during another
creature's turn; two scene tokens linked to one actor remain separate.
Slice 1 safely continues one GM-authored NPC Strike against one recorded target
through PF2e's native damage and optional application pathways. Slice 2 groups
supported Strikes from one combatant turn into a durable compact chat stack.
Slice 2.1 compacts each safely linked native audit card and reduces redundant
space inside that stack. Slice 2.2 makes the stack the primary visible record
and warns the GM about structured PF2e Strike riders. Slice 2.2.1 makes those
stacks reload-safe and gives new stack messages durable readable fallback HTML.
Slice 2.2.2 gives simultaneous native damage invocations exact
transaction-scoped correlation. Slice 3.1 integrates PF2e Toolbelt Target
Helper so its existing target/save rows remain authoritative while Nelflow adds
guarded native basic-save damage application on the same damage card. Slice
3.1.1 guards the exact row's duplicate Toolbelt HP-damage controls after
conclusive handling while leaving save, reroll, Block, and record controls
available.
Slice 3.2 extends that same Toolbelt transaction, application, guard, and Undo
pipeline to structurally verified NPC `action` abilities with explicit basic
saves and one exact native damage roll.
Slice 3.3 automatically invokes PF2e's native spell damage API once for live,
deterministic Toolbelt basic-save spell cards, then hands the resulting native
damage message to the unchanged Slice 3.1/3.2 application workflow.
Slice 3.4 adds GM-only transaction diagnostics, sanitized bug-report export,
durable audit/recovery state, safe Toolbelt re-scan and existing-damage linking,
and fail-open handling for interrupted work. It adds no new automation category.
Slice 4.0, corrected through Nelflow 0.6.3, observes one character Strike regardless
of whether its active OWNER author is a player or GM. The user chooses PF2e's
native damage roll, then one authoritative GM applies that exact DamageRoll to
the attack's snapshotted target. Nelflow 0.6.5 keeps those mechanics unchanged,
uses one canonical application summary and guarded Undo, and never displays
transaction internals in ordinary chat.

```text
[Foundry speaker: Stone Giant]
Stone Giant                                  Results (5)
Greatclub → Vincent
Hit · 24 bludgeoning · Applied (24 HP) · Undo
Greatclub · MAP −5 → Vincent
Critical Hit · 47 bludgeoning · Applied (47 HP) · Actions (1)
Fist · MAP −10 → Brynna
Miss
```

Original PF2e attack, damage, and damage-taken messages remain intact. With
stack-first linked-card suppression enabled, those exact messages are hidden
only in the rendered chat DOM once the canonical Nelflow presentation is
available. **Results** then provides viewer-authorized Attack, Damage, and
Critical Damage roll inspection by hover or keyboard focus. Stored content,
rolls, PF2e flags, privacy, and native controls are never rewritten; uncertain
linkage or presentation failure leaves the native card visible.

## Requirements

- Foundry VTT generation 14
- Pathfinder Second Edition system (character Strike integration source-checked with PF2e 8.4.0)
- A supported NPC Strike or active player-/GM-owned character Strike with one
  target for the established flow, or two or more explicit targets for the
  shared-roll 0.7.0 flow, or
- PF2e Toolbelt 3.52.0-3.52.1 with Target Helper enabled for the recommended
  player- or GM-authored basic-save spell workflow, or a supported GM-authored
  NPC basic-save `action` ability

## Install or update

Foundry or Forge users can install the Nelflow 0.7.0 release-candidate build using this
manifest URL:

```text
https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json
```

The 0.7.0 manifest is prepared to download the eventual RC package from
`https://github.com/nelthegm/NelFlow/releases/download/v0.7.0-rc1/nelflow.zip`.
This development build has static and Node test coverage but has not yet
received Foundry/Forge runtime acceptance. Nelflow 0.6.5 remains the last
runtime-accepted stable release until 0.7.0 is published and tested.

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

## Nelflow 0.7.0 attacker stacks and multi-target Strikes

NPC compact stacks now use the explicit originating token, not the active
combatant, as the attacker. The stack key combines combat, round, a durable
turn-window marker, attacker token UUID, authoring GM, and message visibility.
Several attacks by one out-of-turn token share its stack during that window;
another token always receives another stack. The heading adds **Out of Turn**
without assuming the Strike was a Reaction.

Set **Shared-Roll Multi-Target Strikes** to **Off**, **NPC Strikes Only**, or
**Player and NPC Strikes** (the default). Zero or one target continues through
the established workflow. For two or more targets:

1. Target two or more tokens.
2. Click the Strike once.
3. Nelflow retains the immutable ordered target set and the one native attack.
4. The authoritative GM compares that result with each target's prepared AC,
   including natural-die and supported degree adjustments.
5. Nelflow invokes native normal damage once for normal hits and native
   critical damage once for critical hits.
6. Each result is applied independently through PF2e's contextual IWR pathway.

One parent transaction retains an ordered child record per target. A missing,
changed, concealed/hidden-unresolved, or otherwise unsafe target becomes
**Review** without cancelling completed siblings. Each applied child has its
own guarded Undo, and **Undo All** attempts only children whose current HP and
temporary HP still match their exact post-application snapshots. It never
forces a stale rollback or rerolls attack/damage.

NPC batches use one compact parent action row with concise target rows. Player
batches add one summary to the first viewer-visible exact linked native record.
Results are exact-ID and viewer-visibility gated, contain only Attack, Damage,
and Critical Damage rolls, and omit internal application proof. Transaction IDs,
UUIDs, authority data, correlations, HP snapshots, and diagnostic payloads do
not appear in ordinary chat. See the [0.7.0 architecture](docs/NELFLOW_0.7.0_ATTACKER_STACKS_AND_MULTI_TARGET_STRIKES.md),
[test plan](docs/NELFLOW_0.7.0_TEST_PLAN.md), and
[release notes](docs/RELEASE_NOTES_0.7.0.md).

## Slice 3.4 diagnostics and recovery

- Nelflow 0.6.5 never inserts transaction IDs, correlation state, authority
  evidence, audit fields, failure codes, or other transaction internals into
  ordinary chat. This applies to successful, failed, interrupted, recovered,
  and rehydrated NPC Strike, player Strike, basic-save, and Toolbelt records.
- Exceptional transactions add only a concise GM recovery line such as
  **Damage was not applied automatically** or **Application could not be
  verified**, plus **Review**. The review dialog contains guarded recovery
  actions and **Copy Support Info**, not an internal transaction dump.
- **Copy Support Info** exports sanitized JSON; clipboard failure opens a
  manual-copy dialog. Names, formulas, totals, full UUIDs/IDs, target lists,
  raw flags, credentials, URLs, and stack traces are excluded.
- **Re-scan Toolbelt State** reads structured flags without rolling, applying,
  or inspecting HP. **Use Existing Damage Message** requires structural
  compatibility, explicit selection, and confirmation.
- **Use Manual Handling** stops automation but permits ordinary native/manual
  work. **Stop Nelflow Automation** permanently ends Nelflow management for
  that record. **Enable Native Controls** restores presentation controls only.
- Active work records include a client-session marker. Work left claimed,
  rolling, processing, applying, or undoing by a prior session becomes review
  state on ready and is never automatically rerolled, reapplied, or undone.
- Diagnostic flags, audit state, sanitized export, and recovery behavior remain
  available to GMs. The legacy client setting key and stored values remain for
  compatibility but are hidden and no longer control chat rendering.

See [Slice 3.4 architecture](docs/SLICE_003_4_RUNTIME_DIAGNOSTICS_AND_RECOVERY.md)
and the [70-case runtime plan](docs/SLICE_003_4_TEST_PLAN.md). Nelflow 0.6.5
passed Foundry/Forge runtime testing before stable promotion.

## Nelflow 0.6.5 strict chat presentation

Player Strike application status renders once per logical transaction. The
viewer-visible native damage message is the preferred canonical host; if that
message is hidden or deleted, the visible attack and then application record
are deterministic fallbacks. A normal completed Strike adds one concise line,
for example `Applied 9 damage to Skeletal Mage`, and one guarded GM Undo when
legal. Linked attack/application cards do not repeat Nelflow-owned status or
Undo. Linked NPC application cards use a neutral **PF2e Application Record**
label instead of a second Applied summary.

Host selection uses only exact persisted message IDs and each viewer's native
message visibility. It creates no player-Strike stack, stores no presentation
authority, and never changes native content, rolls, flags, ownership, whispers,
or blind visibility. Reload reconstructs the same projection from existing
transaction flags. Undo still calls the existing exact guarded transaction
path; blocked Undo becomes a concise terminal status on the canonical host.
Non-GMs see the applied HP delta only when they can also see the exact native
application record; otherwise the line confirms application without the amount.
NPC compact stacks remain the principal Nelflow Strike presentation and their
row disclosures contain only exact viewer-entitled native PF2e record links.
Legacy diagnostic DOM is removed synchronously on every live, history, reload,
and reconnect render, with defensive CSS preventing a first-paint flash.

## Nelflow 0.6.3 deterministic character Strike damage

Set **Player Strike Auto-Apply** to **Hostile Targets** or **All Targets**. A
character's player or GM user targets once and rolls the Strike normally.
Nelflow snapshots the exact PF2e attack, source, target, author, action/index,
MAP, and final outcome, then shows **Waiting for Damage**. It never calls Damage
or Critical Damage. A capture-phase listener records a 30-second pending
intent for that exact attack card without stopping PF2e's handler. The outgoing
native damage message receives an inert exact binding. Binding does not finalize
the intent: one elected GM revalidates and claims that persisted relationship,
then applies its unchanged DamageRoll through PF2e's contextual
`Actor#applyDamage` pathway.

Current targeting cannot redirect damage. Hostile mode requires both the
snapshotted and current exact token disposition to remain hostile; friendly,
neutral, self, changed, missing, and indeterminate targets stay manual. All
Targets still requires the exact original token and every authority/identity
guard. Multiple targets, misses, missing targets, stale transactions, and
structurally ambiguous concurrent attacks stay manual. For a hit, the native
ordinary or critical damage variant selected by the user is authoritative and
is never transformed. Native healing, persistent, splash, category, and
material semantics present in that roll remain PF2e's responsibility.

### Nelflow 0.6.3 changes

- Fixed click intents being finalized before authoritative damage application.
- Exact same-message intent bindings are now idempotent rather than ambiguous.
- Direct click-intent correlation proceeds without requiring structured fallback candidates.
- Bound intents remain valid across processing delays, refreshes, and client disconnects.
- Character Strike damage now reaches native PF2e application after deterministic linking.

Native cards, rolls, roll modes, damage dialogs, controls, and Dice So Nice
animation remain intact. Player requests carry only a damage-message ID; the
GM re-reads all source, target, outcome, setting, ownership, disposition, and
state evidence. GM Undo is the existing guarded HP/temp-HP restoration.

Existing worlds migrate this setting to **Off** once so an update cannot begin
player-authored HP changes silently. Fresh worlds default to **Hostile
Targets**. See [Slice 4.0 architecture](docs/SLICE_004_0_PLAYER_STRIKE_AUTO_APPLY.md)
and the [164-case runtime plan](docs/SLICE_004_0_TEST_PLAN.md).

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

## Slice 2.1 native-card preservation

- Exact linked PF2e attack, damage, critical-damage, and application messages
  remain intact as private recovery/audit documents.
- When configured, their ordinary visual card is suppressed only after an
  exact canonical Nelflow stack or character summary renders successfully.
- The visible stack heading identifies the attacker and may say **Out of
  Turn**. Round remains in the internal stack identity but is not displayed.
- Guarded Undo stays on the canonical application summary; application records
  remain internal proof and do not add another viewer-facing control.

Suppression requires exact Nelflow message linkage, viewer-visible message
content, and a working canonical summary. If any check fails, Nelflow leaves
the full native card visible and functional.

## Slice 2.2 stack-first chat and Results

- **Results (N)** counts only exact linked Attack, Damage, and Critical Damage
  messages visible to the current viewer after filtering. Application records
  are excluded, and Results is omitted when the count is zero.
- Hovering or focusing a Results entry opens a compact roll popover built from
  evaluated `message.rolls` and structured PF2e flags, never chat-card HTML.
- Attack inspection includes available d20, modifier/MAP breakdown, total, and
  authorized outcome context. Damage inspection includes evaluated dice,
  static terms, type/category, critical terms, and total.
- The popover closes on pointer/focus exit or Escape and clamps to the viewport.
- Local show/hide state is independent per viewer and resets to the configured
  default after reload. It never mutates transaction or stack mechanics.
- Strike presentation uses **Critical Hit**, **Hit**, **Miss**, and **Critical
  Miss** while preserving PF2e's stored outcome values.
- PF2e NPC Strike `additionalEffects` and melee `attackEffects` produce a
  GM-visible **Actions (N)** advisory indicator without revealing a duplicate
  native card.
- Supplemental awareness is advisory. Nelflow never evaluates legality,
  executes a rider, or recreates an Improved Grab, Knockdown, Push, Whip
  Reposition, or other action.
- Guarded Undo remains the existing Slice 1 operation and is not duplicated by
  Results.

When structured metadata is absent, Nelflow may locally recognize actual PF2e
semantic controls inside visible roll notes on the already-linked attack
message. It does not search prose or persist DOM-derived mechanics.

## Slice 2.2.1 reload rehydration

- Existing schema-1 and schema-2 stack messages rebuild directly from
  `flags.nelflow.stack` whenever Foundry renders them.
- Live messages, initial chat history, reconnects, rerenders, and later
  historical batches all use the same synchronous read-only renderer.
- Rendering is never gated by the authoring GM. Any permitted viewer can render
  the privacy-filtered stack and use local Results controls, without
  gaining transaction or persistent-stack mutation authority.
- Linked native messages reconcile in either order: messages rendered first
  are suppressed when their exact stack appears, and messages rendered later recognize
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

## Slice 3.1 Toolbelt basic-save workflow

Enable PF2e Toolbelt's world setting **Target Helper**, then leave Nelflow's
**Basic Save Workflow** on **Toolbelt Target Helper**. Cast or post the spell,
roll its native damage once, and resolve saves through Toolbelt's existing
target rows. Nelflow creates no resolver card and adds no parallel save or
target controls.

Toolbelt's persisted exact targets and finalized save outcomes are authoritative.
One deterministic active GM claims player- or GM-authored damage messages and
uses the existing native DamageRoll:

- Critical Success: no application
- Success: half
- Failure: full
- Critical Failure: double

IWR, typed instances, materials, temporary HP, ephemeral effects, and rounding
remain native. Each target records its actual HP/temp-HP delta and guarded
Undo on the existing damage message. Exact native application records remain
available. Splash rows, persistent damage, healing, non-basic saves, ambiguous
damage cards, and unsupported Toolbelt versions fail open to Toolbelt's manual
controls.

Application timing can wait for every primary save, process each resolved row,
require one compact GM confirmation on the damage card, or remain Off. A reroll
before claim invalidates stale work. A changed result after application becomes
Manual Review Required and never silently changes HP again.

After a conclusive Nelflow or structurally proven external application,
Toolbelt's Damage, Half, Double, and Triple controls are guarded for that exact
message, target token, application, and roll index. Successful Nelflow Undo
restores only Nelflow's restrictions and preserves Toolbelt's original disabled
state. Undo Blocked and Result Changed remain guarded. The processing GM can
explicitly **Enable Manual Damage** after a confirmation warning, or later
**Guard Damage Controls** again; this presentation choice persists without
changing HP or saves. If exact Toolbelt 3.52.x semantic markup cannot be
proven, Nelflow keeps its status and leaves native controls usable.

The original Slice 3 interface remains as **Legacy Nelflow Resolver
(Experimental)** for Toolbelt-free testing. It is not recommended with Target
Helper and cannot process alongside Toolbelt mode.

## Slice 3.2 NPC basic-save abilities

With **Toolbelt Basic Save Sources** set to **Spells and NPC Abilities**, use an
NPC action such as Dragon Breath normally, target creatures, click its native
damage roll once, and resolve saves through Toolbelt. Nelflow observes that
exact Toolbelt-enriched damage message and reuses the existing application
timing, per-target status, Application Record, guarded Undo, and duplicate
damage-control guards. The compact header identifies a viewer-safe ability
name when permissions allow it; otherwise it says **Basic Save Ability**.

Eligibility requires exact agreement between Toolbelt's structured source
actor/item/basic-save data and PF2e's independent NPC action origin and
save-governed damage context. One regular native DamageRoll is supported; a
separate structurally marked splash roll may coexist. Player abilities,
hazards, NPC feats, Strikes, attack-plus-save effects, non-basic or
description-only saves, healing, persistent damage, splash-only rows, and
messages with multiple ambiguous regular rolls remain entirely native/manual.
No action, save, or damage is rerolled and no ability resolver is created.

## Slice 3.3 deterministic damage autoroll

Set **Automatic Basic Save Damage Roll** to **GM-Authored Sources** or **All
Eligible Sources**. For an exact live Toolbelt basic-save spell with targets,
one resolved cast rank/overlay, and one regular choice-free damage action,
Nelflow durably claims the source card and calls that exact reconstructed
`SpellPF2e#rollDamage` once. PF2e creates the normal DamageRoll and
ChatMessage; Toolbelt targets are carried through its public target-flag API,
and the existing save/application timing remains authoritative.

The source card shows Waiting for Targets, Auto-Rolling, Damage Rolled,
External Damage Roll Detected, or a manual/unavailable state. Claimed and
completed controls are presentation-guarded against accidental duplicate
rolls. The author or a GM may explicitly **Enable Manual Damage Roll** after a
warning, then **Guard Damage Roll** again. This override survives reload.

Only the exact active source author invokes the native action. Historical cards
never start work, nonterminal claims become Interrupted after reload, and
terminal cards never retry. A structurally unique external damage card created
first is linked as external; ambiguity cancels autoroll rather than choosing by
name, time, total, or chat position.

PF2e 8.3.0 exposes no native damage invocation method on `AbilityItemPF2e`.
NPC action damage is reachable only through enhanced inline-damage card
listeners. Because Slice 3.3 never clicks DOM controls, calls listeners, parses
HTML/formulas, or creates substitute rolls, NPC ability source cards safely
remain manual. Their already-accepted Slice 3.2 damage application continues
unchanged after the user rolls native damage. Damage dialogs, unresolved
variants, attack spells, healing, persistent/splash-only damage, missing
targets, and ambiguous structures also remain manual.

## Settings

- **Enable NPC Strike Auto-Resolution** — master switch, enabled by default.
- **Automatically Apply Strike Damage** — enabled by default. Disable it to
  roll damage while retaining PF2e's native application controls.
- **Show Undo for Automatically Applied Damage** — enabled by default.
- **Player Strike Auto-Apply** — `Hostile Targets` in a fresh world, with
  `Off` and `All Targets` alternatives. The version-4 migration sets existing
  Nelflow worlds to Off once; a GM must explicitly opt in after updating.
- The legacy **Show Transaction Diagnostics** client key remains registered
  with existing stored values intact, but is hidden from Configure Settings.
  No legacy mode displays transaction internals in chat. Sanitized support
  export, audit data, and guarded recovery remain available through **Review**.
- **Compact Turn Stacks** — `NPC Strikes Only` by default; choose `Off` to keep
  Slice 1 per-message status presentation.
- **Collapse Linked Native Cards** — enabled by default. When disabled, compact
  stacks remain active, native PF2e cards stay fully expanded, and Nelflow adds
  no replacement collapse controls.
- **Stack-First Results** — `Stack Only` by default; choose `Show Linked Native
  Cards` to keep native PF2e cards visible alongside the compact summary.
  This setting never hides messages when native collapse or compact stacks are
  disabled.
- **Basic Save Workflow** — defaults to `Toolbelt Target Helper`; alternatives
  are `Off` and `Legacy Nelflow Resolver (Experimental)`.
- **Toolbelt Basic Save Application** — defaults to `When All Saves Are
  Resolved`; alternatives are per-target, GM confirmation, and Off.
- **Toolbelt Basic Save Sources** — defaults to `Spells and NPC Abilities`;
  choose `Spells Only` to retain Slice 3.1 behavior and leave non-spell NPC
  abilities manual. Migration updates this once only for existing Toolbelt
  workflow worlds and does not change Off or Legacy selections.
- **Automatic Basic Save Damage Roll** — defaults to `All Eligible Sources`
  for a new world. `GM-Authored Sources` limits invocation to source messages
  authored by an active GM; `Off` preserves the prior manual workflow. The
  version-3 migration sets this setting to Off once for existing worlds and
  does not alter Basic Save Workflow, source modes, or Legacy mode. In PF2e
  8.3.0, deterministic direct spell sources are supported; NPC action sources
  remain manual because the system exposes no native item damage method.
- **Guard Toolbelt Damage Controls** is enabled by default. It guards only
  Damage/Half/Double/Triple for an exactly identified, conclusively handled
  target. Disable it to retain normal Toolbelt controls without changing
  Nelflow application, status, records, or Undo.
- The old Basic Save Spell Resolver setting remains hidden for migration only.
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

- NPC automation remains limited to GM-authored single-target Strikes. Character
  automation supports active OWNER player-, assistant-GM-, or GM-authored
  single-target Strikes after the user creates native damage; familiars,
  companions, NPCs, hazards, spell/impulse attacks, and multiple targets stay
  manual.
- Automatic application can precede Shield Block, Champion reactions, or
  table-specific reaction handling.
- Undo restores only guarded HP and temporary HP, not conditions, persistent
  damage, shields, effects, defeated state, or other resources.
- Manual use of PF2e's damage controls while auto-application is disabled is
  not tracked as an automatic application; the row remains Not Applied.
- A user-deleted native message disappears from Results. The row and canonical
  transaction remain intact, and an empty Results disclosure is not shown.
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
- Slice 3.1 does not resume an in-flight application after reload.
- Persistent and splash damage remain manual.
- Toolbelt 3.52.x does not export its application function or update queue.
  Nelflow revalidates immediately before applying, but cannot atomically lock a
  truly simultaneous manual Toolbelt button click; GM Confirmation is safest
  when manual and automatic application may be mixed.
- Native PF2e application Undo does not synchronize Nelflow's status projection.
- Damage deliberately applied after Enable Manual Damage is not tracked and
  requires GM judgment; Nelflow does not automatically re-guard it.
- Toolbelt target markup replaced by another module fails open, leaving native
  controls functional and the Nelflow status visible.
- PF2e 8.3.0 NPC abilities are supported only as exact `action` item origins.
  Toolbelt 3.52.x does not preserve the originating action-card message ID or
  an exact save mapping for multiple regular rolls, so those cases stay manual.
- Conditions by degree, forced movement, persistent/splash damage, healing,
  and attack-plus-save ability effects are not automated.
- Slice 3.3 supports direct `SpellPF2e` source cards only. Consumable-embedded
  spells and PF2e 8.3.0 NPC `AbilityItemPF2e` sources lack a proven equivalent
  native invocation path and remain manual.
- A user whose PF2e **Show Damage Roll Dialogs** preference is enabled remains
  manual: Nelflow will not open, bypass, or auto-confirm a choice-capable
  damage dialog.
- External-roll correlation without Nelflow's inert origin marker must be
  structurally unique. Concurrent identical unmarked sources become Ambiguous
  and do not autoroll.
- PF2e 8.4.0 character Strike damage cards do not natively persist their
  originating attack-message ID. Nelflow 0.6.3 and later supply it for normal native
  card clicks. Structurally identical unmarked messages or same-user dialogs
  completed out of causal order can still require recovery rather than a
  time/chat-order guess.
- PF2e exposes no conclusive structured Shield Block eligibility signal for
  this workflow. Nelflow 0.6.3 adds no reaction prompt and uses no Shield Block;
  tables requiring reaction decisions should keep Player Strike Auto-Apply Off.
- Private/self-roll documents unavailable to the elected GM cannot be applied.

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
- [Slice 3 NPC basic-save resolver](docs/SLICE_003_BASIC_SAVE_SPELL_RESOLVER.md)
- [Slice 3 runtime test plan](docs/SLICE_003_TEST_PLAN.md)
- [Slice 3.1 Toolbelt auto-application](docs/SLICE_003_1_TOOLBELT_AUTO_APPLICATION.md)
- [Slice 3.1 runtime test plan](docs/SLICE_003_1_TEST_PLAN.md)
- [Slice 3.1.1 Toolbelt control guards](docs/SLICE_003_1_1_TOOLBELT_CONTROL_GUARDS.md)
- [Slice 3.1.1 runtime test plan](docs/SLICE_003_1_1_TEST_PLAN.md)
- [Slice 3.2 Toolbelt NPC basic-save abilities](docs/SLICE_003_2_TOOLBELT_NPC_BASIC_SAVE_ABILITIES.md)
- [Slice 3.2 runtime test plan](docs/SLICE_003_2_TEST_PLAN.md)
- [Slice 3.3 deterministic damage autoroll](docs/SLICE_003_3_DETERMINISTIC_DAMAGE_AUTOROLL.md)
- [Slice 3.3 runtime test plan](docs/SLICE_003_3_TEST_PLAN.md)
- [Slice 4.0 / Nelflow 0.6.3 character Strike auto-apply](docs/SLICE_004_0_PLAYER_STRIKE_AUTO_APPLY.md)
- [Nelflow 0.6.3 character Strike runtime test plan](docs/SLICE_004_0_TEST_PLAN.md)
