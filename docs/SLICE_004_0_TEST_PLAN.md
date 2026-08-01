# Slice 4.0 Runtime Test Plan

Use a copied/disposable Foundry V14 world with PF2e 8.3.0. Start with PF2e and Nelflow only, then repeat the compatibility cases with PF2e Toolbelt 3.52.0-3.52.1 and the named chat modules. Record settings, message IDs privately, HP/temp HP before and after, diagnostics, screenshots, console output, and reload results. These cases were documented but not executed by the Node test suite.

1. Install `nelflow.zip` in a copied world and confirm version 0.6.0 loads with `module.json` at the archive root.
2. Update an existing Nelflow 0.5.1 world and confirm Player Strike Auto-Apply migrates to Off once.
3. Refresh twice and confirm the migration is idempotent.
4. Create a fresh test world and confirm the setting defaults to Hostile Targets.
5. Enable Hostile Targets, create a player-owned PC and hostile NPC, and connect one player plus one GM.
6. Target exactly the hostile NPC and roll a native successful PC Strike.
7. Confirm Nelflow does not roll damage automatically.
8. Confirm PF2e's native Damage control remains usable.
9. Click Damage and complete any native dialog.
10. Confirm the native damage message is unchanged and damage applies exactly once.
11. Confirm the compact player status progresses Waiting for Damage, Applying, Applied.
12. Confirm PF2e resistance is applied natively.
13. Confirm PF2e weakness is applied natively.
14. Confirm PF2e immunity is applied natively.
15. Confirm temporary HP is consumed natively and the actual HP/temp-HP snapshots are recorded.
16. Use GM Undo and confirm only the exact HP/temp-HP pair is restored.
17. Apply unrelated healing after another automated Strike, then confirm guarded Undo refuses and records Undo Blocked.
18. Roll a critical success and confirm no damage is rolled automatically.
19. Click native Critical Damage and confirm one application with no second doubling.
20. Deliberately create ordinary damage for a critical-success attack and confirm Manual Review.
21. Deliberately create critical damage for a normal-success attack and confirm Manual Review.
22. Roll a failure, manually create damage where possible, and confirm Nelflow never applies it.
23. Repeat for critical failure.
24. Produce an attack without a conclusive structured outcome and confirm manual behavior.
25. Roll with no target and confirm no automatic application transaction is eligible.
26. Roll with two targets and confirm Multiple Targets Not Supported; neither target is selected or damaged.
27. Target Creature A, roll, retarget Creature B, click Damage, and confirm only A receives damage.
28. Delete Creature A before damage and confirm B receives nothing and the transaction becomes manual.
29. Delete and recreate a token for the same actor and confirm the replacement token does not inherit the transaction.
30. Attack a friendly token in Hostile Targets mode and confirm manual behavior.
31. Attack a neutral token in Hostile Targets mode and confirm manual behavior.
32. Attack self in Hostile Targets mode and confirm manual behavior.
33. Change a hostile token to friendly after the attack and confirm conservative disposition revalidation blocks application.
34. Switch to All Targets and confirm an exact friendly target can receive automatic application.
35. Repeat with a neutral target in All Targets mode.
36. Confirm Off leaves attack/damage messages and PF2e application entirely native.
37. Make two rapid attacks with the same weapon at MAP 0 and MAP 1, then click damage in reverse order.
38. Confirm each exact damage message applies once to its attack's snapshotted target.
39. Create two structurally indistinguishable attacks where feasible and confirm Ambiguous rather than time/order guessing.
40. Double-click Damage and confirm two native cards cannot both claim one attack; no duplicate HP application occurs.
41. Have two players attack simultaneously and confirm isolated authors/transactions.
42. Connect two active GMs and confirm stable election produces one claim/application.
43. Disconnect the elected GM before damage and confirm missing authority remains manual until safe recovery.
44. Attempt a socket request containing a target UUID and confirm it is rejected.
45. Attempt socket requests containing damage, formula, outcome, variant, source message, or HP delta and confirm rejection.
46. Attempt a request for another player's damage message and confirm GM document/ownership validation prevents arbitrary mechanics.
47. Make a valid attack outside combat and confirm exact application without a fake stack.
48. Confirm the workflow does not change combat turn, initiative, or active combatant.
49. Confirm player Strikes never appear in NPC compact turn stacks.
50. Refresh while Waiting for Damage and confirm the transaction reconstructs and can accept one later exact damage message.
51. Refresh during Applying where feasible and confirm Interrupted/Manual Review with no replay.
52. Refresh after Applied and confirm status plus guarded Undo reconstruct.
53. Refresh after Manual, Ambiguous, or Abandoned and confirm each remains terminal.
54. Delete a linked native damage message after application and confirm the attack record remains safe and Undo preconditions remain exact.
55. Open GM Transaction Details and confirm type Player Strike, setting, source kind, outcome category, link/application/authority/Undo state, failure, audit, and revision.
56. Sign in as a player and confirm private GM fields, target identity, IDs, and fingerprints are absent.
57. Copy a diagnostic and confirm no names, formulas, totals, target AC, full IDs/UUIDs, target identity, or raw flags appear.
58. Run Re-scan and confirm it does not roll, apply, or inspect HP.
59. Select Use Existing Damage Message and confirm only exact structurally compatible unclaimed cards appear.
60. Mark Manual and confirm native controls stay functional and the choice survives reload.
61. Abandon with confirmation and verify terminal reload-safe behavior.
62. Test public, GM, blind, self, and whispered roll modes where the elected GM can access the native documents; confirm visibility is not broadened.
63. Enable Dice So Nice and repeat rapid normal/critical attacks; confirm native animation and no duplicate application.
64. Enable Better Chat Message, then Workbench, then both; confirm structured-data loss fails manual and native cards remain usable.
65. Enable Toolbelt and repeat its existing Fireball plus NPC basic-save ability workflows; confirm no player-Strike cross-claim.
66. Repeat one GM-authored NPC three-Strike turn and confirm its compact stack, native correlation, application, and Undo are unchanged.
67. Inspect consoles on player and both GM clients; confirm no unhandled Nelflow rejection, duplicate application, Shield/reaction prompt, target disclosure, or permanently guarded native control.
