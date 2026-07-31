# Slice 3.3: Deterministic Basic-Save Damage Autoroll

## Purpose

Slice 3.3 removes the extra Roll Damage click only when Nelflow can prove one
exact, safe PF2e damage action for a live Toolbelt basic-save source. It does
not change save rolling, outcomes, HP application, application timing, guarded
Undo, or Toolbelt target controls. The resulting native damage ChatMessage is
processed by the existing Slice 3.1/3.2 pipeline exactly like a manual roll.

The safety rule is fail open: uncertainty leaves PF2e's normal source control
available and never causes an automatic retry.

## Inspected baselines and native APIs

The implementation was checked against PF2e 8.3.0 source commit
`fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525` and PF2e Toolbelt 3.52.0/3.52.1.
The relevant PF2e implementation points are:

- `ChatMessagePF2e#item`: reconstructs the source spell from structured
  `flags.pf2e.origin`, including cast rank, overlay IDs, and casting entry.
- `SpellPF2e#getOriginData`: persists cast rank and applied overlay IDs.
- `SpellPF2e#toMessage`: persists the `spell-cast` context and message mode.
- `SpellPF2e#getDamage({skipDialog, messageMode})`: performs PF2e's own
  structured damage preparation. Nelflow uses it only to prove that a single
  native DamageRoll exists and never reads or reconstructs its formula.
- `SpellPF2e#rollDamage(event)`: the stable native invocation used by the spell
  chat control. It calls PF2e's `DamagePF2e.roll`, which creates the native
  DamageRoll and ChatMessage.
- `eventToRollParams`: derives dialog and GM/blind visibility behavior from the
  event and the rolling user's PF2e preferences.
- `AbilityItemPF2e`: exposes no `rollDamage` or equivalent item method in PF2e
  8.3.0. NPC action damage is an enhanced inline `@Damage` anchor handled by
  PF2e's TextEditor listener and internal augmentation function.

Toolbelt's source/damage flags and Target Helper public API were inspected in
both supported versions. `getMessageTargets` and `setMessageFlagTargets` are
the documented public target methods. Nelflow uses `setMessageFlagTargets` on
the pending native message source so the exact source targets reach the damage
card; it does not write save results or imitate Toolbelt application state.

## Supported source structures

The automatic path currently supports a direct `SpellPF2e` source card when
all of these facts are structured and exact:

- Basic Save Workflow is Toolbelt Target Helper and the configured source mode
  permits spells.
- The card was observed by this client's live `createChatMessage` hook.
- The exact active author is this client and owns/can update the exact actor and
  reconstructed spell.
- Toolbelt 3.52.0 or 3.52.1 is active, Target Helper is enabled, and its source
  flag contains one explicit basic Fortitude, Reflex, or Will save.
- PF2e origin actor/item, `spell-cast` context, cast rank, overlay list, source
  author, and Toolbelt source identity agree.
- At least one exact Toolbelt target token and actor can be resolved.
- The spell is not an attack; PF2e prepares exactly one ordinary native damage
  roll at roll index zero; it is not healing, persistent, or splash-only.
- No unresolved overlay exists and no damage dialog or choice is required.
- The source visibility mode can be reproduced exactly by the native API.

Heightened spells are invoked through the exact reconstructed message item, so
`item.rank` equals the persisted origin cast rank. Applied overlays must be
present in the origin and the reconstructed item must already be the matching
variant. Nelflow never guesses either value.

## NPC ability API finding

PF2e 8.3.0 has no native invocation method on `AbilityItemPF2e`. Its source
card exposes damage only through rendered enhanced inline links. Invoking that
path would require a DOM click, direct listener call, rendered-card parsing, or
formula reconstruction, all explicitly prohibited by this slice. Therefore
NPC basic-save actions return
`ability-native-damage-api-unavailable` and stay manual. Once the user rolls
their native damage, Slice 3.2 still applies, records, guards, and undoes it as
before. This limitation is preferable to a private or duplicate roll path.

Consumable-embedded spells, hazards, player non-spell abilities, Strikes,
attack-plus-save effects, recovery/healing, unresolved ranks/variants,
multiple or selectable damage modes, persistent/splash-only damage, sources
without exact Toolbelt targets, and any unknown PF2e structure are also manual.

## Version-sensitive adapter

`native-damage-action-adapter.js` owns the PF2e-sensitive inspection and
invocation boundary. It receives only the normalized Toolbelt source, returns
an eligibility fingerprint and exact invocation fields, and calls
`SpellPF2e#rollDamage`. Downstream code does not independently infer action,
rank, overlay, target, roll index, or visibility. Unknown data produces a
concise ineligible reason.

`toolbelt-target-helper-adapter.js` is the sole raw Toolbelt flag reader. It
normalizes source and generated damage messages, exact target identities,
basic-save variant, source documents, rank/overlays, roll index, and stable
fingerprints without using message content or rendered HTML.

## Persistent transaction

The exact source ChatMessage stores `flags.nelflow.autoDamageRoll` with schema
version 1. Important fields are:

- `integrationId`, derived from the exact source message ID and a persisted
  random nonce;
- exact source message, actor, item, kind, author, and rolling user;
- safe actor/item types plus source and target fingerprints;
- exact target token UUIDs used only for Toolbelt handoff;
- damage action ID, roll index, cast rank, overlay IDs, and action variant;
- adapter version, eligibility fingerprint, roll mode, state, revision, and
  lifecycle times;
- generated/candidate damage message IDs, failure reason, source-control guard,
  and persistent manual-roll override.

States are Observed, Awaiting Toolbelt Targets, Eligible, Claimed, Rolling,
Completed, External Roll Detected, Ambiguous, Manual, Interrupted, and Error.
Completed, External, Ambiguous, Manual, Interrupted, and Error are terminal and
never automatically invoke again. The compact source UI is a projection of
this record, not mechanical authority.

Generated messages receive inert
`flags.nelflow.autoDamageRollOrigin` data containing schema version,
integration ID, exact source message ID, roll index, and target fingerprint.
This marker changes no roll mechanics.

## Live session and author authority

Only IDs observed through the live creation hook can begin autoroll. An exact
later update may add Toolbelt targets to that same live source. Rendering or
scanning history cannot start work; there is no time window, polling, timeout,
or newest-message heuristic.

The source's exact active author is `rollingUserId`. That client must be logged
in as the same user and retain source permissions. Other GMs render status but
cannot invoke a player or another GM's source. There is no disconnect or reload
handoff. Existing deterministic processing-GM election remains separate and is
used only later by the Toolbelt HP-application service.

## Durable claim and native invocation

Eligibility is first persisted, then Claimed is persisted with exact rolling
user, source/target fingerprints, action, index, rank, overlays, and revision.
Before invocation, the serialized service rereads the source document,
Toolbelt targets, permissions, external-message registry, eligibility, and
durable revision. It persists Rolling before installing its one live capture
and calling `item.rollDamage(eventData)`.

Repeated create/update hooks share per-message mutation queues, one scheduled
integration set, and a client-wide invocation queue. The queue is necessary
because PF2e's public spell method does not accept arbitrary correlation data;
it keeps the short preCreate capture unambiguous without changing PF2e.

Nelflow never creates a DamageRoll or damage ChatMessage, modifies HP, rolls a
save, calculates a degree of success, calls a card listener, or clicks a DOM
control. An exception, null roll, unexpected result, or uncertain message is
terminal and is never retried.

## Generated-message correlation and Toolbelt handoff

One permanent `preCreateChatMessage` hook is registered at initialization. It
injects the inert origin marker only while an exact local Rolling capture is
active and only when author, PF2e damage/save context, actor/item origin, cast
rank, overlay IDs, native regular DamageRoll, and roll index all match. The
same preCreate update uses Toolbelt's public target method with the source's
exact token UUID list.

Completion requires exactly one matching preCreate event and one created
message. The created damage message is normalized again and must match rolling
user, source kind/actor/item, target fingerprint, rank/overlays, roll index,
native DamageRoll, and inert marker. A claim registry prevents one damage
message from satisfying two transactions. Only then is `damageMessageId`
persisted and the source marked Completed.

The ordinary central create-message dispatcher still passes the damage card to
the existing Toolbelt application service. Autoroll does not apply HP or alter
Toolbelt save outcomes/timing.

## External rolls, concurrency, and manual race

All live native Toolbelt damage messages are normalized independently. A
single structurally matching pending source becomes External Roll Detected and
cancels its automatic path. Multiple possible sources become Ambiguous; none
is selected. There is no actor/item name, formula, displayed total, timestamp,
adjacency, or newest-card matching.

Separate source message IDs, integration IDs, persistent claims, fingerprints,
and message claims isolate simultaneous players, repeat casts, and identical
items. Each author client can invoke only its own source. Dice So Nice affects
visual animation, not document-hook correlation.

Before Claimed, PF2e's native control remains usable. Once Claimed or Rolling,
the exact `data-action="spell-damage"` control for that exact source/index is
capture-phase guarded for click and keyboard activation. A manual damage card
created first cancels autoroll through external detection. Third-party modules
that use normal native structured messages can be detected without a hard
dependency; no other module's settings are changed.

## Source-card presentation and manual override

The setup-time chat renderer adds a compact localized state line only when the
source transaction exists and is visible to the viewer. It never exposes full
UUIDs, fingerprints, integration IDs, target lists, formulas, private totals,
or hidden content. A linked damage-message control appears only when that exact
message is visible.

The guard is idempotent, stores the native control's disabled/ARIA/title/
tooltip state, uses one listener pair per render root, and fails open if exact
PF2e markup is unavailable. It does not affect saves, attacks, card expansion,
Toolbelt rows, Strike cards, or per-target guards.

After Completed or External, the author or a GM can confirm **Enable Manual
Damage Roll**. This persists `manualRollEnabled`, restores the native control,
warns about duplicate cards/application, and never changes HP or transaction
state. **Guard Damage Roll** reverses only that presentation choice.

## Reload reconstruction

Initialization reads only existing Nelflow autoroll flags. Completed and
External records restore their exact damage-message claims and presentation
guards. Nonterminal records owned by this exact user become Interrupted and
do not resume. Manual, Ambiguous, Interrupted, and Error remain terminal/manual.
No historical source is placed in the live ID set, authority is not transferred,
and deleting a linked damage message never causes a reroll.

## Settings and migration

**Automatic Basic Save Damage Roll** stores `off`, `gm`, or `all`. New worlds
default to All Eligible Sources. Migration version 3 sets only this new setting
to Off once for established worlds, then stores version 3. It does not change
Basic Save Workflow, Toolbelt Basic Save Sources, application timing, or Legacy
mode.

## Diagnostics and privacy

Debug events cover source observation, targets, eligibility, claim, rolling,
correlation, completion, external/ambiguous/manual/interrupted/error outcomes,
source-control guard/restoration, and manual override/re-guard. Payloads contain
only shortened IDs, message ID, safe source/item type, roll index, rolling-user
role/short ID, and reason. Actor/item names, formulas, totals, flags, roll data,
and target lists are excluded.

## Known limitations

- PF2e 8.3.0 NPC action autoroll is unavailable without violating the native
  API/no-DOM/no-formula constraints; Slice 3.2 manual damage remains supported.
- The rolling user's PF2e Show Damage Roll Dialogs preference must be disabled.
  Choice-capable or dialog-based rolls deliberately remain manual.
- Only direct spell source cards are accepted; consumable-embedded spells are
  not invoked automatically.
- External unmarked messages are linked only when one active source matches
  structurally. Concurrent identical unmarked candidates become Ambiguous.
- Same-user simultaneous browser sessions cannot be distinguished by Foundry's
  persisted user ID; users should not operate one actor from duplicate tabs.
- Runtime acceptance still requires Foundry V14, PF2e 8.3.0, and Toolbelt
  3.52.0/3.52.1 testing. Static/mocked validation is not runtime acceptance.
