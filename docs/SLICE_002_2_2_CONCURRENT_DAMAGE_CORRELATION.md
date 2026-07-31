# Slice 002.2.2: Concurrent Damage Correlation

## Observed defect

Rapid NPC Strikes could overlap while PF2e was creating their native damage
messages. One critical-hit transaction then failed with "PF2e created no
identifiable damage message" even though its native critical-damage card was
visible. The affected row failed safely and no unproven damage was applied.

Baseline commit:
`b0413f25871ddda650dd0c40308a8b9ea6ea1f17`.

## Root cause

The old adapter kept one capture object per transaction, but
`preCreateChatMessage` filtered every active capture by actor UUID, item UUID,
target token UUID, and message type, then selected `matches[0]`.

Those fields describe the damage context, not the invocation. Two concurrent
uses of the same Strike against the same target therefore produced identical
criteria. The first active scope could mark a later scope's message, leaving
the other scope without an identifiable message. Adding outcome matching alone
would not distinguish concurrent normal hits or concurrent critical hits.

## Native API findings

PF2e 8.3.0 `v14-dev` source at commit
`fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525` confirms:

- `strike.damage` and `strike.critical` resolve to a rolled `DamageRoll`, a
  formula string only in formula mode, or `null`; they do not return the
  created ChatMessage.
- `DamageRollParams.options` is an official `string[] | Set<string>` parameter.
- `createDamageRollFunctions` includes those options when resolving the exact
  damage context.
- `DamagePF2e.roll` stores the sorted options in
  `flags.pf2e.context.options`.
- PF2e awaits `ChatMessagePF2e.create` before returning the `DamageRoll`.
- The message also stores structured origin actor/item, target actor/token,
  outcome, source type, and native DamageRoll data.

Inspected source and Foundry documentation:

- <https://github.com/foundryvtt/pf2e/blob/fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525/src/module/actor/helpers.ts>
- <https://github.com/foundryvtt/pf2e/blob/fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525/src/module/system/damage/damage.ts>
- <https://github.com/foundryvtt/pf2e/blob/fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525/src/module/system/rolls.ts>
- <https://foundryvtt.com/api/v14/modules/hookEvents.html>
- <https://foundryvtt.com/api/functions/hookEvents.preCreateDocument.html>
- <https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html>

Foundry permits custom document-operation options, but PF2e's native Strike
damage API does not expose its internal ChatMessage creation operation.
Nelflow therefore does not invent or monkey-patch a creation option.

## Correlation strategy

The strategy priority is:

1. Accept a directly returned ChatMessage if a future compatible native API
   provides one and it passes the complete structured validation.
2. For PF2e 8.3.0, pass one namespaced correlation roll option through the
   supported `DamageRollParams.options` parameter.
3. Observe the exact created document with one permanent central
   `createChatMessage` dispatcher while that transaction scope is active.
4. Fail safely if the scoped result is missing, invalid, conflicting, or
   ambiguous.

The option has this presentation-only correlation shape:

`nelflow:damage-correlation:<client-sequence>:<transaction-id>`

It does not alter the formula, degree of success, target, MAP, critical rule,
message mode, or native message creation. PF2e persists it in structured
context flags; it is never inserted into chat content or flavor.

No timing, name, prose, "latest message," or global queue participates in
proof.

## Scoped capture architecture

`DamageCaptureRegistry` maintains two small indexes:

- exact transaction ID to active scope;
- exact namespaced roll option to active scope.

Each scope records transaction and attack-message IDs, source actor/token and
item UUIDs, Strike identifier, target actor/token UUIDs, expected outcome,
processing user, monotonic client sequence, start state, capture state,
candidates, and rejections.

The dispatcher extracts the exact correlation option from a newly created
damage message and resolves its scope in constant time. Unrelated manual,
Workbench, application, historical, and rendered messages have no active
option and are ignored.

The scope is removed immediately after the awaited native call completes or
rejects. There is no per-transaction hook, timeout, interval, retry, global
serialization, or DOM dependency.

## Damage-message claim registry

`DamageMessageClaimRegistry` is a session-local atomic first-claim cache keyed
by exact damage message ID. A different transaction cannot claim an occupied
ID.

Before accepting a new claim it also consults persisted Nelflow attack and
damage flags. At startup, existing exact links rebuild lightweight terminal
claims. A successful live transaction marks its claim persistent immediately
after the attack transaction stores `damageMessageId`, before application.

An unpersisted failed claim can be released. A persisted claim cannot be
released through that cleanup path. Message deletion removes the in-memory
entry; remaining persisted transaction flags are still consulted if the ID is
encountered again. No ChatMessage documents are retained in the claim cache.

## Strict candidate validation

A candidate must satisfy every available structured check:

- exact active correlation option;
- Foundry ChatMessage document;
- processing GM authorship and current visibility;
- PF2e `damage-roll` context;
- native DamageRoll with instances;
- exact source actor UUID;
- exact source item UUID;
- exact target actor and token UUIDs;
- source token UUID when PF2e exposes it;
- exact success versus critical-success outcome;
- consistent numeric degree of success when present;
- no conflicting Nelflow transaction marker; and
- no existing claim by another transaction.

The persisted Strike identifier remains diagnostic scope data. PF2e's damage
message exposes the exact origin item rather than the attack identifier, so
item UUID is the immutable action identity used for validation.

Immediately before automatic application, Nelflow revalidates processing-GM
authority, attack transaction identity and state, exact stored damage-message
ID, claim ownership, native roll/context, source item/actor, finalized outcome,
and snapshotted target. Application cannot begin before this guard passes.

## Concurrency behavior

Every invocation receives a unique supported roll option, so identical actor,
Strike, target, and outcome combinations remain independently identifiable.
Completion order is irrelevant. Different NPCs and out-of-combat transactions
remain concurrent; Nelflow adds no world, GM, actor, or signature queue.

A manually created card lacks Nelflow's option and is ignored. If another
component copies the exact invocation option and creates two otherwise valid
messages, the scope fails ambiguous rather than choosing either.

## Manual fallback and error states

Structured internal reasons include:

- `damage-message-missing`;
- `damage-message-ambiguous`;
- `damage-message-already-claimed`;
- `damage-message-context-mismatch`;
- `damage-message-invalid-roll`;
- `native-damage-call-failed`; and
- `transaction-no-longer-eligible`.

When the native call returned a DamageRoll but exact message ownership could
not be proven, the transaction becomes a terminal manual fallback:

`Damage rolled · Manual application required`

The safe structured roll summary may remain visible. No candidate is linked or
applied, Nelflow Undo is unavailable, and all unlinked native damage cards
remain fully visible with PF2e controls. A native call that did not return a
DamageRoll remains a normal Error.

## Persistent schema

The authoritative transaction adds optional presentation/diagnostic fields:

- `damageCorrelation`: schema version, client sequence, strategy, state,
  reason, candidate count, correlation option, and elapsed time;
- `manualApplicationRequired`: Boolean.

The existing `damageMessageId` remains the persistent mechanical link. Stack
schema remains version 2; rows project the two optional fields. Old
transactions and rows without them retain their previous behavior.

## Authority and reload

Only the existing attack-authoring `processingUserId` GM creates a scope,
invokes native damage, claims a message, persists the transaction, or applies
damage. Other clients receive created documents but have no corresponding
active option scope and cannot compete.

Reload rebuilds claims from persisted exact links but does not resume a
processing transaction, search historical damage, reroll, relink, or apply.
Old failed/manual transactions remain terminal. Slice 2.2.1 stack
rehydration remains read-only.

If the processing GM disconnects in flight, another GM does not inherit the
scope. The last persisted row remains and the native controls are the safe
recovery path.

## Workbench and Dice So Nice

PF2e Workbench exposes an "Autoroll damage on hits" feature. Nelflow does not
disable it and does not add any second invocation beyond its existing one.
Workbench-created damage without Nelflow's exact option cannot be claimed by
Nelflow. If an integration duplicates the exact tagged context, ambiguity
fails safe.

For predictable NPC automation, disable Workbench damage autoroll for users
whose NPC Strikes Nelflow processes. Other Workbench features can remain
enabled. This recommendation avoids two modules intentionally rolling damage
for the same attack.

Dice So Nice operates after roll/document creation. Correlation uses the
created ChatMessage document and does not wait for visible rendering or dice
animation.

Workbench feature reference:
<https://foundryvtt.com/packages/xdy-pf2e-workbench>.

## Diagnostics

Debug mode emits concise namespaced events:

- `damage-correlation-started`;
- `native-damage-returned`;
- `candidate-observed`;
- `candidate-rejected`;
- `candidate-claimed`;
- `candidate-conflict`;
- `correlation-complete`;
- `correlation-ambiguous`;
- `correlation-missing`;
- `native-damage-call-failed`; and
- `manual-fallback`.

Events contain shortened transaction ID, attack/candidate message IDs,
strategy, rejection reason, source actor UUID, and elapsed milliseconds. They
do not log message content, flavor, actor documents, or formulas.

## `setProperty` / `preUpdateActor` investigation

The complete Nelflow repository contains no `setProperty(` call and registers
no `preUpdateActor` hook. Nelflow's only actor update is guarded Undo using
`actor.update` with explicit HP/temp-HP paths. The observed unqualified
`setProperty is not defined` error therefore does not originate in this
baseline Nelflow source.

To identify the owner in a disposable world, reproduce with Nelflow as the only
enabled module, then enable other modules individually. With debug tools, inspect
registered `preUpdateActor` callbacks and their source URLs/stack trace. This
slice does not alter unrelated actor-update behavior.

## Known limitations

- A third party that intentionally copies Nelflow's exact correlation option
  can force safe ambiguity.
- A refresh during an in-flight native call does not transfer or resume its
  ephemeral scope.
- Manual PF2e application after a fallback is not tracked as a Nelflow
  application and has no Nelflow Undo.
- Workbench damage autoroll overlaps Nelflow's purpose and should be disabled
  for the same NPC-rolling users.
- Foundry runtime acceptance still requires the companion test plan.
