# Slice 002: Compact NPC Turn Stacks

## Pre-implementation Slice 1 lifecycle

This baseline was recorded before Slice 2 implementation against commit
`b9dda803a24565427383cf5c5e2ef73e90ca48ee`.

1. Foundry's `createChatMessage` hook passes a completed PF2e attack message to
   `StrikeResolver.handleAttackMessage`.
2. `PF2eAdapter.inspectStrikeMessage` verifies that the message is a
   GM-authored NPC Strike, cross-checks PF2e's finalized degree of success, and
   resolves the prepared Strike and its recorded target context.
3. `TransactionStore.claim` writes the canonical mechanical transaction to
   `flags.nelflow.transaction` on the native attack message before rolling
   damage. Its deterministic ID is `nelflow-<attack message ID>`.
4. Failure and critical failure transition directly from `processing` to
   `skipped`.
5. Success and critical success call the prepared Strike's native `damage` or
   `critical` method. A scoped `preCreateChatMessage` capture marks the exact
   PF2e damage message and links it to the attack transaction.
6. With auto-application enabled, the PF2e DamageRoll is passed through the
   system's contextual-clone and native `applyDamage` pathway. The target's HP
   and temporary HP are recorded before and after application.
7. The canonical transaction transitions to `damage-rolled`, `applied`,
   `failed`, or `undone`; compact markers on linked native messages point back
   to the attack message.
8. Slice 1 chat rendering resolves those markers back to the canonical attack
   transaction. It never treats linked-message flags as mechanical authority.
9. Guarded Undo resolves the exact canonical transaction, requires current HP
   and temporary HP to equal the recorded post-application values, restores
   only the recorded pre-application values, and transitions that transaction
   to `undone`.

Slice 2 will preserve this lifecycle. A compact stack and its rows are a
durable presentation projection of canonical Slice 1 transactions; they do not
roll, apply, or reverse damage themselves.

## Architecture

Slice 2 adds `TurnStackService` between the canonical transaction and chat
rendering. `StrikeResolver` still owns every mechanical transition. After each
transition it asks the service to project the latest transaction into a stack
row. Projection failures are caught, logged with the `Nelflow |` namespace, and
recorded on the transaction where possible; they do not interrupt PF2e's native
attack, damage-roll, or damage-application documents.

The service serializes updates to each stack in the authoring client. A
deterministic Foundry document ID and `keepId` create operation provide a
persistent duplicate barrier. The canonical attack flag is bound to its stack
on the first projection so later damage completion, turn advancement, and Undo
continue updating the original row.

## Stack identity

A combat stack key contains:

- combat ID;
- round;
- active combatant ID;
- the turn index at the start of the turn;
- a durable turn-marker ID;
- authoring/processing GM user ID; and
- a visibility key derived from the attack message's blind and whisper state.

The active GM writes `flags.nelflow.turnMarker` on the Combat document from
Foundry's `combatTurnChange` hook. A same-round order edit that leaves the same
combatant active retains the marker. Leaving and returning to a combatant, or
changing rounds, writes a new marker. If the marker is absent when the first
Strike arrives, the authoring GM persists it then. No stack is created merely
because a turn begins.

An attack is grouped only when an active combat's current combatant matches the
snapshotted source actor or token. Otherwise its key contains the transaction
ID and produces a one-row `standalone` stack. Different roll visibility also
produces a different stack so a private result cannot be appended to a public
message.

The stack ChatMessage ID is a deterministic 16-character hash of the complete
key. A pre-existing document must also carry the same key before it is reused.

## Row identity and ordering

Each row ID is the existing Slice 1 transaction ID,
`nelflow-<attack-message-id>`. The attack message ID is stored separately and
used as the deterministic secondary ordering key. Rows sort by native attack
message creation time and then attack message ID, so damage operations that
finish out of order cannot reorder the attacks.

Upsert is by row ID. The same transaction can therefore move from Resolving to
a terminal state without creating a duplicate row.

## Persistent flags

The native attack message remains authoritative at:

`flags.nelflow.transaction`

Slice 2 adds presentation fields to that record:

- `stackRef`: immutable stack document ID, key, kind, identity, and visibility;
- structured Strike/source/target names, icons, references, MAP increases, and
  the actual enabled multiple-attack penalty in `snapshot`;
- `damageSummary`, produced from PF2e DamageRoll instances;
- `autoApplyRequested`, `undoBlocked`, and `presentationError`.

The stack message stores:

`flags.nelflow.stack`

Its schema version is 1 and contains the full stack identity, actor projection,
creation/update times, and all durable rows. Every row includes transaction and
native-message references, stable sequence data, target references, outcome,
structured damage summary, application amount, transaction state, and Undo or
presentation-error state.

Linked native attack, damage, and application messages retain compact
`flags.nelflow.transaction` markers. They resolve back to the canonical attack
record; their markers are never treated as damage authority.

## Lifecycle and states

Typical transitions are:

```text
processing / Resolving
  -> skipped / Critical Failure or Failure
  -> damage-rolled / Pending Application or Not Applied
  -> applied / Applied
  -> undone / Undone
```

`criticalFailure`, `failure`, `success`, and `criticalSuccess` remain the
recorded PF2e outcomes. A guarded refusal sets `undoBlocked` without weakening
or replacing the applied transaction. Mechanical or projection failures render
as Error. The labels Resolving, Critical Failure, Failure, Success, Critical
Success, Pending Application, Applied, Not Applied, Undone, Undo Blocked, and
Error are localized.

## Authority and duplicate prevention

Slice 1's author rule is unchanged: only a GM client whose user ID is the native
attack message author may claim and process it. Slice 2 additionally requires
that the current client match the transaction's persisted `processingUserId`
before creating or updating a stack. Other GMs render the persistent message
but do not project rows. Compact-row Undo is shown only to that persisted GM;
the underlying Slice 1 guard remains unchanged.

The attack transaction is claimed before native damage is rolled. Its presence
still prevents terminal or in-progress attacks from being processed again.
Deterministic stack and row IDs, persistent `stackRef`, keyed update
serialization, and validation of an existing stack key prevent stale or
out-of-order projections from creating replacements.

## Reload reconstruction

There is no in-memory reconstruction map. Foundry reloads stack messages and
their complete row arrays from ChatMessage flags. Native linked-message flags
retain their collapse relationship. Undo resolves the stored attack message
and canonical transaction, so it continues to use Slice 1's pre/post HP and
temporary-HP guards after a reload or turn advancement.

The only in-memory state is a short-lived per-stack promise queue used to
serialize writes within the authoritative client. It is not required for
rendering or recovery.

## Native-card collapse

The module never deletes or rewrites a PF2e message's stored content. During
`renderChatMessageHTML`, a linked native message receives Nelflow CSS classes
and a keyboard-operable Show Details/Hide Details button. CSS hides the
existing rendered body while retaining the Foundry message header. Expanding
removes only the collapse class, leaving PF2e's original DOM and button
listeners in place. Each native card expands independently.

Row Details controls link to the exact native attack and damage messages. A
missing message produces a localized unavailable notification; the durable row
and its mechanical transaction remain unchanged.

## Settings

- **Compact Turn Stacks** is a string-valued world setting. Supported values
  are `off` and `npc-strikes`; the latter is the default. A string mode allows
  future action families without changing the stored setting type.
- **Collapse Linked Native Cards** is a Boolean world setting, enabled by
  default. It applies only while compact stacks are enabled.

The existing enable, auto-apply, Undo, and debug settings retain their behavior.

## Verified API surface

Implementation was checked against Foundry VTT generation 14 documentation for
`combatTurnChange`, `Combat.current`/`combatant`, document flags,
`renderChatMessageHTML`, deterministic document creation with `keepId`, and
active-GM selection. PF2e integration was source-checked at the 8.3.0 release
for structured attack modifiers, `mapIncreases`, `DamageRoll.instances`,
`DamageInstance.type`/`total`, native Strike damage functions, and contextual
`Actor#applyDamage`.

No chat-card HTML is inspected for outcome, damage, damage types, target, MAP,
transaction state, or application behavior.

## Compatibility and known limitations

- Native PF2e messages, rolls, flags, visibility, controls, and Dice So Nice
  creation/animation remain intact.
- No PF2e method is monkey-patched. The implementation uses document hooks,
  flags, the already verified Slice 1 calls, and render-time CSS classes.
- Chat-layout modules may require a small CSS adjustment if they replace the
  standard direct message header/body structure. When no header is found,
  Nelflow leaves the native card expanded.
- Manually applying damage while auto-application is disabled is not tracked as
  an automatic application and remains `Not Applied`.
- A deleted native message cannot be reopened, but its stack row and canonical
  attack transaction remain safe.
- Reloading the authoring browser while a client-side resolution promise is
  still in flight leaves the persisted row at its last durable state. Nelflow
  does not replay that transaction, because replay could reroll or reapply
  damage; use the preserved native PF2e controls where appropriate.
- Undo still restores only guarded HP and temporary HP. Slice 2 does not add
  effect, shield, condition, reaction, or defeated-state reversal.
- Foundry runtime acceptance, including cross-module testing, must follow
  `SLICE_002_TEST_PLAN.md`; static validation is not runtime acceptance.
