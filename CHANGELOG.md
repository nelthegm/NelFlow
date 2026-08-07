# Changelog

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
