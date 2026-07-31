# Slice 3.1.1 Runtime Test Plan

Use a disposable Foundry V14 world with PF2e 8.3.0 and Toolbelt 3.52.0, then repeat compatibility-critical cases with 3.52.1. Enable Target Helper and Nelflow's Toolbelt workflow. Static and Node mocked checks are prerequisites, not runtime acceptance.

1. Cast Fireball against two targets.
2. Resolve one full and one double result; verify Nelflow applies both correctly.
3. Verify Damage, Half, Double, and Triple are guarded on both rows.
4. Verify Block remains usable.
5. Pointer-click a guarded Damage control.
6. Verify no second HP application or application record occurs.
7. Focus a guarded control and press Enter and Space.
8. Verify no second application occurs.
9. Use Nelflow Undo on one target.
10. Verify only that target's damage controls return and its status is Undone.
11. Apply manually after successful Undo.
12. Verify Toolbelt's native application remains functional and Nelflow does not auto-reapply.
13. Apply with Nelflow, change HP or temporary HP, then attempt Undo.
14. Verify Undo Blocked and continued guarding.
15. Choose Enable Manual Damage as the processing GM.
16. Verify the Foundry warning dialog and cancel path, then explicitly confirm.
17. Verify controls restore without HP, save result, or multiplier change.
18. Choose Guard Damage Controls and verify the exact row is guarded again.
19. Resolve a Critical Success / No Damage target.
20. Verify its four application controls are guarded, other controls remain active, and no Nelflow Undo appears.
21. Apply through Toolbelt before Nelflow can claim a target.
22. Verify structured External Application and prevention of another accidental application.
23. Change a save result after Nelflow application.
24. Verify Result Changed / Manual Review, existing record and Undo, guarded controls, and no automatic HP change.
25. Resolve a four-target Fireball with mixed degrees.
26. Verify independent status, guard, override, and Undo per row.
27. Target two tokens representing the same actor.
28. Verify token UUID identity prevents cross-guarding.
29. Include a primary target and splash target for one actor.
30. Verify the unsupported splash row remains under Toolbelt/manual behavior.
31. Test a spell with persistent damage.
32. Verify persistent-damage manual state is not guarded merely because it is present.
33. Reload after application.
34. Verify guard attributes, tooltips, indicator, and interception reconstruct without mechanical replay.
35. Reload after successful Undo.
36. Verify controls remain restored and Toolbelt's original disabled state is respected.
37. Reload after Manual Override.
38. Verify the exact override remains enabled until the GM re-guards it.
39. Connect two active GMs.
40. Verify only the processing GM sees/uses override controls and no conflicting flag updates occur.
41. Have a player author the basic-save spell while an active GM processes it.
42. Verify permitted viewers see only already-visible guard status and the elected GM owns persistence.
43. Include a hidden/private target.
44. Verify no target name, UUID, HP delta, processing user, or override user leaks.
45. Enable Better Chat Message and repeat an applied-target render.
46. Simulate changed/unknown target-control DOM markup.
47. Verify Nelflow retains its status, logs once in debug mode, and leaves controls usable.
48. Disable Guard Toolbelt Damage Controls and rerender/reload.
49. Verify original Toolbelt controls and behavior remain unchanged while Nelflow application/status/Undo continue.
50. Run existing NPC Strike hit, critical hit, miss, native-card, stack, and Undo regressions.
51. Inspect the console across repeated rerenders for duplicate handlers, private diagnostics, and unhandled promise rejections.

Record Foundry, PF2e, Toolbelt, Nelflow, and companion-module versions plus actual results. Repeat relevant cases with Workbench and Dice So Nice separately and together. Do not mark runtime acceptance from static or mocked checks.
