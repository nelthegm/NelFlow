# Slice 002.1: Native Card Compaction and Stack Polish

## Pre-implementation presentation lifecycle

This baseline was recorded before Slice 2.1 implementation against commit
`e2540367937e99423b30898e7249b7b7c00c7ac1`.

1. PF2e creates and stores the native attack ChatMessage without Nelflow
   rewriting its content, rolls, PF2e flags, or controls.
2. Slice 1 claims that attack message at `flags.nelflow.transaction`. The full
   canonical transaction remains on the attack message.
3. Before PF2e creates a native damage or damage-taken message, the initiating
   client's scoped `preCreateChatMessage` capture checks PF2e's structured
   context, origin item/source actor, and recorded target. A matching message
   receives a compact Nelflow marker identifying the exact transaction, attack
   message, and role.
4. Slice 1 persists the exact linked damage and application message IDs on the
   canonical transaction. No mechanical step depends on presentation
   rendering.
5. Slice 2 projects the canonical transaction into a durable row within
   `flags.nelflow.stack`. The stack retains native attack, damage, and
   application message references.
6. `renderChatMessageHTML` distinguishes a stack message from a linked native
   message by Nelflow flags. A stack is rebuilt from its persistent flag.
7. When compact stacks and **Collapse Linked Native Cards** are enabled, every
   linked native message with the standard direct Foundry message header gets
   Nelflow CSS classes and one Show Details button. All direct children other
   than the header are hidden in the collapsed state.
8. Expansion removes only the collapse class from that rendered message. The
   original native DOM remains in place, so its PF2e and companion-module
   listeners remain attached. Expansion is local to one rendered card and
   intentionally resets to collapsed after rerender or reload.
9. If the standard direct message header is unavailable, the renderer returns
   without hiding anything. Unrelated messages without a structured Nelflow
   transaction marker are never compacted.
10. The Slice 2 stack currently repeats the actor name and portrait already
    shown by Foundry's outer speaker header. Each Strike row uses a dedicated
    Details line below its two-line result summary, while Undo occupies a
    separate control column.

Slice 2.1 changes only this render-time presentation. Mechanical authority
remains `flags.nelflow.transaction`, and stack presentation authority remains
`flags.nelflow.stack`.

## Purpose

Slice 2.1 reduces chat height without merging, deleting, replacing, or
rewriting native PF2e messages. It adds role-specific summaries for safely
linked attack, damage, and application messages and moves the stack's closed
Details and Undo controls into the result line.

## Shared compaction service

`NativeCardCompactor` owns linked-message identification, summary generation,
DOM compaction, expansion, and stack-to-native navigation. The main render hook
remains synchronous and delegates native presentation to this service.

Before rendering any summary, the service:

1. requires a Nelflow transaction marker whose role is `attack`, `damage`, or
   `application`;
2. resolves that marker to the canonical attack transaction;
3. verifies the rendered message ID equals the corresponding canonical
   `attackMessageId`, `damageMessageId`, or `applicationMessageId`;
4. requires Foundry's `visible` and `isContentVisible` accessors to permit the
   current viewer to see the message content; and
5. requires standard direct `.message-header` and `.message-content` children.

An unrelated, stale, ambiguously linked, content-hidden, or structurally
unfamiliar message is left unchanged.

## Native attack-card handling

Linked attack cards retain the Slice 2 default-collapsed behavior. The compact
line shows the persisted Strike name and finalized PF2e outcome. Show Details
reveals the original attack body in place. No native attack buttons, rolls,
flags, or listener-bearing elements are cloned or replaced.

A card manually expanded by the user is a valid independent UI state. It
remains expanded until that rendered card is hidden again or Foundry rerenders
it. Rerender and browser reload intentionally restore the configured collapsed
default.

## Native damage-card handling

The compact damage line uses the canonical transaction's structured
`damageSummary`. For backward-compatible records without that optional field,
the service may call the existing `PF2eAdapter.summarizeDamageRoll` on the
message's evaluated DamageRoll instances.

The summary includes the Strike name, evaluated total, and concise component
types when available. It never reads the rendered formula, parses chat-card
HTML, rebuilds an item formula, or changes the message's rolls. Expanding the
card reveals the same native PF2e roll DOM, including Damage, Half, Double,
Triple, Block, companion-module controls, tooltips, and roll interaction.

## Application-message linkage

PF2e 8.3.0's `ActorPF2e#applyDamage` awaits creation of a `damage-taken`
ChatMessage but returns the actor, not the created message. During that exact
awaited native call, Nelflow's existing lifecycle capture now collects
`createChatMessage` candidates. A candidate application must match structured
PF2e data:

- context type `damage-taken`;
- exact origin item and source actor;
- exact target speaker token;
- exact `appliedDamage.uuid` target actor; and
- `appliedDamage.isHealing === false`.

When the awaited call finishes, the capture returns a message only if its
candidate set contains exactly one document. Multiple concurrent or manual
matches leave every candidate unlinked rather than choosing by text, actor
name, timestamp, or collection order. Unlike the Slice 1 damage-message
capture, no application marker is written at pre-create time. Application
linkage is presentation-only and is not required for damage application to
complete.

After a unique capture, Slice 2's existing `TransactionStore.linkMessage`
persists `applicationMessageId` on the canonical transaction and writes the
exact transaction marker on the native application message. The compact audit
line uses the canonical recorded target and applied HP/temp-HP delta. The full
PF2e content, applied-damage flag, and native revert control remain available
after expansion.

Healing, zero-effect messages without a structured applied-damage flag,
ambiguous concurrent applications, and messages whose origin/target identity
cannot be proven remain fully native and expanded.

## Transaction and stack schema

Slice 2.1 adds no persistent transaction or stack fields and performs no
migration. Existing optional `damageSummary`, `applicationMessageId`, and row
references are sufficient. Therefore:

- `flags.nelflow.transaction` remains the canonical mechanical record;
- `flags.nelflow.stack` schema version remains 1 and remains presentation-only;
- old transactions without optional presentation fields fail open; and
- previous messages are not rewritten merely for compaction.

## Render-time-only behavior and controls

The service inserts one summary element into the pending
`renderChatMessageHTML` HTMLElement and marks only the direct native
`.message-content` child as visual detail. CSS hides that child while
collapsed. The original element stays in the DOM, preserving listeners and
module-added controls.

Each newly rendered summary receives one localized native button listener.
Repeated calls against the same HTMLElement detect the existing summary and do
not register a second listener. Show Details and Hide Details modify only the
owning message's class and accessible `aria-expanded` state. Stack message
references use the same service to reveal and scroll to one exact native
message.

## Stack polish

Foundry's outer speaker header continues to identify the actor. The inner stack
header now shows only `Round N` during combat or `Outside Combat` for a
standalone result, removing the repeated portrait and actor name.

Rows retain their icon, Strike, MAP, target, outcome, damage, application
state, Details, and Undo. Closed Details and guarded Undo now participate in
the wrapped result line. Opening Details may use a full row for exact attack,
damage, and application message references.

## Visibility protection

Foundry's message visibility and content-visibility decisions are checked
before any summary is produced. Whisper and blind fields are never changed.
For application summaries, non-GM viewers receive the persisted target name
only when PF2e's token-name visibility permits it; otherwise the localized
neutral label `Target` is used.

The service never copies data from a hidden card into another message and does
not change ownership, author, speaker, timestamp, roll mode, or recipients.

## Compatibility and fallback

- No PF2e method or renderer is monkey-patched.
- Dice So Nice roll creation and animation occur before presentation and are
  untouched.
- PF2e Workbench, Toolbelt, and other controls remain in the original content
  subtree and become visible on expansion.
- A changed chat DOM that lacks the standard direct header/content pair is
  left fully visible.
- Presentation exceptions restore the full card and emit one debug-only,
  namespaced diagnostic per message/reason.
- Rendering is synchronous, and no presentation promise can reject
  asynchronously.
- Disabling **Collapse Linked Native Cards** adds no summary or collapse class;
  after rerender, all native cards use their normal PF2e layout while the stack
  remains active.

Verified Foundry V14 API documentation:

- `renderChatMessageHTML`:
  <https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html>
- `ChatMessage.visible` and `ChatMessage.isContentVisible`:
  <https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html>

PF2e source was checked at the existing 8.3.0 baseline in
`src/module/actor/base.ts`, `src/module/chat-message/data.ts`, and
`src/module/chat-message/listeners/damage-taken.ts`.

## Known limitations

- Native PF2e application-card revert does not update Nelflow's canonical
  transaction or stack row. Slice 2.1 preserves that native control but does
  not intercept or reconcile its separate state.
- An application with no non-healing `appliedDamage` flag, or an ambiguous
  concurrent match, is intentionally not compacted.
- Manual application is outside transaction tracking. A structurally
  indistinguishable manual application during the same exact pending source,
  item, and target operation cannot be given an independent public API
  correlation token; testing must confirm the practical fail-open behavior.
- Chat modules that keep standard header/content classes but substantially
  alter semantics may need a compatibility adjustment. Removing either direct
  class causes Nelflow to fail open.
- Expanded/collapsed state is local presentation state and does not persist
  across rerender or reload.
- Foundry runtime acceptance remains required; static validation is not runtime
  testing.
