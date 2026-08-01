# Slice 3.4 Runtime Test Plan

Use a copied/disposable Foundry V14 world with PF2e 8.3.0. Record module versions, browser, settings, console output, card screenshots, diagnostics, HP/temp-HP before/after, and reload results. Static and mocked tests are not runtime acceptance.

1. Install the 0.5.1 ZIP in a copied world and verify `module.json` loads from the archive root.
2. Enable only PF2e, PF2e Toolbelt 3.52.0 or 3.52.1, and Nelflow.
3. Make one qualifying NPC Strike and verify its existing compact-stack behavior.
4. Cast one supported Fireball and verify one native damage roll.
5. Use one supported NPC breath weapon with a manually created native damage roll.
6. Confirm normal application and guarded Undo for all supported workflows.
7. Open Transaction Details on a Strike record.
8. Open Transaction Details on a spell source card.
9. Open Transaction Details on a native damage/Toolbelt card.
10. Copy each diagnostic JSON record.
11. Confirm diagnostics contain expected Foundry, PF2e, Nelflow, and Toolbelt versions.
12. Confirm no campaign actor or token names appear.
13. Confirm no hidden item/spell names appear.
14. Confirm no formulas appear.
15. Confirm no damage totals or HP values appear.
16. Confirm no full UUID, raw flags, target list, URL, cookie, credential, or socket data appears.
17. Deny clipboard permission and verify the safe DialogV2 textarea fallback.
18. Sign in as a player and verify Transaction Details is absent.
19. Attempt direct DOM changes as a player and verify there is no recovery/socket authority endpoint.
20. Produce a missing-target/manual-review Toolbelt transaction.
21. Confirm a localized failure code and recovery status appear only to the GM.
22. Run Re-scan Toolbelt State.
23. Confirm re-scan does not change HP or temporary HP.
24. Confirm re-scan does not roll a save.
25. Confirm re-scan does not roll or create damage.
26. Confirm waiting saves return Waiting for Saves.
27. Confirm conclusive completed rows remain complete.
28. Confirm ambiguous structured state remains manual and is not guessed.
29. Create one structurally compatible native damage message manually.
30. Open Use Existing Damage Message and inspect only safe candidate data.
31. Confirm wrong actor, item, rank, overlay, roll-index, and target-fingerprint messages are absent.
32. Select the exact compatible message and confirm the DialogV2 prompt.
33. Confirm the message links as external without rerolling or creating a message.
34. Confirm linking alone does not alter HP.
35. Confirm any later application uses the unchanged configured application timing and per-target guards.
36. Mark a transaction Manual and confirm the state survives refresh.
37. Confirm Mark Manual restores Nelflow-owned controls and permits native/manual work.
38. Confirm Mark Manual preserves saves, messages, application records, HP, and audit.
39. Clear a Nelflow Guard and verify transaction/mechanical state is unchanged.
40. Confirm only Nelflow-owned disabled state, aria, title, tooltip, classes, and keyboard behavior are restored.
41. Confirm a control disabled independently by PF2e or another module remains disabled.
42. Abandon a transaction and confirm the warning prompt.
43. Refresh and verify Abandoned is terminal and Nelflow does not resume it.
44. Interrupt Fireball autoroll by refreshing during Rolling where feasible.
45. Verify it becomes Interrupted/Manual Review and never rerolls.
46. Interrupt target application where feasible and verify unresolved work does not reapply.
47. Interrupt Undo where feasible and verify it is not retried on ready.
48. Verify completed target application records remain completed after interruption/reload.
49. Verify a conclusive completed source stays guarded after reload.
50. Verify manual, abandoned, interrupted, unsupported, and inconclusive error sources fail open.
51. Verify changed PF2e/Toolbelt markup fails open without blocking native controls.
52. Confirm ready shows at most one GM-only interrupted-transaction notification.
53. Confirm players receive no health notification and a clean world receives none.
54. Enable Dice So Nice and repeat a rapid Fireball pair; confirm no duplicate roll/application.
55. Enable Better Chat Message and repeat Fireball plus reload/re-render.
56. Enable PF2e Workbench and repeat all supported workflows.
57. Enable Monk's Combat Details last and observe external errors without attributing them to Nelflow.
58. Repeat with PF2e Action Macros and Forge-hosted client scripts as available.
59. Confirm external module errors do not cause Nelflow to patch settings, functions, sheets, status effects, or item rules.
60. Test rapid repeated Fireballs from one caster.
61. Test two simultaneous casters.
62. Test two identical NPC abilities with separate manual native damage messages.
63. Test resistance, weakness, and immunity through native PF2e application.
64. Test temporary HP consumption and guarded Undo refusal after later HP changes.
65. Test public, whispered, and blind rolls and verify diagnostic redaction for each.
66. Test two connected GMs and verify only the elected authority mutates each transaction.
67. Test two browser tabs for one GM and record the documented limitation without duplicate application.
68. Delete a linked native damage message and verify the record becomes diagnosable/manual without replay.
69. Inspect console diagnostics for short IDs and safe roles/reasons only.
70. Confirm no Nelflow unhandled promise rejection, duplicate autoroll, duplicate application, or permanently stuck guard remains.
