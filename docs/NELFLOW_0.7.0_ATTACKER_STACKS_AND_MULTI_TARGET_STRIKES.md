# Nelflow 0.7.0 architecture

## Baseline restriction and correction

In 0.6.5, `turn-stack-service.js/currentCombatFor` required the active
combatant's actor or token to equal `transaction.snapshot.sourceActorUuid` or
`sourceTokenUuid`. A real NPC attack made during another combatant's turn was
therefore treated as an outside-combat standalone result.

0.7.0 instead requires an explicit source token UUID and verifies that exact
token has a combatant in the active combat. The active combatant defines the
turn window only; it is never substituted for the attacker. Missing or
ambiguous source tokens remain standalone and cannot enter another token's
stack.

## Attacker-scoped stack identity

Combat stacks persist this identity:

- combat ID and round;
- active combatant ID and turn index, or a deterministic no-active-turn value;
- durable turn-marker ID;
- explicit attacking token UUID and its combatant ID;
- authoring/processing GM ID;
- blind/whisper visibility partition.

The attacking token UUID is part of the hashed ChatMessage ID. Two unlinked or
linked tokens for one actor cannot collide. `outOfTurn` is true only when the
explicit attacker combatant differs from the active combatant. It controls the
localized label and does not classify the action as a Reaction.

Rows remain ordered by native attack-message creation time with attack-message
ID as the stable tie-breaker. Stack creation occurs at transaction claim,
before native damage completion, so asynchronous damage groups do not reorder
rows.

## Capture and activation

An author-client capture-phase click listener copies `game.user.targets` when
a native Strike control is activated. `preCreateChatMessage` stores a
namespaced capture flag on the outgoing attack message. Macro/non-DOM Strikes
use the same pre-create hook as a safe fallback. Targets are deduplicated by
token UUID and retain their capture order.

The world setting accepts `off`, `npc-strikes`, and
`player-and-npc-strikes`; its default is `player-and-npc-strikes`. Fewer than
two captured targets never enter the batch service, leaving 0.6.5 singular or
untargeted behavior unchanged. Setting changes never rewrite an existing
transaction.

The elected GM validates the message author, structured PF2e Strike identity,
source actor/token/item, primary target, every captured token/actor/scene
tuple, and setting policy. Other clients may render flags but cannot claim or
mutate the batch. No socket payload supplies target or HP data.

## Shared attack and target resolution

The PF2e attack message is the one shared attack. Nelflow never calls the
Strike attack method again and never advances MAP per target. The stored roll
total and d20 result are compared with each target's prepared AC. The primary
target retains PF2e's finalized native outcome. Secondary targets use PF2e's
public statistic roll-option preparation and the PF2e 8.3 degree ordering:
10-over/under, natural 20/1, then predicate-filtered degree adjustments.

Target self roll options contribute condition and defense predicates.
Concealed and hidden targets receive independent native PF2e flat checks (DC 5
and DC 11) without another Strike roll. A failed check suppresses damage only
for that child. If a required public API or structured defense is unavailable,
that child becomes Review rather than guessing.

## Persistent batch flags

The attack ChatMessage owns `flags.nelflow.transaction` with type
`multi-target-strike`:

- immutable snapshot: source actor/token/item, Strike identifier, message,
  creation order, shared total/d20, MAP, author, processing GM and target set;
- parent state, revision, active operation and stack reference;
- `damageGroups.normal` and `damageGroups.critical`, each with exact native
  damage message and structured summary;
- ordered target children with exact token/actor/scene, AC, outcome, optional
  flat check, group, linked messages, pre/post HP and temp HP, applied delta,
  state, Review reason and Undo state;
- exact linked-message ID list.

Native damage and application messages receive compact markers containing the
parent attack message and exact group or child key. They do not become the
mechanical authority.

## Native damage and independent application

No successful children means no damage call. All normal hits share one call to
the prepared Strike's native `damage`; all critical hits share one call to
native `critical`. Mixed batches therefore produce at most one native roll of
each category. This preserves fatal, deadly, critical-only dice and other
native critical evaluation.

The unchanged contextual application adapter is called once per eligible
child with the existing native DamageRoll, multiplier 1, exact source item,
and exact target token. PF2e `getContextualClone` and `Actor#applyDamage` run
with `skipIWR: false`. Resistances, weaknesses, immunities, temp HP, materials,
traits, vitality/void, persistent instances and the native application record
are evaluated separately; adjusted HP deltas are never shared.

A missing target, missing health state, ambiguous native message, or
unverified application changes only that child to Review. Completed siblings
are not repeated or cancelled. On reload, a previous-session resolving or
applying child becomes Review. Terminal batches are not rerolled or reapplied.

## Presentation, privacy and native records

NPC batches project to one action row in the attacker's existing durable stack
with ordered child rows. Character batches select one deterministic
viewer-visible native host and add one summary. Linked cards remain intact and
are compacted only in the rendered DOM when configured.

Native Records is assembled only from exact persisted IDs whose marker,
canonical parent, group/child reference and current viewer visibility all
match. Blind, whisper and hidden-name rules are checked per viewer. Stored
fallback stack HTML uses neutral target labels unless its entire audience is
GM-only. Ordinary presentation never includes transaction identifiers,
UUIDs, raw flags, formulas, authority evidence or diagnostic payloads.

## Undo and recovery

Per-target Undo and Undo All both call the existing
`guardedHealthRestore`. The exact actor/token must resolve and current HP/temp
HP must equal that child's post-application snapshot before its pre-state is
restored. Undo All iterates currently legal children and records each outcome;
stale children become Undo Blocked while safe siblings are undone. Neither
operation rerolls or changes sibling damage.

## Compatibility and limitations

- Foundry 14 and the existing PF2e compatibility declaration are unchanged.
- Workbench, Toolbelt, Dice So Nice, basic saves, NPC abilities and singular
  Strike flows retain their existing hooks and transaction types.
- PF2e does not expose its internal full `CheckContext` builder as a public
  API. Secondary-target defense predicates available through public Statistic
  roll options are honored; a defense requiring unavailable internal geometry
  or ephemeral context is handled conservatively as Review when it cannot be
  established safely. Runtime acceptance must specifically exercise cover,
  off-guard, concealment, hidden, fatal/deadly, IWR and companion modules.
- No Foundry/Forge runtime acceptance is claimed by this development task.
