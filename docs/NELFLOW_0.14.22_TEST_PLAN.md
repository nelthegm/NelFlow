# Nelflow 0.14.22 Runtime Test Plan — Damage Interaction Repair

Use Foundry V14, supported PF2e 8.x, Nelflow 0.14.22. Static tests must be green.

Version note: 0.14.16 (original Shield Dialog gate) and 0.14.21 (resource accounting)
are already on `main` / tagged history. This repair is **0.14.22**.

## TEST 1 — NPC NORMAL DAMAGE
NPC attacks PC without raised shield.
Expected:
- normal application
- one visible final stack result
- no second native final damage result (stack-first hide)

## TEST 2 — RAISED SHIELD / DECLINE
PC Raises Shield. NPC hits PC. Damage is rolled.
Expected:
- PC receives native PF2e Shield Block opportunity (damage-card toggle)
- stack shows **Waiting for Damage Resolution**
- player declines (Apply without Block)
- damage applies via PF2e
- stack completes once
- one final visible damage result
- no hang

## TEST 3 — RAISED SHIELD / BLOCK
Same setup. Player accepts Shield Block (toggle + Apply).
Expected:
- PF2e resolves Hardness / shield HP / reaction
- actor takes correct final damage
- NelFlow reports **post-block** resource loss only
- stack completes
- one final visible result

## TEST 4 — TEMP HP + SHIELD BLOCK
Expected: breakdown uses final post-block Temp HP / HP changes (not pre-block).

## TEST 5 — STAMINA + SHIELD BLOCK
Expected: breakdown uses final post-block Stamina / HP changes.

## TEST 6 — PLAYER CLIENT
Run NPC attack from GM. Make Shield Block decision on the actual player client.
Expected: native card is interactive for the target owner; resolves for all clients.

## TEST 7 — TWO GM
Verify only one authoritative damage transaction / `damageApplied` event.

## TEST 8 — RELOAD AFTER SETTLEMENT
Expected: one stack result; native duplicate does not reappear as a final card.

## TEST 8b — RELOAD WHILE PENDING
Expected: orphaned awaiting-mitigation fails closed to Interrupted / manual review;
NelFlow does **not** invent Apply or auto-decline Shield Block.

## TEST 9 — PC STRIKE
Expected: PC retains full native PF2e damage card plus only NelFlow Applied/Undo footer.

## TEST 10 — BASIC SAVE / SPELL ATTACK
Expected: existing batch/canonical behavior remains; no global over-suppression of
PF2e damage cards; Shield Block deferral does not enable on spell/save paths.

## TEST 11 — TIMEOUT / ABANDON
If the player never Applies within the deferral timeout:
Expected: Interrupted / review; native card remains available; no guessed damage.

## Third-party noise (ignore unless proven causal)
- PSFX missing shield-spell animation
- Sequencer preload warnings
- Kingmaker Tools / Rideable / PF2e Animations logging
