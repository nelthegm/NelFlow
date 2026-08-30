# Nelflow 0.14.15 — Stack Follow and Collapse Controls

## Scope

This is a presentation-only refinement of durable NPC Strike stacks. It does
not change Strike resolution, damage application, correlation, authority,
transaction or stack identity, Undo, PF2e/Toolbelt behavior, or any public
presentation protocol.

## Why updated stacks stayed at their creation position

One qualifying combat-turn stack is one durable `ChatMessage`. Later Strikes
update its persisted `flags.nelflow.stack.rows` projection. Foundry updates the
rendered contents of that existing message; it does not post a new message or
change the document's chronological position. The updated card therefore
remained where the first row originally entered chat.

## Client-only follow behavior

`StackPresentationController` listens to `updateChatMessage` and considers only
updates that include the Nelflow stack rows or projection revision. It then
requires all of the following:

- compact NPC Strike stacks and **Keep Active Turn Stack at Bottom** are on;
- the viewer may see the message and its content;
- the projection is a non-empty combat-turn stack;
- combat ID, round, active combatant, numeric turn, and durable turn-marker ID
  still match the current combat;
- the newly rendered element has the exact ChatMessage ID and projection hash.

After Foundry finishes replacing the message HTML, Nelflow uses
`parentElement.append(existingNode)` to move that same rendered message to the
end of its current message container. Reparenting preserves node identity and
listeners. It then calls the documented Foundry v14
`ui.chat.scrollBottom({ popout: true, waitImages: true, scrollOptions })` API.
No `ChatMessage` is created, deleted, cloned, updated, or re-flagged.

The projection hash is a non-sensitive client-side render correlation marker.
It prevents an old DOM node from being moved during the race between the
document update hook and Foundry's asynchronous message rerender. It is not
stored and has no mechanical role.

## Foundry v14 contracts inspected

- `renderChatMessageHTML(message, html, context)` supplies the message's
  pending `HTMLElement` before insertion.
- `ChatLog.element` is the public application root; `ChatLog.popout` exposes an
  optional detached view.
- `ChatLog.updateMessage` updates a previously posted message.
- `ChatLog.scrollBottom` is public and its `popout` option scrolls an existing
  popout too.
- `updateChatMessage` is the post-update document hook and includes the changed
  data used to distinguish live stack-row projection updates.

References: <https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html>,
<https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html>,
and <https://foundryvtt.com/api/v14/functions/hookEvents.updateDocument.html>.
The development host had Foundry 12.330 source available for local
corroboration, not a v14 installation; actual v14 behavior remains a runtime
acceptance item.

## Settings

- **Keep Active Turn Stack at Bottom** (`keepActiveStackAtBottom`) is a
  client-scoped Boolean, shown in Configure Settings, default `true`.
- **Default Turn Stack State** (`stackDefaultState`) is a client-scoped choice,
  shown in Configure Settings, with `expanded` and `collapsed`; default
  `expanded`.

The settings are independent. Turning follow off does not affect disclosure,
and collapsing does not prevent a live active stack from following.

## Disclosure architecture and accessibility

The stack heading is a real `button`. It has `aria-controls`, localized
`aria-label`, and an updated `aria-expanded` value, so native keyboard Enter and
Space behavior works without custom key handling. The attacker, Out of Turn
context, localized row count, and chevron remain in the heading. The authorized
**Results (N)** button remains a sibling control and is visible while rows are
collapsed.

Only the ordered row body receives `hidden`. Existing rows, Actions, Riders,
Results popovers, and guarded Undo are neither removed nor rebuilt. A per-client
in-memory map keyed by the durable message ID keeps a viewer's disclosure choice
across live rerenders. It does not write flags, settings, or socket data and may
reset after reload.

## Reload and fail-open behavior

Initial history rendering only applies the configured default disclosure state;
it never schedules follow behavior. Therefore reload does not mass-reorder
history or replay mechanics. The next legitimate row update for the currently
active stack may follow normally.

If the exact new rendered node or a supported ChatLog root cannot be found,
the retry expires, the card remains where Foundry put it, and one debug message
may be emitted. Scroll rejection is caught. If disclosure enhancement fails,
the row body is explicitly left expanded. All failures leave mechanics and
native messages untouched.

## Compatibility invariants

- The durable stack ChatMessage and `flags.nelflow.stack` remain canonical.
- `flags.nelflow.transaction` on the native attack message remains mechanical
  authority.
- Native PF2e cards, player Strike cards, save/Toolbelt cards, Application
  Records, historical stacks, and unrelated messages are never selected.
- Stack Results visibility filtering and linked native-card suppression remain
  unchanged.
- Shared-roll rows, Actions, Riders, Undo, privacy, whisper/blind visibility,
  Dice So Nice, NelCine, NelZones, and Toolbelt code paths are unchanged.
- Strike protocol 4, basic-save protocol 3, spell-attack protocol 1, healing
  protocol 1, and `nelflow.damageApplied` are unchanged.

## Manual Foundry v14 runtime checklist

1. With follow on, add a second NPC Strike row; the exact stack moves last.
2. With follow off, add a row; normal chronological DOM position remains.
3. Update one of two stacks; only the updated active stack moves.
4. Reload a long chat; historical stacks do not mass-move.
5. After reload, update the current active stack; it follows.
6. Confirm the moved ChatMessage ID and persisted flags are unchanged.
7. Confirm no duplicate stack ChatMessage is created.
8. Default Expanded shows rows.
9. Default Collapsed hides rows but keeps the heading and attacker.
10. Confirm the collapsed heading shows singular/plural row count.
11. Confirm authorized Results remains visible while collapsed.
12. Toggle with mouse, Enter, and Space; verify `aria-expanded` changes.
13. Collapse a stack, add a row, and confirm it stays collapsed.
14. Expand a stack, add a row, and confirm it stays expanded.
15. Confirm follow works in both disclosure states.
16. Use row Undo after follow; confirm the existing guard and exact row work.
17. Open Results after follow; confirm popovers and native-detail controls work.
18. Confirm Actions and Riders remain readable and functional.
19. Confirm linked native-card suppression remains exact and recoverable.
20. Confirm ordinary player Strike and PF2e damage cards never move.
21. Confirm Toolbelt/basic-save cards and Application Records never move.
22. Test public, whisper, and blind stacks with authorized/unauthorized viewers.
23. Test the sidebar and a popped-out ChatLog.
24. Test Dice So Nice, NelCine, NelZones, and relevant chat modules.
25. Temporarily make the rendered node unavailable; confirm fail-open behavior.

## Known limitations

- Local disclosure overrides intentionally reset with a client reload.
- Follow is limited to rendered sidebar/popout chat nodes. A module that moves a
  message into a separate unregistered container will cause safe no-op behavior.
- Runtime acceptance on Foundry v14/PF2e 8.x is pending; automated tests are not
  a substitute for the checklist above.
