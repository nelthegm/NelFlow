# Slice 002.2: Stack-First Chat and Supplemental Action Awareness

## Purpose and baseline

Slice 2.2 makes the durable Nelflow stack the primary visible Strike record
while retaining every native PF2e ChatMessage as the authoritative audit and
interaction surface. It also warns the GM when PF2e associates supplemental
effects or action controls with an exact linked Strike.

The pre-implementation lifecycle below was recorded against clean baseline
commit `40cab69ab9680165e6f7feff84f0f03bd0c4ba32` before Slice 2.2 code changes:

1. PF2e creates the native attack ChatMessage and its evaluated check roll.
2. Slice 1 validates the prepared NPC Strike and writes the canonical
   `flags.nelflow.transaction` record to that exact attack message.
3. Slice 1 calls PF2e's native normal or critical Strike damage function and
   correlates the exact native damage message with structured flags.
4. Optional automatic application delegates to PF2e's contextual clone and
   `Actor#applyDamage`; a uniquely matched damage-taken message receives an
   exact presentation link.
5. Slice 2 projects each canonical transaction into one durable row in
   `flags.nelflow.stack`, using the transaction and attack message IDs for
   identity and stable creation order for sequencing.
6. Slice 2.1's single synchronous `renderChatMessageHTML` hook validates every
   native marker against the canonical transaction. It then inserts a compact
   summary and hides only the original rendered message content.
7. Each native message has its own local Show Details control. Expansion
   exposes the untouched PF2e subtree and its existing listeners.
8. Stack Details links navigate by exact persisted message ID. Guarded Undo
   delegates to the existing Slice 1 service and canonical transaction.

Slice 2.2 retains this lifecycle. Stack-first visibility and supplemental
awareness are presentation consumers; neither can roll, apply, or undo damage.

## Stack-first presentation architecture

`NativeRecordsController` coordinates separate rendered ChatMessage elements
without moving or cloning them. It builds a viewer-safe list from the stack's
persisted row links, then revalidates every candidate against:

- its exact message ID and expected role;
- its `flags.nelflow.transaction` marker;
- the canonical attack transaction;
- the canonical role-specific message ID;
- the canonical transaction's exact stack reference; and
- Foundry's current `visible` and `isContentVisible` accessors.

Only compacted elements that pass those checks receive
`data-nelflow-native-stack-id`. The stack-level button changes a CSS class on
that exact set. Unrelated messages, stale links, and records from another stack
cannot match.

The controller never changes a ChatMessage document, content, flavor, roll,
flag, author, speaker, timestamp, whisper recipient, or ownership. The records
remain in their original chronological positions in chat.

## Native Records behavior

With all three relevant conditions active:

- Compact Turn Stacks is `NPC Strikes Only`;
- Collapse Linked Native Cards is enabled; and
- Stack-First Native Records is `Hide Behind Stack Control`;

the stack header displays **Native Records (N)**. The count includes only
exact linked attack, damage, and application messages whose content the current
viewer may access. Records default hidden after reload. Activating the button
shows their compact audit stubs; activating it again hides them.

Each shown audit stub retains its independent Show Details control. Collapsed
stubs hide the normal Foundry header and content to minimize height. Expansion
removes only the collapse class, restoring the complete original header,
content, context-menu surface, PF2e controls, and companion-module controls.

If no corresponding stack control is rendered, no native message is hidden.
Deleting a stack locally releases its native elements. Changing a presentation
setting immediately removes hiding classes and requests a chat rerender; if
rerendering fails, the native records remain visible.

When Stack-First Native Records is `Always Show Audit Stubs`, the one-line
stubs remain visible. When native collapse is disabled, full native messages
remain visible. When compact stacks are disabled, native audit stubs remain
accessible and are never hidden behind a nonexistent stack.

## Local and persisted state

Whether one viewer has opened **Native Records** is stored only in a local
in-memory map keyed by the exact stack ID. It is not written to transaction or
stack flags, does not synchronize between GMs, and resets to the configured
default on reload. Independent native-card expansion is also render-local.

Exact links, rows, outcomes, damage summaries, and application state continue
to reconstruct from ChatMessage flags. No terminal transaction is replayed.

## Strike terminology

Only Strike presentation changes:

| Persisted PF2e outcome | Nelflow Strike label |
| --- | --- |
| `criticalSuccess` | Critical Hit |
| `success` | Hit |
| `failure` | Miss |
| `criticalFailure` | Critical Miss |

The stored outcome and all degree-of-success mechanics are unchanged. The
generic degree labels remain available for non-Strike or diagnostic contexts.

## Supplemental-action detection

`SupplementalActionAwareness` uses this hierarchy:

1. PF2e 8.3.0's prepared NPC Strike `additionalEffects` array.
2. The exact originating melee item's structured `attackEffects` array,
   localized through `CONFIG.PF2E.attackEffects` when available.
3. Viewer-local DOM fallback on the already validated linked attack message.

PF2e source commit
`fe99f9b5a4d215cbfb2ca9c9cd716a3f8b2df525` establishes that:

- `MeleePF2e.attackEffects` reads `system.attackEffects.value`;
- prepared NPC Strikes expose those entries as `additionalEffects`;
- `NPCPF2e#getAttackEffects` converts them to roll notes with `gm`
  visibility; and
- `Check.roll` stores the resulting notes in structured
  `flags.pf2e.context.notes`.

Structured awareness is stored as an optional version-1 object containing only
`count`, `labels`, `detectionSource`, `availabilityUnknown`, and `visibility`.
Nelflow deliberately records availability as unknown. It does not assert that
a rider is legal after the observed outcome.

### DOM fallback restrictions

Fallback runs only after exact attack-message linkage and Foundry visibility
checks succeed, and only inside that message's existing `.message-content`.
It recognizes actual PF2e semantic controls inside visible `li.roll-note`
elements:

- `data-pf2-action`;
- `a.inline-check[data-pf2-check]`; and
- roll-note buttons with `data-action`.

It excludes Nelflow controls, normal Strike attack/damage controls, roll-mode
controls, and native revert controls. It never searches prose, attack names,
actor names, timing, or nearby messages. DOM-derived awareness is viewer-local
and is never persisted. Failure to detect a rider never changes or suppresses
the attack card.

## Actions reveal and focus

An Actions indicator appears only when awareness is safe for the current
viewer and the exact attack message remains accessible. Clicking it:

1. sets that viewer's exact stack records to visible;
2. finds the persisted attack message ID;
3. expands that message's existing native card;
4. scrolls and focuses the rendered message; and
5. applies a brief CSS highlight.

The control does not dispatch a PF2e action. Improved Grab, Improved
Knockdown, Grab, Knockdown, Push, Whip Reposition, and other riders continue to
operate only through PF2e's original expanded attack card.

## Schema changes

`flags.nelflow.transaction` remains the sole mechanical authority. The
transaction snapshot gains one optional presentation field:

`snapshot.supplementalActions`

Stack rows gain the same optional projection. `flags.nelflow.stack` schema
version advances from 1 to 2 when a stack is created or next updated. The
renderer accepts schema-1 rows with no awareness field, so existing worlds
require no mechanical migration. DOM fallback can rediscover safe controls on
older linked attack messages.

No damage, application, target, Undo, stack identity, row identity, or
authority field changed.

## Visibility protections

- Native-record counts include only `visible` and `isContentVisible` messages.
- Exact role and canonical transaction checks precede every count and link.
- Structured PF2e attack effects are marked GM-visible, matching PF2e's roll
  notes; non-GMs receive neither their count nor labels.
- DOM fallback observes only controls remaining in the current viewer's
  already-rendered exact attack message.
- Non-GM stack rows use a neutral target label and do not expose target UUIDs.
- Non-GMs see structured damage or applied HP amounts only when the linked
  native record is content-visible.
- Missing, deleted, private, blind-content, or stale records are omitted or
  disabled.

These protections are conservative: a player may see less compact metadata
than PF2e could theoretically permit, but Nelflow does not disclose more.

## Compact row layout

Row Details now keeps its `Records: Attack · Damage · Application` controls
inline when width permits and wraps on narrow chat panels. Actions, Details,
record links, and guarded Undo use small text-and-icon controls with accessible
labels and keyboard behavior. Damage still distinguishes evaluated roll total,
structured damage components, and the separately recorded HP/temp-HP delta.

## Compatibility and fail-open behavior

- The implementation uses document hooks, structured flags, and the existing
  render hook; no PF2e method is monkey-patched.
- Dice So Nice message creation and animation are unchanged.
- PF2e Workbench, Toolbelt, and other modules retain their original controls
  in the untouched native content subtree.
- A missing direct Foundry header/content structure leaves the full native
  message visible.
- A failed stack match leaves its audit stub visible.
- A failed setting rerender first removes record-hiding classes.
- No presentation path returns a promise to the render hook.
- Presentation listeners are guarded at service initialization and attached
  once per newly rendered control.
- Diagnostics remain concise and namespaced; repeated native-structure warnings
  are deduplicated per message and reason.

Foundry V14 APIs were verified at:

- <https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html>
- <https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html>

## Known limitations

- Structured PF2e attack effects indicate associated follow-up material, not
  current legality. Nelflow always treats availability as unknown.
- Custom riders lacking structured attack effects and semantic roll-note
  controls cannot be detected safely.
- DOM fallback may not appear until the exact native attack has rendered; a
  later stack rerender or reload can reconstruct it.
- Chat modules that replace Foundry's direct message header/content structure
  cause Nelflow to leave the full card visible.
- If a linked record is outside the currently rendered chat window, Native
  Records still counts its accessible document, but focus requires Foundry to
  have rendered that message element.
- Native PF2e application revert remains independent of Nelflow's canonical
  transaction, as in Slice 2.1.
- Foundry runtime and companion-module acceptance remains required; static
  validation is not runtime testing.
