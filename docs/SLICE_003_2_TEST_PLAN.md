# Slice 3.2 Runtime Test Plan

Run in a disposable Foundry V14 world using PF2e 8.3.0 and Toolbelt 3.52.0, then repeat compatibility-sensitive cases with Toolbelt 3.52.1. Record exact module versions and observed results. Static and mocked tests are prerequisites, not runtime acceptance.

1. Use an NPC dragon-breath `action` ability against four targets.
2. Verify Toolbelt displays the exact four primary save rows.
3. Have players roll owned-PC saves through Toolbelt.
4. Have the GM roll pending NPC saves through Toolbelt.
5. In All Saves Resolved mode, verify application begins once only after all four finalize.
6. Verify Critical Success becomes No Damage with no HP change or Nelflow Undo.
7. Verify Success applies half through the native roll transformation.
8. Verify Failure applies the unchanged native roll.
9. Verify Critical Failure applies native double.
10. Give targets different resistance values and verify independent native IWR.
11. Give one target a weakness and verify only its native result changes.
12. Give one target immunity and verify its actual HP delta is correct.
13. Give one target temporary HP and verify recorded before/after temporary HP.
14. Use a target with low remaining HP and verify native damage/defeated handling.
15. Verify no separate Nelflow resolver or replacement message appears.
16. Verify exactly one native ability DamageRoll is reused and no second damage roll appears.
17. Undo one applied target and verify no other target changes.
18. Change HP/temp HP after application and verify Undo Blocked.
19. Verify Damage/Half/Double/Triple guards on each conclusively handled row.
20. Successfully Undo and verify only that row's damage controls return.
21. Exercise Enable Manual Damage, cancel/confirm, and Guard Damage Controls again.
22. Use identical target names and verify exact token isolation.
23. Use two tokens for one actor and verify token-level isolation.
24. Connect two active GMs and verify one deterministic processing claim.
25. Finalize several saves rapidly and verify no duplicate target applications.
26. Reroll a save before application and verify the latest Toolbelt fingerprint/outcome is used.
27. Change a result after application and verify Result Changed, guarded controls, and no reapplication.
28. Apply manually through Toolbelt first and verify External Application without Nelflow Undo.
29. Refresh before all saves complete and verify pending rows reconstruct without application.
30. Refresh after all saves become ready but before application and verify one safe processing pass.
31. Refresh during application and verify Interrupted/Manual Review without resume.
32. Refresh after completion and verify no replay plus reconstructed Undo/guards/records.
33. Use an eligible NPC ability outside combat and verify identical safe behavior.
34. End combat while saves are pending and verify no crash or fabricated outcome.
35. Delete the source NPC actor before processing and verify manual fail-open.
36. Delete one target token before processing and verify other terminal targets do not replay.
37. Delete the original action-card message and verify the exact damage transaction remains safe.
38. Test one regular roll plus one structurally marked splash roll and verify the regular index is used.
39. Test two regular native damage rolls and verify ambiguous/manual handling with all controls preserved.
40. Test an ability whose PF2e context is attack-plus-save and verify no transaction/application.
41. Test an ability containing persistent damage and verify Manual Application Required.
42. Test splash targets and verify they are excluded from readiness/application records.
43. Test a non-basic save ability and verify fully native/manual handling.
44. Test plain description text claiming a basic save without structured inline/Toolbelt data.
45. Test a hazard action and verify no Nelflow ability processing.
46. Test a player-character action ability and verify no Nelflow ability processing.
47. Disable Toolbelt Target Helper and verify native/manual behavior plus one warning.
48. Disable Toolbelt and verify native/manual behavior plus one warning.
49. Use an unsupported Toolbelt version and verify version-gated fail-open.
50. Enable Dice So Nice and verify animation/render timing does not duplicate processing.
51. Enable Toolbelt Better Chat Message and verify exact source/target/roll identities persist.
52. Enable PF2e Workbench and verify no duplicate or unrelated Strike behavior.
53. Simulate chat DOM replacement and verify Nelflow status remains safe while guards fail open.
54. Repeat the established Fireball spell workflow in each timing mode.
55. Repeat NPC Strike hit, critical hit, miss, concurrent damage, stack, Native Records, and Undo regressions.
56. Inspect GM/player consoles for duplicate applications, private diagnostic leaks, and unhandled rejections.

Also verify the source setting in both modes, migration from a 0.3.2 Toolbelt world, unchanged Off/Legacy worlds, a browser reload after Manual Override, hidden/private source and target labels, and both Toolbelt 3.52.x releases before runtime acceptance.
