# Slice 002.2.1: Reload Rehydration and Durable Stack Fallback

## Observed defect

Runtime testing of Slice 2.2 passed live stack, Native Records, supplemental
Actions, outside-combat, damage, and Undo behavior. After refreshing a browser,
the persisted stack ChatMessage remained but displayed only:

`Nelflow compact turn stack`

Rows and Native Records controls did not reconstruct, while linked native
messages remained visible. No roll, application, transaction, or stack was
duplicated, so the defect was isolated to presentation startup.

## Root cause

At baseline commit `a082743833406b7fdfc54277b2631ba67ae5c494`, Nelflow
registered `renderChatMessageHTML` inside the `ready` hook.

Foundry V14 documents its one-time lifecycle as `init`, `i18nInit`, `setup`,
then `ready`. `setup` runs after Settings and Documents are initialized but
before UI applications are initialized. The ChatLog can therefore render its
initial message history before Nelflow reaches `ready`. Those messages never
encountered Nelflow's renderer and retained their stored placeholder. Live
messages created after `ready` worked, which matches the observed split.

The fix registers the one `renderChatMessageHTML` listener during `setup`.
Mechanical PF2e and transaction hooks remain at `ready`.

Verified Foundry V14 documentation:

- <https://foundryvtt.com/api/v14/modules/hookEvents.html>
- <https://foundryvtt.com/api/v14/functions/hookEvents.setup.html>
- <https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html>
- <https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html>

## Live and historical rendering lifecycle

1. `init` registers Nelflow settings.
2. `setup` initializes viewer-local Native Records listeners and registers the
   synchronous chat-message renderer before ChatLog UI initialization.
3. Foundry calls `ChatMessage#renderHTML` for each message inserted into initial
   history, a live append, a document rerender, or a later `renderBatch`.
4. The single Nelflow renderer reads `flags.nelflow.stack`.
5. A visible, content-visible, minimally valid projection is rendered through
   the same `renderStack` function used for live messages.
6. Exact viewer-accessible native links are recalculated and the local Native
   Records control is attached.
7. `ready` starts PF2e-specific capture, combat, and transaction processing
   hooks. It does not rerender or migrate history.

No separate reload renderer or world-message scan exists.

## Rendering authority versus mutation authority

Read-only rendering and persistent mutation are intentionally separate:

- `canRenderStackForViewer` requires only Foundry message and content
  visibility.
- `canRevealNativeRecord` requires exact current-viewer visibility for that
  linked ChatMessage.
- `canUseUndo` additionally requires the authoring GM identity, valid persisted
  state, enabled Undo setting, and exact accessible attack message.
- `TurnStackService.canPersistStackProjection` retains compact-stack mode,
  current GM, attack author, and persisted `processingUserId` requirements.
- Slice 1 transaction claim, damage, application, and Undo guards are
  unchanged.

A second GM or permitted player can render. Rendering never calls a transaction
update, creates a stack, appends a row, rolls damage, applies damage, or changes
authority.

## Rehydration architecture

`renderNelflowChat` remains synchronous and idempotent. It receives the exact
ChatMessage document and pending HTMLElement from Foundry, validates the stored
stack shape, applies viewer privacy checks, and delegates to the existing stack
renderer.

Schema-1 and schema-2 messages use the same path. Missing optional damage,
application, or supplemental fields remain conservative. Invalid flags leave
stored content in place and produce one deduplicated debug-only diagnostic.

No transaction is inspected for terminal replay during rendering because
rendering has no mechanical entry point at all.

## Message-order reconciliation

`NativeRecordsController` remains keyed only by exact stack and native message
IDs:

- If a native record renders first, it remains visible. When the stack later
  renders, validated existing native elements are attached and hidden only
  after the functional stack control exists.
- If the stack renders first, its control is present when later exact native
  records register, so they acquire the configured local visibility.
- If the stack is outside the rendered range, no control exists and records
  fail open visible.
- Reopening chat or rendering an older batch repeats the same idempotent
  process; there is no name, prose, or timing correlation.

No MutationObserver, retry loop, timeout, interval, or global world-message scan
is required.

## Native Records reconstruction

Every stack render recalculates the count from persisted row links. Each
candidate must pass:

- expected role and exact message ID;
- Nelflow marker transaction ID;
- canonical transaction resolution;
- canonical role-specific linked ID;
- canonical exact stack reference; and
- current `visible` and `isContentVisible`.

Local visibility defaults to the configured hidden mode after reload. Only
stacks explicitly opened by the current viewer occupy the local state map.
Closing records removes the map entry. Setting changes and stack deletion clean
local state.

Individual native Show Details controls and Actions use exact message IDs.
When a document exists but is outside the rendered ChatLog window, Nelflow
issues a localized “not currently rendered” notice rather than opening another
message.

## Supplemental Actions and Undo

Persisted `supplementalActions` metadata renders immediately from stack flags.
Schema-1 messages without it may reuse Slice 2.2's exact linked-attack,
visible-roll-note DOM fallback when that native message renders.

Actions still only reveals, expands, focuses, and highlights the exact native
attack card. It never dispatches PF2e actions or evaluates legality.

Undo visibility reconstructs from the persisted row and exact attack message.
Activation delegates to `StrikeResolver.undoFromMessage`, which retains Slice
1's exact transaction resolution and HP/temp-HP guard. Rendering performs no
restoration.

## Durable fallback content

Nelflow owns stack-message content, so new stacks store semantic non-interactive
HTML rather than a placeholder. The fallback contains:

- round or Outside Combat heading;
- ordered Strike and MAP rows;
- a privacy-safe target label;
- localized Hit/Miss terminology;
- state such as Resolving, Applied, Not Applied, Undo Blocked, Undone, or Error;
- structured damage, applied amount, and supplemental count only for a
  GM-only audience.

It contains no controls, UUIDs, raw JSON, transaction diagnostics, native-card
content, or formula reconstruction.

When enhanced rendering fails, Nelflow removes any stack-first hiding, renders
the same fallback locally from flags where possible, and leaves exact native
records visible.

## Fallback persistence

During an already-authorized live projection update, `TurnStackService` compares
the durable schema/actor/rows projection. If it changed, one atomic
`ChatMessage.update` writes both:

- `flags.nelflow.stack`; and
- the matching Nelflow-owned `content`.

An unchanged projection causes no document update. Rendering never calls this
path. Old placeholder content is repaired only when a legitimate projection
change already requires an update; page load performs no bulk or lazy write.

## Schema compatibility

The stack schema remains version 2. Slice 2.2.1 adds no required flag field.
Fallback content is derived from existing persisted rows and is not mechanical
state. The formatter treats a missing schema version as version 1 and tolerates
missing optional supplemental, damage, application, and presentation fields.

## Privacy

Enhanced rendering retains Foundry `visible` and `isContentVisible` checks,
neutral non-GM targets, inaccessible damage/application suppression, and
GM-only structured rider awareness.

Stored content cannot vary by viewer. Therefore:

- blind stacks whose persisted recipient list is exclusively GMs, or other
  exclusively GM-whispered stacks, may store private projected values;
- broadly visible or mixed-recipient stacks store `Target`, omit damage and HP
  amounts, and omit GM-only supplemental counts;
- no target or actor UUID is written into fallback HTML.

This is deliberately conservative.

## Failure and performance behavior

- Rehydration failure does not enter any mechanical service.
- Native records are unhidden through an exact stack-scoped fail-open call.
- Stored or locally generated fallback remains readable.
- Diagnostics are debug-only and deduplicated by message and reason.
- One render listener is registered once at `setup`.
- Per-element listeners are attached only to newly rendered controls.
- No history-wide rerender, world-message scan, polling, or retained
  ChatMessage document registry exists.
- The local map retains only stacks the viewer has explicitly opened and is
  cleaned on close, setting change, or deletion.

## Known limitations

- An old placeholder-only message is not persistently repaired until a
  legitimate projection change occurs, though enhanced and local fallback
  rendering work from its flags.
- Focus requires the exact native message element to be in Foundry's current
  rendered ChatLog batch.
- Chat modules that prevent `renderChatMessageHTML` or replace expected direct
  message structure can force fallback behavior.
- Native PF2e application revert remains independent of Nelflow transaction
  state.
- Foundry runtime acceptance still requires the companion test plan.
