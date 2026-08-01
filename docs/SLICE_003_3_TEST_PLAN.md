# Slice 3.3 Runtime Test Plan

Slice 3.4 adds interruption, diagnostic-redaction, recovery, and guard
reconciliation coverage in `SLICE_003_4_TEST_PLAN.md`; rerun this baseline plan
to confirm deterministic autoroll behavior remains unchanged.

Run in a disposable Foundry V14 world with PF2e 8.3.0 and PF2e Toolbelt
3.52.0, then repeat compatibility-sensitive cases with 3.52.1. Enable Nelflow
debug logging and inspect the console after each concurrency group. These are
runtime acceptance tests; the automated Node suite does not replace them.

Record module/system versions, settings, users, test items, observed native
message IDs, Nelflow source state, damage-card count, Toolbelt target state,
actual HP/temp-HP deltas, and console errors for every failure.

1. **Enable All Eligible Sources.** Confirm the new world setting is All.
2. **Select two targets.** Confirm Toolbelt places both exact primary targets on the source workflow.
3. **Cast Fireball.** Use a direct basic Reflex save spell with one damage action and dialogs disabled.
4. **Observe automatic roll.** Confirm native damage rolls exactly once without clicking Roll Damage.
5. **Inspect native damage card.** Confirm PF2e created the ordinary DamageRoll and ChatMessage.
6. **Inspect target transfer.** Confirm both Toolbelt target rows appear on the native damage card.
7. **Roll saves through Toolbelt.** Confirm Nelflow does not roll any save itself.
8. **Resolve application.** Confirm configured Slice 3.1 timing applies the native roll normally.
9. **Inspect source status.** Confirm the source card reports Damage Rolled and links the exact damage message.
10. **Inspect completed guard.** Confirm the source Roll Damage control is visible but pointer/keyboard guarded.
11. **Enable Manual Damage Roll.** Confirm the warning and intentionally enable the control.
12. **Guard Damage Roll again.** Confirm the guard returns and both choices survive rerenders.
13. **Post an NPC breath action.** Use a structurally supported Slice 3.2 NPC basic-save action.
14. **Confirm safe manual fallback.** PF2e 8.3.0 exposes no AbilityItem damage API, so no autoroll occurs.
15. **Roll NPC action damage manually.** Confirm the existing Slice 3.2 application pipeline still works.
16. **Exercise all outcomes.** Verify critical success, success, failure, and critical failure multipliers.
17. **Test resistance.** Confirm PF2e native IWR produces the established actual delta.
18. **Test weakness.** Confirm the native contextual application applies weakness once.
19. **Test immunity.** Confirm immunity produces no unsafe HP change.
20. **Test temporary HP.** Confirm native temp-HP handling and guarded Undo remain correct.
21. **Cast Fireball twice rapidly.** Use the same actor/item before the first animation completes.
22. **Verify repeat isolation.** Confirm two source transactions and two exact native damage messages.
23. **Have two players cast simultaneously.** Use identical spells, ranks, and targets where practical.
24. **Verify player isolation.** Confirm each exact author client invokes only its own source.
25. **Use two identical NPCs.** Post identical breath actions concurrently.
26. **Verify NPC manual isolation.** Confirm neither source autorolls and manual damage cards apply independently.
27. **Click Roll Damage immediately.** Race a manual click against live eligibility before claim.
28. **Check race result.** Confirm one native card and External Roll Detected, or safe ambiguity, never two cards.
29. **Double-click before claim.** Exercise PF2e's native control as rapidly as possible.
30. **Inspect duplicate protection.** Confirm Nelflow adds no additional roll and reports uncertainty safely.
31. **Enable overlapping Workbench autoroll.** Use only a documented Workbench feature/state if available.
32. **Inspect external detection.** Confirm the external native card cancels Nelflow without setting changes.
33. **Disable Workbench autoroll.** Confirm ordinary Nelflow spell autoroll returns.
34. **Test two spell overlays.** Use a source whose damage mode is not exactly resolved.
35. **Confirm overlay fallback.** The source stays manual and the native control remains available.
36. **Test selectable damage type.** Use a spell that requires a native choice.
37. **Confirm choice fallback.** Nelflow does not choose, open, or confirm the dialog.
38. **Test Heal.** Confirm healing remains manual and no HP action is initiated by autoroll.
39. **Inspect Heal status.** Confirm a concise unavailable/manual state without private roll data.
40. **Test ambiguous Harm mode.** Confirm damage/healing ambiguity stays manual.
41. **Resolve Harm manually.** Confirm no automatic retry appears after its native card exists.
42. **Test an attack spell.** Confirm attack-roll damage is not invoked by Slice 3.3.
43. **Inspect attack controls.** Confirm spell attack and native damage controls retain normal behavior.
44. **Test attack-plus-save.** Confirm a mixed effect remains manual.
45. **Inspect save workflow.** Confirm Nelflow did not calculate the secondary save or outcome.
46. **Test persistent-only damage.** Confirm no automatic damage roll.
47. **Test mixed persistent component.** Confirm conservative manual fallback.
48. **Test splash-only damage.** Confirm no automatic damage roll.
49. **Inspect splash targets.** Confirm existing Toolbelt splash rows remain native/manual.
50. **Cast without Toolbelt targets.** Confirm Waiting for Targets and an enabled native control before claim.
51. **Leave the card unchanged.** Confirm no timeout, poll, or delayed unsafe autoroll occurs.
52. **Add targets by exact update.** Use Toolbelt's supported source-card target update.
53. **Inspect target update.** Confirm one autoroll or an explicit safe manual fallback, never duplication.
54. **Change targets during claim.** Alter the exact target set as the source becomes eligible.
55. **Inspect fingerprint refusal.** Confirm manual state and no wrong-target transfer or duplicate card.
56. **Refresh before eligibility.** Reload while the source waits for targets.
57. **Inspect historical restriction.** Confirm Interrupted/manual and no historical autoroll after adding targets.
58. **Refresh while Rolling.** Reload after durable Rolling but before correlation completes.
59. **Inspect interrupted claim.** Confirm no replay, handoff, or inferred completion.
60. **Refresh after Completed.** Confirm exact status, link, and guard reconstruct.
61. **Inspect terminal replay guard.** Confirm no reroll after refresh or chat rerender.
62. **Delete the linked damage message.** Keep the completed source card.
63. **Inspect deleted-link behavior.** Confirm no automatic reroll and no false damage disclosure.
64. **Test whispered source/damage.** Confirm recipients and status follow Foundry visibility.
65. **Test blind damage.** Confirm no total, source identity, targets, or fingerprints leak.
66. **Test a hidden NPC source.** Confirm unauthorized viewers see no hidden names or target counts.
67. **Inspect GM view.** Confirm authorized status remains functional without changing document visibility.
68. **Enable Dice So Nice.** Delay visual dice and confirm one document-level native roll.
69. **Enable Toolbelt Better Chat Message.** Rerender/reorder cards and confirm exact source guard/linkage.
70. **Enable non-overlapping Workbench features.** Confirm no hard dependency or spurious cancellation.
71. **Change scenes after source creation.** Confirm exact documents either complete safely or remain manual.
72. **Rerender chat repeatedly.** Confirm one status section and no duplicate capture listeners.
73. **Cast outside combat.** Confirm combat state is irrelevant and the live source remains isolated.
74. **Cast while paused.** Confirm native permission/pause behavior is preserved and errors fail open.
75. **Set autoroll Off.** Repeat the established Fireball manual-roll regression unchanged.
76. **Run NPC ability regression.** Confirm Slice 3.2 application, records, guards, and Undo unchanged.
77. **Run NPC Strike regression.** Confirm Slice 1/2 damage rolling, stacks, records, and Undo unchanged.
78. **Inspect the console.** Confirm no duplicate damage messages, private diagnostic data, or unhandled rejections.

## Additional authority and migration checks

79. **Use GM-Authored Sources.** Confirm a GM spell autorolls and a player spell remains manual.
80. **Use two active GMs.** Confirm only the source-author GM invokes its exact spell.
81. **Disconnect the author after claim.** Confirm no GM or player assumes rolling authority.
82. **Remove source permission before invocation.** Confirm Manual and no native call.
83. **Open an existing 0.4.0 world.** Confirm migration version 3 sets only autoroll to Off once.
84. **Reopen the migrated world.** Confirm the GM's later autoroll choice is not rewritten.
85. **Create a fresh world.** Confirm default All while workflow/source defaults remain registered values.
86. **Use PF2e damage dialogs enabled.** Confirm source remains manual and no dialog is auto-confirmed.
87. **Use GM-only source visibility.** Confirm the generated message keeps the exact native visibility mode.
88. **Use a player blind roll mode.** Confirm Nelflow neither reveals nor changes the resulting visibility.

## Acceptance record

Runtime acceptance requires all applicable cases to pass on the stated
versions. Mark unsupported NPC action autoroll cases as the documented PF2e
8.3.0 native-API limitation, not as a successful autoroll. Record any skipped
compatibility module case with the exact unavailable module/version. Do not
claim runtime acceptance from static or mocked results alone.
