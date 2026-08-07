# Nelflow 0.10.0 runtime test plan

Save-batch prepared damage commit bridge (Slice 2C-B).

## BASELINE

1. Install NelFlow 0.10.0 via Foundry Manifest URL.
2. Install NelCine 0.8.0.
3. Leave Synchronize Basic-Save Damage with NelCine Impacts = Off.
4. Resolve a 3-target basic save.

Expected: normal immediate HP timing, normal Undo, ordinary batch afterward if
batch cinematics enabled.

## SYNC

5. Enable Enable NelCine Basic-Save Batches.
6. Enable Synchronize Basic-Save Damage with NelCine Impacts.
7. Resolve a supported 3-target Toolbelt basic save.

Expected: saves resolve first; HP unchanged while prepared; batch cinematic;
each target changes HP at its own impact; Undo after each commit; no double HP.

## MIXED / CAMERA / QUICK / OFF / FAILURE

Follow the product checklist for critical success through immunity, camera
limit 1, Quick mode, camera off, Presentation Mode Off, fallback, and emergency
timeout.

## REGRESSION

Verify Toolbelt 3.53.1, Strike cinematics, Strike impact sync, character
Strike, compact stacks, and Undo outside synchronized batches.
