# Changelog

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
