# Nelflow 0.14.22 Runtime Test Plan — Damage Interaction Repair

Use Foundry V14, supported PF2e 8.x, Nelflow 0.14.22. Static tests must be green.

## TEST 1 — NPC STRIKE, NO SHIELD
NPC hits PC without Raise a Shield.
Expected: single stack presentation; native cards hidden behind stack when
stack-first is enabled; no duplicate settled damage card.

## TEST 2 — NPC STRIKE, SHIELD RAISED
PC has Raise a Shield. Incoming Strike damage.
Expected:
- NelFlow does **not** auto-apply immediately
- Native PF2e damage card remains visible with Shield Block + Apply
- Stack row stays pending (awaiting mitigation)
- Player can toggle Shield Block and Apply Damage

## TEST 3 — SHIELD BLOCK ACCEPT
From TEST 2, player toggles Shield Block and Applies.
Expected: shield hardness/HP processed by PF2e; actor resources settle;
stack finalizes once with correct resourceLoss; native card then hidden
behind stack.

## TEST 4 — SHIELD BLOCK DECLINE
From TEST 2, player Applies without Shield Block.
Expected: full PF2e application without shield absorption; stack settles once.

## TEST 5 — HANG REGRESSION
With shield raised, leave the card interactive; do not use a NelFlow Dialog.
Expected: no hung Dialog wait; native controls remain usable.

## TEST 6 — RESOURCE ACCOUNTING PRESERVED
With Stamina variant on, Temp HP present: after native Apply, Applied total
equals HP + Temp HP + Stamina loss (same as 0.14.21).

## TEST 7 — PLAYER STRIKE AUTO-APPLY + SHIELD
PC Strike vs PC with shield raised (auto-apply on).
Expected: same defer-to-native then settle behavior.

## TEST 8 — SPELL / SAVE UNCHANGED
Spell attack and Toolbelt/save damage with shield raised.
Expected: no Shield Block deferral from this gate (paths do not enable the
prompt).

## TEST 9 — MULTI-TARGET ONE SHIELDED
Batch Strike with one shielded target.
Expected: shielded child awaits mitigation; others may apply; shielded
settles after native Apply.
