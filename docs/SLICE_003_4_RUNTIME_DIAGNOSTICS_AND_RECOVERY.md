# Slice 3.4: Runtime Diagnostics, Recovery, and Fail-Open Reliability

## Motivation

Slice 3.4 makes an interrupted Nelflow workflow diagnosable without attributing unrelated module errors to Nelflow. It adds durable, privacy-safe state to existing transactions and conservative GM recovery actions. It adds no new damage source category and does not change PF2e mechanics.

## Failure classification

`transaction-failure.js` owns the stable failure-code registry and normalization. The codes cover source discovery, targets, saves, damage correlation, autoroll, application, Undo, guards, and general transaction failures. Unknown reasons become `internal-exception`. A persisted failure contains only code, subsystem, operation, state, recoverability, time, localized-safe message key, whitelisted shortened context, and revision. Exceptions and stack traces are not stored in documents.

## Audit trail

Strike, Toolbelt application, legacy resolver, and autoroll records carry a schema-versioned audit array. It records meaningful state transitions and recovery events, suppresses duplicate no-op entries, and retains the newest 24 entries. Entries contain revision, event, state, subsystem, time, user role, and safe reason only. Rendering never appends audit data.

## Transaction Details and diagnostic export

Relevant source, native damage, Toolbelt, resolver, and Strike stack cards receive a compact GM-only `Transaction Details` disclosure. It shows safe state, role, count, guard, failure, recovery, revision, and last-five-event fields. There is no player-side socket endpoint, and the renderer refuses to create the panel for non-GMs.

`Copy Nelflow Diagnostic` produces schema-versioned JSON containing compatible environment versions, the existing workflow settings, a redacted transaction projection, audit, recovery, and warnings. Clipboard failure opens a `DialogV2` textarea with the same sanitized JSON. Actor, token, user, and hidden item names; formulas; totals; full UUIDs and integration IDs; target lists; raw flags; URLs; cookies; credentials; sockets; and stack traces are excluded.

## Recovery model

Recovery is durable and queue-serialized with status `none`, `available`, `running`, `completed`, `failed`, `manual`, or `abandoned`. It records action, requesting role, start/completion time, safe failure code, and revision. It never stores a requesting user identity. Service authority checks and each existing transaction queue remain authoritative.

### Re-scan Toolbelt State

The scan rereads the exact message through the Toolbelt structured adapter and pure reconciliation service. It validates source message, damage message, actor/item origin, roll index, save type, target fingerprint/order, and per-row identity. It never reads rendered HTML, rolls saves or damage, inspects HP, or applies damage. Results are `ready-for-application`, `waiting-for-saves`, `already-complete`, `manual-required`, `ambiguous`, or `unsupported`. A ready result may re-enter only the existing Toolbelt service, which rechecks timing, authority, and per-target replay guards.

### Use Existing Damage Message

The autoroll recovery service searches native damage messages using structural origin, exact source context, roll index, author, target fingerprint, and Nelflow correlation evidence. Names, titles, formulas, totals, newest-message selection, and chat adjacency are not selectors. A GM sees safe candidate metadata, explicitly selects one, and confirms the link. Linking records the message as external; it does not reroll, create a message, claim Nelflow generated it, or directly alter HP.

### Mark Manual, Clear Guard, and Abandon

- **Mark Manual** terminates Nelflow automation while preserving messages, saves, damage/application records, and audit. Native/manual work may continue and the state survives reload.
- **Clear Nelflow Guard** changes presentation ownership only. It preserves mechanics and transaction state and re-enables only controls for which Nelflow recorded guard ownership.
- **Abandon Transaction** requires confirmation, ends all interpretation and automation for the record, restores Nelflow-owned controls where safe, preserves all records, and survives reload.

## Hook boundaries and state interruption

The central init, setup, ready, ChatMessage creation/update, and chat rendering entry points use cohesive boundaries. Service failures cannot prevent sibling services, are recorded against the exact transaction when available, log only safe identifiers, resolve rather than reject, and notify the GM once when review is needed. Existing combat, actor, deletion, native-record, and control entry points retain their local guarded boundaries.

Active operations persist owner, revision, and the module-ready client session ID. A session ID is an interruption marker, not an identity or security credential. On ready, previous-session Strike processing, autoroll claimed/rolling, Toolbelt applying, legacy resolver damage/application, and in-progress Undo states become interrupted or manual-review records. They are never automatically rerolled, reapplied, or undone. Completed per-target records remain conclusive.

## Application and guard reconciliation

Structured reconciliation prefers durable application records and Toolbelt rows. It never infers completion or failure solely from HP and does not apply unresolved targets. Current HP is reserved for the existing guarded Undo precondition.

At render time, a control remains guarded only for an exact completed/external record or a claimed/rolling operation owned by the current session. Manual, abandoned, interrupted, unsupported-schema, identity-missing, and inconclusive error records fail open. Markup mismatch also fails open; labels are not used as mechanical identity.

## Reload, privacy, and external isolation

All diagnostics, audit, recovery, revision, and operation markers are ChatMessage flags and reconstruct after reload. No polling or elapsed-time correctness rule is used. One ready-time GM notification reports only the count requiring review.

Nelflow reports only its own transaction evidence. It does not patch or mutate Monk's Combat Details, PF2e Action Macros, Forge scripts, Dynamic Initiative, Sustain Reminder, Automated Animations, PF2e rule elements, or other modules. Known module versions may appear in sanitized exports, but external exceptions are not assigned blame without exact evidence.

## Identity and migration impact

Strike transaction IDs, stack/row IDs, Toolbelt integration/application IDs, legacy resolver IDs, and autoroll integration/correlation IDs are unchanged. Version 0.5.1 adds optional fields, so existing 0.5.0 flags need no destructive migration. Existing world settings and modes remain unchanged; diagnostics and recovery controls are always available to GMs.

## Known limitations

- Duplicate browser tabs for one Foundry user have different session IDs but share document authority; normal revision and queue guards reduce conflicts, but tabs cannot provide a distributed lock.
- Recovery cannot safely reconstruct missing structured Toolbelt or PF2e origin evidence.
- Ambiguous compatible damage messages require explicit selection or manual resolution.
- NPC abilities still require a native damage message because PF2e 8.3.0 exposes no verified general NPC action damage invocation API.
- Foundry runtime acceptance remains necessary; Node tests exercise pure and mocked boundaries only.
