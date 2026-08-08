# Nelflow 0.14.1 runtime test plan

Do not claim Foundry runtime acceptance until verified in-world.
Use a PLAYER account for part of this plan.

## Versions

1. Update NelFlow via Manifest URL.
2. Confirm `game.modules.get("nelflow")?.version === "0.14.1"`.
3. NelCine 0.10.2 optional for regression only.

## Critical specialization

4. Crit with an active critical specialization → stack shows RIDERS expanded;
   specialization text visible without hunting native cards.
5. Crit without specialization access → no invented specialization rider.
6. Weapon/rune critical-only effect remains visible/actionable via Details.

## Damage component negative

7. Crit with Deadly/Fatal only → damage includes dice; no meaningless Deadly rider.

## Demoralize / immunity

8. Reproduce Intimidating Glare vs mental-immune Cyclops Zombie.
   Expect compact `DEMORALIZE → Cyclops Zombie` / `IMMUNE — MENTAL` when the
   observer may identify the target (not `Unknown (Cyclops Zombie)`).
9. Apply-effects/immunity control: if Workbench provides it, Details still
   reaches it; NelFlow never auto-clicks.
10. Non-immune Demoralize still exposes normal result/effects.

## Privacy

11. Player vs GM: hidden token names do not leak.

## Regression

12. Strike Hit/Crit/Miss, Undo, Save Batch impact sync, Trip/Grapple, Healing,
    Defeated NPC, Toolbelt Target Helper.
