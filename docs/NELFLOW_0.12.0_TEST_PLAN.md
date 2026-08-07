# Nelflow 0.12.0 runtime test plan

Do not claim Foundry runtime acceptance until verified in-world.

## Versions

1. Install NelFlow **0.12.0** via Manifest URL:
   `https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json`
2. Install NelCine **0.9.1**.
3. Confirm versions and `game.nelflow.integrations.nelcineEffects.getStatus()`.

## Beneficial / harmful

4. Apply a registry-supported beneficial effect (e.g. Heroism / Bless).
   Expected: mechanics first → one BENEFICIAL cinematic.
5. Apply Bane (or flag an effect `flags.nelflow.nelcineEffectKind = "harmful"`).
   Expected: one HARMFUL cinematic.
6. Apply an unsupported custom Effect Item.
   Expected: mechanics work; **no** guessed cinematic.
7. Same supported effect on several targets from one cast.
   Expected: shared `transactionId` → NelCine may coalesce to `effectBatch`.
8. Two separate casts quickly → two transactions; no false merge.

## Authority / settings

9. GM + player → one synchronized cinematic.
10. Two GMs if practical → still one originator.
11. Toggle Full / Quick / Presentation Off / Above Applications in NelCine.
12. Disable **Show Buff & Debuff Cinematics** → no beneficial/harmful; healing/conditions may continue.
13. Disable master effect cinematics → all effect presentations off.

## Regression

14. Healing actual HP amount / zero suppress.
15. Condition gain / valued increase / decrement suppress / remove.
16. Strike presentation and impact sync.
17. Save-batch impact sync.
18. Undo / Toolbelt Target Helper.
