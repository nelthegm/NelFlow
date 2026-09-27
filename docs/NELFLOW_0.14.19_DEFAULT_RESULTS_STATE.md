# Nelflow 0.14.19 — Default-expanded Strike Results

## Existing mechanism

Before 0.14.19, `NativeRecordsController` owned a module-local
`resultsOpenByStack` map keyed by durable stack message ID. Only open states were
stored; an absent key meant collapsed. `bindStackControl` updated the Results
button and applied `.nelflow-stack--results-open` to rendered copies of that
exact stack. The map survived ordinary rerenders, was cleared on presentation
setting changes, and deleted an entry when its stack message was removed. It
never wrote a ChatMessage, flag, setting override, or socket message.

No client setting controlled the initial Results state.

## 0.14.19 behavior

The existing local registry now supports explicit `true` and `false` overrides.
When no override exists it reads the new client setting
`resultsDefaultState`, which defaults to `expanded`. Therefore new and reloaded
stacks immediately show viewer-authorized Attack, Damage, and eligible guarded
Undo icons. A user click stores the opposite state only in that client session.

Ordinary rerenders, new rows, and stack-follow DOM reparenting reuse the durable
stack ID and preserve the override. Deleting the stack drops its entry. Changing
a presentation setting clears local overrides before a forced chat rerender so
the newly configured defaults apply consistently.

## Independent disclosure layers

- `stackDefaultState`: initial visibility of the entire Strike row list.
- `resultsDefaultState`: initial visibility of exact result controls inside
  visible Strike rows.

Both default to `expanded`. Whole-stack collapse hides row bodies regardless of
Results state. Expanding the stack again reveals rows using that viewer's
current Results state.

## Privacy and exact records

The state controls visibility, not eligibility. Results still contains only
exact transaction-linked Attack and Damage records that pass existing
ChatMessage visibility checks. It cannot manufacture controls or reveal private
totals, hidden targets, UUIDs, transaction IDs, proof records, or diagnostics.

## Unchanged

Strike mechanics, damage rolling/application, PF2e IWR, transaction and stack
identity, stack follow, exact correlation, native-card suppression, Results
counts/popovers, Riders, Actions, guarded Undo, Toolbelt, NelCine, NelZones,
NelTempo, Workbench, Dice So Nice, and all presentation protocol versions are
unchanged.
