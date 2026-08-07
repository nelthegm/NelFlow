# Nelflow 0.14.0 runtime test plan

Do not claim Foundry runtime acceptance until verified in-world.

## Versions

1. Update NelFlow through the existing Manifest URL.
2. Install NelCine **0.10.2**.
3. Confirm versions.

## Normal NPC defeat

4. Damage an NPC to low HP.
5. Kill it with a normal Strike.

Expected: Strike → HIT → damage float → impact / HP commit → token focus +
lingering damage → **DEFEATED**. No second pan. Exactly one Defeated tag.

## Critical hit

6. Defeat NPC with Critical Hit. Lingering damage remains; DEFEATED coexists;
   no queue stall.

## Manual

7. Manually mark an NPC Combatant Defeated → one standalone battlefield marker.

## Undo

8. Defeat an NPC with NelFlow damage, then Undo.
9. Mechanics restore normally; no attempt to reverse the visual marker.
10. Defeat the NPC legitimately again → new DEFEATED marker.

## Multi target

11. Basic-save AoE that defeats several NPCs → concurrent battlefield markers;
    no sequential full-screen death presentations.

## Negative

12. Edit an out-of-combat NPC to zero HP → no automatic cinematic.
13. PC reaches zero/defeated → no automatic DEFEATED from this bridge.

## Settings

14. Disable Show NPC Defeated Cinematics → mechanics normal, no presentation.

## Regression

15. Strike Hit/Crit/Miss
16. Strike impact sync
17. Save Batch impact sync
18. Trip/Grapple action presentation
19. Healing
20. Condition presentation
21. Undo
