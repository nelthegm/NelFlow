# Nelflow 0.14.17 Runtime Test Plan — Stack grouping

Use Foundry V14, PF2e 8.x, Nelflow 0.14.17. Optional: NelTempo / Dynamic Initiative.

## A. Ordinary same-turn grouping

1. Disable Workbench auto-damage-on-hit if desired.
2. Gorewing’s turn: Strike three times (mix of hit/miss/MAP).
3. Expect **one** compact stack titled with **3 Strikes**, three distinct rows.
4. Confirm stack message ID is stable after Strike 2 and 3 (no new parent cards).

## B. NelTempo activation

1. With Dynamic Initiative enabled, same attacker activation: three Strikes.
2. Expect one parent stack even if initiative/order UI updates mid-activation.

## C. Separation

1. Different NPC → different stack.
2. End Gorewing’s turn; later same round Gorewing acts again → **new** stack.
3. Next round Gorewing → new stack.
4. Out-of-turn different attacker during a PC turn → separate stacks per attacker.

## D. Follow + reload

1. With Keep Active Turn Stack at Bottom enabled, adding rows moves the **same**
   card to the bottom (no duplicate parents).
2. Reload Foundry → one three-row stack remains; no rerolls.

## E. Privacy

Blind/whisper Strikes still get separate stacks from public ones.
