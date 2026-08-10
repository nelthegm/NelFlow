# Changelog

## 0.14.3

- Keep ordinary single-target character Strike attack and damage cards fully
  native to PF2e, including native Damage/Critical Damage controls and card content
- Add only one privacy-aware application/guarded-Undo footer to the exact native
  damage card after Nelflow silently correlates and applies damage
- Preserve compact NPC stacks and the existing shared-roll multi-target character
  summary exception
- Preserve exact correlation, IWR, application proof, reload recovery, NelCine,
  NelZones, Toolbelt, riders, actions, effects, healing, and defeated integrations

## 0.14.2

- Emit versioned `nelflow.damageApplied` after exact DamageRoll → damage-taken
  correlation on NelFlow-owned applications
- Payload carries pre-IWR `immediateDamageTypes` plus authoritative AppliedDamageFlag
  subset — never fabricated post-IWR typed amounts
- Optional for consumers (e.g. NelZones); NelFlow remains standalone

## 0.14.1

- Preserve authoritative PF2e Strike riders (critical specialization, conditions,
  saves, persistent effects) in compact stacks from `flags.pf2e.context.notes`
- Auto-expand Riders on critical hits; Open Details recovers native controls
- Compact supported action results with structured target names and IMMUNE
  presentation when authoritative; preserve Workbench apply-effects via Details
- Diagnostics: `game.nelflow.integrations.strikeRiders` and action presentation helpers
- Presentation only — no new damage/condition/effect application engines

## 0.14.0

- Added NelCine NPC Defeated presentation bridge (battlefield marker only)
- Authoritative boundary: Combatant `defeated` false → true via `updateCombatant`
- NPC-only, active-combat Combatant required; out-of-combat HP edits ignored
- Exact NelFlow lethal-application cause correlation (Strike / save / damage)
- Setting: `nelcineDefeatedCinematics` (default On)
- Diagnostics: `game.nelflow.integrations.nelcineDefeated`
- Preserved Strike impact sync, save-batch, actions, healing, effects, Toolbelt, Undo

## 0.13.0

- Added NelCine combat actionResult bridge for Trip, Grapple, Shove, Reposition,
  Disarm, Demoralize, Feint, and Escape
- Detect actions via authoritative `action:<slug>` check options only
- Setting: `nelcineActionCinematics` (default On)
- Presentation-only condition correlation to avoid duplicate child cinematics
- Preserved healing, condition, effect, Strike, save-batch, Toolbelt, and Undo

## 0.12.0

- Added explicit beneficial/harmful PF2e Effect Item presentation through NelCine
- Classification via transaction override, `flags.nelflow.nelcineEffectKind`, or
  reviewed sourceId/slug registry (never name/description guessing)
- Setting: `nelcineGenericEffectCinematics` (default On), gated by master effects
- CREATE presentations only; routine effect expiration/removal suppressed
- Shared transaction IDs when PF2e origin evidence allows NelCine coalescing
- Preserved healing, condition, Strike, save-batch, Toolbelt, and Undo behavior

## 0.11.0

- Added NelCine healing and condition presentation bridge (presentation only)
- Actual HP gain from PF2e appliedDamage deltas; overheal shows recovered HP
- Suppress routine zero-heal and valued condition decrement cinematics
- Condition-remove only when the condition document is actually deleted
- Settings: `nelcineEffectCinematics`, `nelcineHealingCinematics`,
  `nelcineConditionCinematics` (defaults On)
- Diagnostics and preview helpers under `game.nelflow.integrations.nelcineEffects`
  and `game.nelflow.dev`
- Preserved Strike, save-batch, Toolbelt, Undo, and compact-stack behavior

## 0.10.0

- Added optional Synchronize Basic-Save Damage with NelCine Impacts
- Prepared Toolbelt multi-target basic-save applications before HP mutation
- Committed each target when NelCine emits `nelcine.saveBatchImpact`
- Suppressed ordinary `nelflow.basicSaveBatchResolved` for synchronized batches
- Preserved immediate mechanics when sync is off or ineligible
- Legacy basic-save resolver remains immediate (not impact-sync eligible)
- Guarded Toolbelt HP controls while awaiting cinematic impact
- Fail-open reload recovery for interrupted prepared rows

## 0.9.2

- Restored actionable Damage / Critical Damage controls on PC Strike chat cards
- Canonical waiting presentation shows attack result without requiring Results
- Native attack cards fail open when an equivalent continuation control is missing
- Damage actions delegate to the exact native PF2e `strike-damage` control
- Preserved 0.9.x NelCine Strike delivery, impact-sync, and save-batch bridges
- Preserved NPC autoroll, multi-target, application, Undo, and privacy behavior

## 0.9.1

- Restored automatic NelCine presentation for supported real Strikes
- Separated ordinary Strike cinematics from optional impact-synchronized damage
- Added exactly-once Strike presentation delivery
- Added structurally verified Toolbelt 3.53.1 compatibility
- Repaired damage-claim static ordering validation
- Corrected stale 0.7.0 release and installation documentation
- Added installable versioned release packaging
- Preserved existing mechanics and Undo behavior

## 0.9.0

- Added optional NelCine multi-target basic-save batch integration
- Added one-batch-per-effect aggregation
- Added stable batch and per-target result identifiers
- Added one shared damage-roll presentation payload
- Added authoritative per-target applied totals and outcomes
- Added exactly-once batch emission
- Preserved existing damage timing and per-target Undo
- Preserved Toolbelt, Workbench, and chat-stack behavior

## 0.8.0

- Added optional NelCine impact commit bridge for single-target NPC Strikes
- Preserved immediate damage application when NelCine is unavailable
