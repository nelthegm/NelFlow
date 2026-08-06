# Nelflow 0.7.0 runtime test plan

Use a disposable Foundry 14 PF2e world. Test with two active GMs and at least
one player where specified. Inspect actual actor HP/temp HP and native PF2e
messages; do not accept chat wording alone as mechanical proof.

## Attacker-scoped stacks

1. Active NPC makes several Strikes: one stack, ordered rows.
2. NPC attacks during a player turn: stack belongs to the NPC and says Out of Turn.
3. NPC attacks during another NPC turn: actual attacker is shown.
4. Two out-of-turn NPCs attack: two stacks in attack-message order.
5. Two tokens linked to one actor attack: separate stacks.
6. Same out-of-turn token attacks repeatedly in one window: one stack.
7. Advance round: new stack.
8. Change combat: no merging.
9. Reorder initiative and return to a creature: no false turn merge.
10. Reload/reconnect: attacker attribution and row order persist.
11. Delete the attacker token: existing record fails safely and never migrates.

## Capture and shared attack

12. Select two targets and Strike: exactly one attack roll.
13. Select five targets: still one attack roll and five child rows.
14. Use different ACs: independent outcomes from the shared total.
15. Confirm critical success, success, failure and critical failure can coexist.
16. Exercise natural 20 against several ACs.
17. Exercise natural 1 against several ACs.
18. Use first, second and third MAP: modifier applies once per Strike.
19. Confirm PF2e advances MAP once, not once per child.
20. Change targets while a roll dialog is open: captured set remains immutable.
21. Duplicate target input: one child for the token.
22. Delete one target after the attack: siblings continue; deleted child Review.
23. Test concealed targets independently.
24. Test hidden targets independently.
25. Fail one flat check and pass another: only failed child receives no damage.
26. Exercise off-guard and cover on different targets; unsafe unresolved context must Review.

## Damage and IWR

27. All miss: no automatic damage roll.
28. All normal hit: one normal native damage message.
29. All critical hit: one critical native damage message.
30. Mixed hit/critical: one normal and one critical native message.
31. Fatal/deadly Strike: critical group uses native critical construction.
32. Critical specialization/critical-only modifier remains native.
33. Apply normal group to several targets.
34. Apply critical group to several targets.
35. Confirm failures and failed flat checks receive no application.
36. Give targets different resistance, weakness and immunity.
37. Give targets different temporary HP.
38. Exercise precision restrictions and material traits.
39. Exercise vitality/void interaction.
40. Exercise persistent damage instances.
41. Confirm adjusted HP deltas differ while the rolled group total is shared.
42. Force one application failure: completed siblings remain complete and are not repeated.
43. Disable NPC auto-application: native groups remain manual.
44. Exercise character Hostile and All disposition policies per child.

## Authority, reload, recovery and Undo

45. Two GMs connected: elected GM alone creates/mutates the batch.
46. Player-authored character batch: player cannot mutate HP.
47. Replay duplicate create hooks/socket traffic: no duplicate group or application.
48. Reload after terminal application: no reroll or reapplication.
49. Reload mid-resolution: uncertain children become Review, completed siblings remain.
50. Reconnect both GMs: no authority takeover replay.
51. Tamper capture token/actor/scene flags in a disposable world: validation fails closed.
52. Per-target Undo: only selected target restores.
53. Undo All with all children unchanged: all restore.
54. Change one target HP after application: Undo All restores safe siblings and blocks it.
55. Delete an applied target before Undo: only that child is unavailable.
56. Undo after turn/round advance: existing guard decides legality.

## Presentation and privacy

57. NPC batch: one parent action row and ordered child rows.
58. Player batch: one summary on one canonical visible native host.
59. At most one Undo All and one per-target Undo per child.
60. No Transaction Details, UUIDs, transaction IDs or technical payload in chat.
61. Linked-card suppression enabled: the canonical stack/summary is the only
    ordinary visible Strike presentation, while exact native documents remain
    present in the Messages collection.
62. Results includes only viewer-accessible Attack, Damage, and Critical Damage
    entries. It has the post-filter count, excludes Application, and is omitted
    when that count is zero.
63. Hover and keyboard-focus each Results entry: the popover shows the exact
    evaluated structured roll and closes on pointer exit, focus exit, or Escape.
64. Attack popover: verify d20, final modifier, named modifiers, MAP and total;
    verify authorized AC/outcome plus natural 20/1 and fortune/misfortune data.
65. Shared-roll attack popover: verify captured target order and independent
    authorized outcomes; unauthorized target names/defenses must not leak.
66. Damage/Critical Damage popovers: verify evaluated formula, die faces, static
    terms, damage types/categories, total, and fatal/deadly or critical terms.
67. Delete one linked native record: remaining summary and Results count are
    safe; no stale entry or empty Results control appears.
68. Break or make linkage ambiguous in a disposable world: affected native
    card remains fully visible and functional (fail open).
69. Force canonical stack/summary rendering failure: linked native cards remain
    visible and functional (fail open).
70. Blind attack as unauthorized player: no summary, Results, target, AC,
    outcome, roll, or record leak.
71. Whisper attack as non-recipient: no summary, Results, or record leak.
72. Hidden token-name policy: neutral target labels for unauthorized viewers.
73. Reload/history render: same privacy, canonical host, native suppression,
    Results entries, and internal round partitioning without a visible round.
74. Narrow chat sidebar and viewport edges: rows wrap, controls remain keyboard
    operable, and popovers remain entirely on screen without blocking clicks.
75. Disable linked-card suppression: native PF2e messages render normally while
    the Nelflow stack/summary and Results inspection remain available.
76. Confirm native application documents and guarded Undo proof still exist,
    despite having no viewer-facing Application entry or button.

## Settings and compatibility

77. Shared-roll Off: multi-target automation is disabled; singular behavior unchanged.
78. NPC Strikes Only: NPC batch enabled, character batch excluded.
79. Player and NPC Strikes: both supported.
80. Change setting after a batch: persisted batch does not mutate.
81. Test PF2e Workbench alone and with its damage autoroll enabled/disabled.
82. Test PF2e Toolbelt Target Helper and damage controls.
83. Test Dice So Nice attack, flat-check and damage animations.
84. Test relevant chat-rendering modules separately and together.
85. Re-run the established NPC singular, player singular and basic-save plans.

Automated Node/static coverage is not Foundry runtime acceptance. Record the
Foundry, PF2e and companion-module versions and any failed scenario before
promoting a release candidate.
