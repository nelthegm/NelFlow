# Slice 003: NPC Basic Save Spell Resolver

## Scope and workflow

Slice 3 adds an explicit, persistent resolver for GM-authored NPC spell cards
with one structured PF2e basic Fortitude, Reflex, or Will save and native spell
damage. The GM targets the intended creatures, clicks **Start Basic Save
Resolver**, owners roll from their own rows, and the authoring GM rolls NPC or
unowned saves. When all saves are final, the GM clicks **Resolve Damage**.

The resolver rolls spell damage once, then applies PF2e's native zero,
half, full, or double pathway independently. It does not cast the spell, expend
a slot, find template targets, resolve conditions, automate non-basic saves, or
handle spell attacks.

## Verified PF2e 8.3.0 APIs

The official PF2e source was inspected at pinned commit
`fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525`.

- `src/module/item/spell/data.ts` defines structured
  `system.defense.save.statistic` and `system.defense.save.basic`.
- `SpellPF2e#getChatData` obtains the DC from the spellcasting statistic and
  determines native damage availability with `getDamage`.
- `SpellPF2e#toMessage` stores `flags.pf2e.context.type = "spell-cast"`,
  casting data, and exact origin item data.
- `StatisticCheck#roll` accepts `dc`, `item`, `origin`, `token`, and
  `extraRollOptions`. It delegates to `Check.roll` rather than exposing a
  formula.
- `Check.roll` persists the finalized PF2e outcome at
  `flags.pf2e.context.outcome`, numeric degree at
  `roll.options.degreeOfSuccess`, structured DC, origin/target UUIDs, statistic,
  roll options, and author. Nelflow requires the numeric and string outcomes to
  agree.
- `SpellPF2e#rollDamage` calls `getDamage` and `DamagePF2e.roll`, returning the
  evaluated native `DamageRoll`. It does not accept arbitrary extra roll
  options.
- PF2e's `applyDamageFromMessage` uses `DamageRoll#alter(multiplier, addend)`
  for positive half/full/double transforms, then builds a contextual target
  clone and calls `ActorPF2e#applyDamage` with IWR enabled.
- `ActorPF2e#applyDamage` handles IWR, temporary HP, rounding, and creates the
  native `damage-taken` application message.

Nelflow therefore passes an exact option through native save rolls. For the
single spell damage call, it uses one tightly scoped Foundry
`preCreateChatMessage` marker because `SpellPF2e#rollDamage` exposes no custom
option parameter. Zero or multiple exact candidates fail safely.

## Verified Foundry V14 APIs

Foundry V14's `preCreateChatMessage` runs only on the creating client and
requires pending-source changes through `Document#updateSource`. The
post-create hook runs on connected clients. `renderChatMessageHTML` receives
the pending `HTMLElement` and is suitable for read-only enhancement.
`ChatMessage#visible` and `isContentVisible` are checked before presenting
records. Resolver flags and fallback content are written together in one
`ChatMessage#update`.

## Source eligibility

The Start control appears only when all of the following are structurally
proven:

- setting mode is `npc-spells`;
- current user is the GM author of the source message;
- PF2e message context is `spell-cast`;
- message actor is an NPC;
- exact message item is a spell and is not an attack spell;
- `system.defense.save.basic` is true;
- the statistic is Fortitude, Reflex, or Will;
- the item-scoped spellcasting DC is numeric;
- `getDamage` returns a native template/context; and
- `rollDamage` is callable.

Description prose and rendered card HTML are never inspected. An uncertain
source stays entirely native.

## Immutable target snapshot

Start reads `game.user.targets` once. Entries without an actor or token UUID
are omitted, exact token UUIDs are deduplicated, and order is preserved.
Changing targets later has no effect. A repeated actor represented by two
different tokens remains two exact rows; applications occur sequentially
against each token/actor snapshot. Hidden tokens receive a neutral stored name
and image. Slice 3 does not add or remove targets after creation.

## Persistent parent and child design

The resolver message stores `flags.nelflow.saveResolver`, schema version 1.
Important parent fields are:

- deterministic `resolverId` derived from the source message;
- exact source message, actor, token, and spell item references;
- authoring and processing GM IDs;
- source visibility and optional combat reference;
- structured save type, DC, and `basic: true`;
- phase, immutable `targetOrder`, target records, shared damage record,
  native-record references, and monotonic revision.

Phases are `collecting-saves`, `ready`, `rolling-damage`,
`applying-damage`, `complete`, `partial`, `cancelled`, `error`, and
`interrupted`.

Each child stores a deterministic ID derived from resolver, token UUID, and
snapshot sequence; actor/token/scene references; safe presentation; owner IDs;
save DC/type; attempt; current and prior save messages; raw/final outcome;
override; multiplier; deterministic application ID; damage/application
summaries; HP/temp-HP guards; Undo state; and a concise reason code.

The parent transaction is authoritative. DOM state never drives mechanics.

## Save initiation, ownership, and correlation

An actor owner can roll only a stored PC row. The authoring GM can roll any row
and can batch pending NPC/unowned rows. The target actor's native
`saves[type].check.roll` receives the exact DC, source spell, caster origin,
target token, `damaging: true`, and a transaction-scoped option containing:

- resolver ID;
- target entry ID;
- attempt ID;
- source message ID; and
- rolling user ID.

The adapter owns one `createChatMessage` dispatcher. The authoring GM validates
the exact option, author, actor, token when present, caster, spell, saving-throw
statistic, DC, native CheckRoll, finalized outcome, active attempt, and owner/GM
eligibility. First valid claim wins by message ID. Names, totals, timestamps,
prose, and chat order are not correlation evidence.

PF2e's finalized outcome is authoritative. Nelflow does not implement natural
1/20 adjustment, incapacitation, fortune/misfortune, evasion, or other degree
adjustments.

## Override and Reset Save

Before damage begins, the authoring GM may select Native Result or one of the
four degrees. The native result remains stored and the UI shows **Adjusted**.
The compact controls accept an optional reason. It is persisted for GM audit
but never rendered to players or fallback content.

Reset Save preserves the previous save message as an audit record, increments
the attempt ID, clears the active result and override, and returns the row to
pending. An old correlation option cannot satisfy the new attempt. This is not
a Hero Point reroll and neither spends nor refunds resources.

## Shared native damage and basic-save transforms

Resolve Damage is manual and GM-only. It first persists the mechanical
`rolling-damage` claim. It invokes the exact source spell's native
`rollDamage` once and accepts exactly one invocation-scoped native DamageRoll
message. That message ID is persisted before any target application.

For each target:

- Critical Success records No Damage and never calls `applyDamage`.
- Success uses native `DamageRoll#alter(0.5, 0)`.
- Failure passes the native roll unchanged.
- Critical Failure uses native `DamageRoll#alter(2, 0)`.

The transformed roll retains PF2e damage instances, types, categories,
materials, traits, and native rounding behavior. Nelflow then uses the same
contextual-clone and `ActorPF2e#applyDamage` pathway as PF2e chat controls, with
IWR enabled. Target applications are sequential. Pre/post HP and temporary HP,
actual combined delta, transformed structured summary, and a uniquely captured
native application message are persisted after each target.

One target failure becomes manual/partial without rerolling damage or replaying
completed targets.

## Persistent damage limitation

If any structured native damage instance is persistent, Slice 3 automatically
applies none of the damaging rows. They are marked **Manual application
required**, and the exact shared native damage record remains available.
Slice 3 does not create, track, or undo persistent-damage conditions.

## Guarded Undo

Slice 1 and Slice 3 share `guardedHealthRestore`. Per-target Undo resolves the
exact stored token, verifies its actor, and restores only if current HP and
temporary HP exactly equal the recorded post-application values. It restores
the recorded pre-application values and updates only that child. Changed
resources produce Undo Blocked. No Undo is offered for no-damage, manual, or
not-applied rows.

## Native Records

Exact source spell, current/prior saves, shared damage, and captured
application message IDs form the resolver audit set. The existing Stack-First
Native Records setting controls whether these records begin hidden. The
resolver-level control reveals them without deleting, replacing, moving, or
rewriting native messages. Each row links its exact save and application;
shared damage is linked from the footer. Inaccessible records are not counted
or revealed. If no resolver control is rendered, native records fail open.

## Reload and duplicate prevention

The fallback HTML and complete resolver flag are updated atomically. Rendering
is synchronous, read-only, registered during setup, and reconstructs from
flags. Terminal child states are never eligible to apply again. Save claims
are restored from child message IDs.

Slice 3 deliberately does not resume `rolling-damage` or `applying-damage`
after reload. The authoring GM client changes such a transaction to
`interrupted`, marks remaining applications manual, and never rerolls or
reapplies.

Local per-resolver queues serialize simultaneous save completions and target
updates. Deterministic IDs, an in-flight damage lock, phase guards, exact
message claims, and per-target terminal guards prevent double-click, rerender,
reload, and hook replay.

## Authority and privacy

Only the source-authoring GM creates, cancels, overrides, resets, rolls parent
damage, applies targets, updates the resolver, or uses Nelflow Undo. Other GMs
render but do not take over. Player clients only invoke their owned actor's
native save; the authoring GM observes and validates the resulting native
message.

The resolver copies source whisper/blind recipients and is never broader than
the source. Foundry visibility/content visibility protects native records.
Hidden targets use neutral stored presentation. Non-GMs see the DC in the
enhanced header only when PF2e's metagame DC setting permits it. Fallback is
non-interactive and contains no UUIDs or diagnostics.

## Compatibility and limitations

- PF2e Workbench must not independently roll/apply the same spell damage.
  Overlapping automation should be disabled for runtime acceptance.
- Dice So Nice sees native save and damage rolls normally.
- Toolbelt and other card controls remain on the intact native messages.
- Spell slot expenditure, casting, templates, reactions, conditions,
  persistent damage, Hero Point rerolls, non-basic effects, hazards, NPC
  abilities, and authority handoff are outside this slice.
- Deleting the source message before damage makes resolution manual/error.
- A hidden target's exact UUID remains mechanical flag data in the resolver
  document; it is never rendered in enhanced or fallback content.
- Runtime acceptance in Foundry V14/PF2e 8.3.0 is still required.
