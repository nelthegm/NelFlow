# Nelflow 0.14.3 — Native player-character Strikes

Nelflow 0.14.3 restores fully native PF2e presentation for ordinary
single-target player-character Strikes and damage. Nelflow now operates as a
silent correlation and auto-application layer for those rolls, adding only a
privacy-aware application status and guarded Undo footer to the exact native
damage card.

## Presentation rule

- PF2e `character` Strike: `native-augmented`
- NPC Strike: `canonical-stack`
- Shared-roll multi-target Strike: `canonical-stack` exception for its required
  per-target outcomes and Undo operations

Character attack cards are never hidden, collapsed, cloned, or reconstructed by
Nelflow. PF2e's Damage and Critical Damage controls, roll notes, riders, item
links, effects, draggable content, tooltips, listeners, privacy, and context
controls remain intact. The resulting native damage card also remains fully
visible.

## Silent mechanics retained

The existing exact attack snapshot, native click-intent binding, deterministic
damage correlation, elected-GM application, PF2e contextual damage pathway,
IWR handling, application proof, reload persistence, and guarded Undo are
unchanged. Ambiguity and correlation failure remain manual/Review and fail open
to usable PF2e cards.

The lightweight footer is deterministic and idempotent. It reveals an applied
amount only when the viewer may see the corresponding proof; otherwise it says
only that damage was applied. A successful Undo changes the footer to Reverted.
An unsafe Undo is blocked by the existing HP/temp-HP guards.

## Compatibility

NPC stacks, shared-roll multi-target handling, Strike riders, NelCine Strike and
impact delivery, basic-save batches, healing/condition/effect/action/defeated
cinematics, Toolbelt integration, `nelflow.damageApplied`, and the NelZones
consumer contract remain on their 0.14.2 behavior.

Foundry/PF2e runtime acceptance is pending until the accompanying test plan is
run in the supported environment.
