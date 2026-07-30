# Slice 001 API Findings

## Inspection scope

Inspection was performed on July 30, 2026.

The locally installed software was discovered rather than assumed:

- PF2e system path:
  `C:\Users\nelth\AppData\Local\FoundryVTT\Data\systems\pf2e`
- Local PF2e version: 6.2.0, compatible with Foundry 12.327–12.330
- Foundry application path:
  `C:\Program Files\Foundry Virtual Tabletop\resources\app`
- Local Foundry version: 12.330.0

The local PF2e installation is a production bundle (`pf2e.mjs`) without its
TypeScript source and is not compatible with the target Foundry generation.
It was used only as historical corroboration.

The target integration was inspected from the official PF2e `v14-dev` branch:

- PF2e version: 8.3.0
- Foundry compatibility: minimum 14.361, verified 14.364, maximum 14
- Git commit: `fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525`
- Temporary inspection checkout:
  `C:\Users\nelth\AppData\Local\Temp\nelflow-pf2e-v14-source`
- Upstream: <https://github.com/foundryvtt/pf2e/tree/v14-dev>

Foundry v14 hooks and document behavior were checked against the official API:

- `renderChatMessageHTML`:
  <https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html>
- generic document hooks, including `preCreateChatMessage` and
  `createChatMessage`:
  <https://foundryvtt.com/api/v14/modules/hookEvents.html>
- `ChatMessage` document methods, including `setFlag`, `update`, `isAuthor`,
  and `renderHTML`:
  <https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html>

No Foundry, PF2e, world, actor, item, or unrelated module source was modified.

## Strike attack message representation

Exact PF2e source files inspected:

- `src/module/actor/helpers.ts`
  - `createStrikeFromMeleeItem`
  - `createDamageRollFunctions`
- `src/module/system/check/check.ts`
  - `Check.roll`
- `src/module/system/check/roll.ts`
  - `CheckRoll`
- `src/module/chat-message/data.ts`
  - `CheckContextChatFlag`
- `src/module/chat-message/document.ts`
  - `ChatMessagePF2e#_attack`
  - `ChatMessagePF2e#item`
  - `ChatMessagePF2e#target`

For a Strike, PF2e builds a check context with:

- `type: "attack-roll"`
- `action: "strike"`
- a stable identifier in the form
  `<item id>.<attack slug>.<melee-or-ranged>`
- `damaging: true`
- origin actor, token, statistic, and item
- target actor and token
- MAP increases

`Check.roll` computes the final degree of success after PF2e adjustments. It
stores the numeric result in `roll.options.degreeOfSuccess` and the string
result in `flags.pf2e.context.outcome`. The context flag also records origin
and target actor/token UUIDs. Nelflow requires the numeric and string forms to
agree when both are present.

`ChatMessagePF2e#_attack` resolves the prepared attack from the roll identifier
and the source actor's prepared `system.actions`. Nelflow additionally requires:

- `message._attack.type === "strike"`
- a PF2e attack roll whose `action` is `strike` and `damaging` is true
- an NPC source actor
- matching context origin, message origin item, and prepared Strike item

This prevents arbitrary attack-trait checks and spell attacks from being
treated as Strikes.

## Native normal and critical damage

Exact files inspected:

- `src/module/actor/data/base.ts`
  - `BasicAttackAction.damage`
  - `BasicAttackAction.critical`
- `src/module/actor/helpers.ts`
  - `createDamageRollFunctions`
- `src/module/system/rolls.ts`
  - `DamageRollParams`
- `src/module/chat-message/listeners/cards.ts`
  - native `strike-damage` button handling
- `src/module/system/damage/damage.ts`
  - `DamagePF2e.roll`

PF2e assigns two native functions to a prepared Strike:

- `strike.damage(...)` builds a damage context with outcome `success`
- `strike.critical(...)` builds a damage context with outcome
  `criticalSuccess`

The PF2e chat-card listener makes the same selection from the damage button's
outcome. Nelflow selects `damage` for final success and `critical` for final
critical success. It passes the recorded target, original check context, and
recorded MAP increases.

The native function returns a rolled `DamageRoll`, while `DamagePF2e.roll`
creates the chat message internally and does not return that message. Nelflow
therefore registers a scoped `preCreateChatMessage` capture before invoking the
native function. It accepts only a PF2e `damage-roll` message with matching
source actor, source item, and recorded target. The pending message receives a
small Nelflow transaction marker through `updateSource`. After the awaited
native call completes, the exact marked message is available—no timeout,
"latest message" query, DOM click, or HTML parsing is used.

## Native damage application

Exact files inspected:

- `src/module/chat-message/helpers.ts`
  - `applyDamageFromMessage`
- `src/module/rules/helpers.ts`
  - `extractEphemeralEffects`
- `src/module/actor/base.ts`
  - `ActorPF2e#applyDamage`
  - `ActorPF2e#calculateHealthDelta`
  - native damage-taken message and applied-damage flag creation
- `src/module/system/damage/iwr.ts`
  - `applyIWR`
- `src/module/system/damage/roll.ts`
  - `DamageRoll`

PF2e's chat damage control:

1. takes the `DamageRoll` from the damage message;
2. carries forward origin and target roll options;
3. adds ally/enemy and target self roll options;
4. extracts target-affecting ephemeral effects for `damage-received`;
5. creates a contextual clone of the recorded target actor; and
6. calls the clone's native `applyDamage` with the roll, token, item, roll
   options, Shield Block request, and outcome.

The helper itself is an internal module function and is not exposed on
`game.pf2e`. Nelflow's version-sensitive adapter reproduces those orchestration
steps and then delegates all damage computation and mutation to
`ActorPF2e#applyDamage`.

`ActorPF2e#applyDamage` calls PF2e's `applyIWR`, calculates HP and temporary-HP
updates, processes hardness, persistent damage, native damage-taken messaging,
and relevant rule-element behavior. Nelflow does not calculate a damage total,
parse chat HTML, or directly subtract damage from HP.

Slice 1 deliberately passes `shieldBlockRequest: false`; reactions are outside
scope and Nelflow does not infer that Shield Block was declared.

## Foundry v14 lifecycle and flags

Nelflow uses:

- `init` to register settings;
- `ready` to check the active system/runtime and attach runtime hooks;
- `createChatMessage` to observe completed attack messages;
- `preCreateChatMessage` only on the initiating client to mark exact native
  damage and damage-taken messages before creation; and
- `renderChatMessageHTML(message, html)` to append compact status UI to the
  pending `HTMLElement`.

The canonical transaction is stored under
`flags.nelflow.transaction` on the attack message. Compact markers link the
native damage and damage-taken messages to that attack. Foundry's `setFlag`
persists each state transition.

## Runtime fail-closed checks

Automation is inactive unless the active system is PF2e and Foundry's release
generation is 14. Each eligible message must also expose all inspected
capabilities:

- final, consistent degree of success;
- prepared NPC Strike identity;
- matching origin item and actor;
- recorded target actor and token;
- native Strike `damage` or `critical` function;
- a uniquely captured native damage message;
- a PF2e DamageRoll;
- target contextual-clone APIs; and
- native `applyDamage`.

Any missing or contradictory capability stops the transaction. There is no
unsafe fallback.

## Items that still require Foundry runtime verification

Static source inspection cannot prove runtime behavior. The following must be
tested in a disposable Foundry 14 / PF2e 8.x world:

- exact message correlation in a live socket session;
- IWR, temporary HP, persistent damage, and token-actor update behavior;
- two connected GM clients;
- refresh/reload idempotency;
- compatibility with other chat hooks; and
- guarded Undo rendering and updates.
