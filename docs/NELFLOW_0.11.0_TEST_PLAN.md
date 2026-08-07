# Nelflow 0.11.0 runtime test plan

Do not claim Foundry runtime acceptance until this plan is verified in-world.

## Versions

1. Install NelFlow **0.11.0** through the Manifest URL:
   `https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json`
2. Install NelCine **0.9.0**.
3. Confirm:
   - `game.modules.get("nelflow")?.version` → `"0.11.0"`
   - `game.modules.get("nelcine")?.version` → `"0.9.0"`
   - `game.nelflow.integrations.nelcineEffects.getStatus()`

## Healing

4. Damage a target, then apply a supported Heal.
5. Expected: HP changes first; one NelCine healing cinematic follows; amount
   equals **actual** recovered HP.
6. Overheal: target missing 8 HP, heal roll 25 → cinematic **+8**, not +25.
7. Heal a full-health target → no misleading **+0** cinematic.

## Conditions

8. Apply Frightened 2 → `FRIGHTENED` / `2`.
9. Increase to Frightened 3 → `FRIGHTENED` / `3`.
10. Reduce Frightened 3 → 2 via normal PF2e decrement → no routine cinematic.
11. Remove Frightened completely → `FRIGHTENED` / `REMOVED`.
12. Apply Prone → `PRONE` with no fake numeric value.
13. Remove Prone → `PRONE` / `REMOVED`.

## Authority

14. GM + player connected → one synchronized cinematic (not one per client).

## Settings

15. Disable healing cinematics → mechanics work; no heal cinematic.
16. Disable condition cinematics → conditions work; no condition cinematic.
17. Disable master effect cinematics → all effect cinematics off; mechanics unchanged.

## Regression

18. Normal Strike presentation.
19. Strike impact sync (if enabled).
20. Basic-save batch impact sync (if enabled).
21. Confirm no new mechanical delay for heals/conditions.
