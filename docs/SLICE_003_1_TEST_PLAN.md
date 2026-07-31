# Slice 3.1 Runtime Test Plan

Run on Foundry V14 with PF2e 8.3.x and PF2e Toolbelt 3.52.0 or 3.52.1. These are runtime acceptance tests; mocked/static checks are not substitutes.

1. **Player casts Fireball against four targets.** Confirm the native spell card is unchanged.
2. **Player clicks native Roll Damage once.** Confirm exactly one native damage message and DamageRoll.
3. **Toolbelt transfers all target rows.** Confirm exact primary token rows.
4. **Players roll owned saves through Toolbelt.** Confirm Nelflow adds no save controls.
5. **GM rolls NPC saves through Toolbelt.** Confirm Toolbelt remains the roller.
6. **All-resolved mode waits and applies.** No HP changes occur before the final primary save.
7. **Exercise all four degrees.** Confirm independent persisted results.
8. **Critical Success.** Confirm No Damage, no application record, and no Undo.
9. **Success.** Confirm native half damage.
10. **Failure.** Confirm native full damage.
11. **Critical Failure.** Confirm native double damage.
12. **Fire resistance differs by target.** Confirm PF2e IWR per actor.
13. **Fire weakness differs by target.** Confirm PF2e IWR per actor.
14. **One target is immune.** Confirm zero actual delta through PF2e.
15. **One target has temporary HP.** Confirm exact temp-HP snapshot and delta.
16. **One target has low remaining HP.** Confirm actual rather than nominal delta.
17. **No separate resolver card.** Confirm no new Nelflow ChatMessage.
18. **Status placement.** Confirm compact statuses appear under the Toolbelt damage card.
19. **Per-target Undo.** Undo one Nelflow-applied target only.
20. **Changed HP blocks Undo.** Confirm Undo Blocked without restoration.
21. **Change current targets after damage creation.** Confirm no transaction change.
22. **Exact Toolbelt targets remain authoritative.** Confirm current user targets are ignored.
23. **Two players roll simultaneously.** Confirm distinct Toolbelt saves.
24. **Four saves resolve rapidly.** Confirm one processing pass and stable row order.
25. **Toolbelt queue interaction.** Confirm no lost Toolbelt updates.
26. **Two active GMs.** Confirm only one writes application state.
27. **Player-authored damage.** Confirm deterministic active-GM election.
28. **GM-authored damage.** Confirm active authoring GM is preferred.
29. **Double-click GM confirmation.** Confirm one target application each.
30. **Manual Toolbelt button during processing.** Test the documented race guard.
31. **Duplicate-damage inspection.** Verify HP and console after the race test.
32. **Reroll before application.** Confirm the old fingerprint does not apply.
33. **Latest reroll result.** Confirm the newly persisted Toolbelt outcome is used.
34. **Reroll after application.** Confirm Result Changed - Manual Review Required.
35. **No automatic reapplication.** Confirm HP remains unchanged after late reroll.
36. **Refresh before all saves resolve.** Confirm pending state and later observation.
37. **Refresh after all saves resolve.** Confirm terminal rows do not replay.
38. **Refresh during application.** Confirm Interrupted/manual rather than resume.
39. **Refresh after completion.** Confirm statuses and Undo reconstruct.
40. **Native application records.** Confirm exact links remain available.
41. **Use native PF2e application Undo.** Confirm native behavior remains functional.
42. **Native Undo desynchronization.** Confirm the documented Nelflow limitation.
43. **Target Helper disabled.** Confirm one GM warning and manual behavior.
44. **Toolbelt module disabled.** Confirm one GM warning and Strike regression safety.
45. **Unsupported Toolbelt version simulation.** Confirm fail-open manual controls.
46. **Persistent damage spell.** Confirm Manual Application Required and no condition automation.
47. **Splash damage spell.** Confirm primary roll remains safely identified or manual.
48. **Toolbelt splash target rows.** Confirm splash targets are excluded from readiness.
49. **Heal offensively against undead.** Confirm healing remains unsupported/manual.
50. **Healing against living targets.** Confirm no Nelflow application.
51. **Non-basic save spell.** Confirm ignored.
52. **Spell attack roll.** Confirm ignored.
53. **Basic save with no damage.** Confirm no integration transaction.
54. **NPC spellcaster.** Confirm Toolbelt workflow operates.
55. **Player spellcaster.** Confirm elected GM applies.
56. **Outside-combat spell.** Confirm identical safe behavior.
57. **Combat ends with pending saves.** Confirm no crash or forced result.
58. **Hidden target.** Confirm player projection does not reveal it.
59. **Whispered or blind damage message.** Confirm Foundry visibility is preserved.
60. **Workbench with overlapping spell autoroll disabled.** Confirm normal integration.
61. **Workbench overlapping autoroll enabled.** Confirm no Nelflow damage reroll or broad claim.
62. **Dice So Nice enabled.** Confirm native roll animation is unaffected.
63. **Toolbelt Better Chat Message enabled.** Confirm status survives rerender.
64. **Another chat-DOM module enabled.** Confirm separate exact-ID summary and controls.
65. **NPC Strike regression.** Run the existing Strike application, stack, and Undo plan.
66. **Console audit.** Confirm no duplicate applications, private data logs, or unhandled rejections.

## Additional mode checks

- Verify Apply Each Resolved Target gives a visibly documented shorter reroll window.
- Verify GM Confirmation progress and disabled states.
- Verify Off leaves Toolbelt fully manual.
- Verify Legacy mode alone restores the experimental Start Resolver control.
- Verify old completed and interrupted Slice 3 resolver messages still render.

Record exact Foundry, PF2e, Toolbelt, Nelflow, Workbench, and Dice So Nice versions; message IDs; processing GM; target/application IDs; Toolbelt and Nelflow revisions; HP/temp-HP snapshots; screenshots; and console diagnostics.
