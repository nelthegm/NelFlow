# Nelflow 0.13.0 runtime test plan

Do not claim Foundry runtime acceptance until verified in-world.

## Versions

1. Install NelFlow **0.13.0** via Manifest URL.
2. Install NelCine **0.10.0**.
3. Confirm versions and `game.nelflow.integrations.nelcineActions.getStatus()`.

## Trip

4. Successful Trip → one cinematic: TRIP / SUCCESS / PRONE (no second PRONE).
5. Failed Trip → TRIP / FAILURE (no fake Prone).

## Grapple / Demoralize

6. Grapple success/failure matches actual PF2e result (Grabbed on success; no invented Restrained).
7. Demoralize success → one combined result; no duplicate standalone Frightened from the same action.
8. Later unrelated Frightened change still presents.

## Shove / Reposition / Feint / Disarm / Escape

9. Successful checks present without invented movement distance.
10. Escape may omit target; only authoritative fields appear.

## Authority / settings

11. GM + player → one synchronized presentation.
12. Disable Action Cinematics → mechanics unchanged, no presentation.

## Regression

13. Healing, ordinary conditions, generic effects, Strike, save-batch impact sync, Undo.
