# Nelflow 0.6.3 Deterministic Character Strike Runtime Test Plan

Use a copied/disposable Foundry 14.365 world with PF2e 8.4.0. Start with PF2e and Nelflow only, then repeat the compatibility cases with PF2e Toolbelt 3.52.0-3.52.1 and the named chat modules. Record settings, message IDs privately, HP/temp HP before and after, diagnostics, screenshots, console output, and reload results. These cases are runtime acceptance and were not executed by the Node test suite.

1. Install `nelflow.zip` in a copied world and confirm version 0.6.3 loads with `module.json` at the archive root.
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
20. Select ordinary Damage for a critical-success attack and confirm that exact native ordinary roll auto-applies.
21. Select Critical Damage for a normal-success attack and confirm that exact native critical roll auto-applies.
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
39. Create an unmarked damage message matching two structurally indistinguishable attacks and confirm Ambiguous rather than time/order guessing.
40. Double-click Damage and confirm two native cards cannot both claim one attack; no duplicate HP application occurs.
41. Have two players attack simultaneously and confirm isolated authors/transactions.
42. Connect two active GMs and confirm stable election produces one claim/application.
43. Disconnect the elected GM before damage and confirm missing authority remains manual until safe recovery.
44. Attempt a socket request containing a target UUID and confirm it is rejected.
45. Attempt socket requests containing damage, formula, outcome, variant, source message, or HP delta and confirm rejection.
46. Attempt a request for another player's damage message and confirm GM document/ownership validation prevents arbitrary mechanics.
47. Make a valid attack outside combat and confirm exact application without a fake stack.
48. Confirm the workflow does not change combat turn, initiative, or active combatant.
49. Confirm character Strikes never appear in NPC compact turn stacks.
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
65. Enable Toolbelt and repeat its existing Fireball plus NPC basic-save ability workflows; confirm no character-Strike cross-claim.
66. Repeat one GM-authored NPC three-Strike turn and confirm its compact stack, native correlation, application, and Undo are unchanged.
67. Inspect consoles on player and both GM clients; confirm no unhandled Nelflow rejection, duplicate application, Shield/reaction prompt, target disclosure, or permanently guarded native control.
68. Player character success plus native Damage automatically applies and becomes Applied without recovery controls.
69. Player character critical success plus native Critical Damage automatically applies the exact roll.
70. Player character critical success plus ordinary Damage automatically applies the ordinary roll unchanged.
71. GM-authored character success plus native Damage follows the character workflow and becomes Applied.
72. GM-authored character critical success plus native Critical Damage follows the character workflow.
73. GM-authored character critical success plus ordinary Damage applies the exact ordinary roll unchanged.
74. Assistant-GM-authored character Strike elects exactly one active authoritative GM and applies once.
75. Change current targeting after the attack; confirm only the attack's recorded target is affected.
76. Delete the recorded target before damage; confirm no application and a meaningful target failure/manual reason.
77. Roll with zero targets; confirm no character auto-application transaction becomes eligible.
78. Roll with multiple targets; confirm no target is silently selected or damaged.
79. Generate damage after a miss; confirm it is not auto-applied.
80. Generate damage after a critical failure; confirm it is not auto-applied.
81. Deliver duplicate create hooks/socket wake-ups for one damage message; confirm one native application attempt.
82. Make two rapid same-character Strikes with distinct MAP and roll each damage; confirm exact independent linkage.
83. Make two characters attack concurrently; confirm no cross-correlation.
84. Reload between attack and damage; confirm the waiting transaction rehydrates and later applies once.
85. Observe from player and GM clients; confirm both render the same final durable state.
86. In Hostile Targets mode, confirm neutral and friendly recorded targets are refused.
87. In All Targets mode, confirm hostile, neutral, and friendly exact targets are accepted.
88. In Off mode, confirm player-, assistant-GM-, and GM-authored character Strikes remain native/manual.
89. Undo an applied character Strike with unchanged HP/temp HP; confirm the exact pre-state is restored.
90. Mutate HP or temp HP after application; confirm Undo safely refuses.
91. Repeat a GM NPC Strike and confirm the existing NPC resolver/stack behavior is unchanged.
92. Repeat Toolbelt spell and NPC basic-save flows and confirm their transaction behavior is unchanged.

## Nelflow 0.6.3 click-intent correlation matrix

93. GM-authored character Strike, success, click Damage; confirm direct link and one application.
94. GM-authored critical success, click Critical Damage; confirm exact critical roll applies.
95. GM-authored critical success, click ordinary Damage; confirm exact ordinary roll applies.
96. Player-authored Strike, click Damage; confirm the elected GM applies once.
97. Assistant-GM-authored Strike; confirm exactly one active authority applies.
98. Leave two identical Strikes waiting, then click Damage on Attack B; confirm only B links.
99. Make two rapid same-character, same-weapon attacks; confirm source-message identity keeps them distinct.
100. Make two characters attack concurrently; confirm no cross-correlation.
101. Inspect the damage flag and confirm the exact source ChatMessage ID was recorded.
102. Click Critical Damage and confirm requested variant `critical` was recorded.
103. Confirm PF2e's native click handler executes exactly once.
104. Confirm Nelflow creates no additional damage roll or damage dialog.
105. Confirm the native damage message receives `flags.nelflow.characterStrikeCorrelation` without PF2e flag changes.
106. Forge or alter a transaction ID in copied metadata; confirm the GM rejects it and applies nothing.
107. Alter the structured source actor; confirm it cannot consume the intent.
108. Alter the structured source item; confirm it cannot consume the intent.
109. Wait more than 30 seconds before creating a matching message; confirm the intent cannot be consumed.
110. Cancel or fail the native damage roll; confirm the intent expires and the attack remains waiting.
111. Create no damage message; confirm the transaction remains Waiting for Damage, not Ambiguous.
112. Observe one unmarked damage message matching two equal transactions; confirm Manual Review includes candidate diagnostics.
113. Repeat the equal-candidate case with a valid direct intent; confirm the direct intent wins.
114. Deliver duplicate create hooks for one linked damage message; confirm one application.
115. Deliver duplicate socket wake-ups for one linked damage message; confirm one application.
116. Connect multiple active GMs; confirm stable election produces one applying authority.
117. Refresh after the attack and then click Damage; confirm the rehydrated card creates a new intent.
118. Refresh after direct correlation; confirm the persisted damage link remains exact.
119. Refresh during application; confirm Interrupted/recovery behavior and no duplicate damage.
120. Change current target after the attack; confirm only the recorded target is eligible.
121. Delete the recorded target before damage; confirm explicit safe failure and no application.
122. Roll with zero targets; confirm no eligible transaction.
123. Roll with multiple targets; confirm no automatic application.
124. Create damage after a miss; confirm no automatic application.
125. Create damage after a critical failure; confirm no automatic application.
126. In Hostile Targets mode, confirm neutral and friendly recorded targets are rejected.
127. In All Targets mode, confirm hostile, neutral, and friendly exact targets are accepted.
128. In Off mode, confirm no click intent or automatic application is created.
129. Undo with unchanged HP/temp HP; confirm exact guarded restoration.
130. Repeat the existing NPC Strike stack/application tests; confirm no behavior change.
131. Repeat Toolbelt basic-save application and autoroll tests; confirm no behavior change.
132. Inspect and copy diagnostics for waiting, direct-linked, rejected, fallback-ambiguous, applied, and recovery states.
133. Reproduce the 0.6.2 diagnostic with a linked direct intent, zero fallback candidates, and zero application attempts; confirm 0.6.3 accepts the same-message tuple and applies once.
134. Inspect pre-create state and confirm the local intent changes from pending to bound, not finalized.
135. Deliver the same bound damage message through duplicate create hooks and confirm no Ambiguous transition.
136. Deliver the same bound damage message through duplicate socket wake-ups and confirm one authority claim and one application attempt.
137. Reuse the bound nonce on a different damage message and confirm a direct-intent conflict with no application.
138. Present one damage message as bound to a different transaction and confirm a conflict with both records left safe.
139. Confirm a valid direct binding applies with zero structured fallback candidates.
140. Confirm a valid direct binding wins when multiple transactions are heuristic matches.
141. Wait more than 30 seconds after the native damage message is bound and confirm elected-GM processing remains eligible.
142. Leave a click intent unbound for more than 30 seconds and confirm it expires without claiming a later message.
143. Refresh the clicking browser after the damage message is created but before GM processing and confirm the persisted binding applies once.
144. Disconnect the clicking player after binding and confirm the elected GM can still revalidate ownership and apply once.
145. Refresh the elected GM while Applying and confirm interrupted recovery without duplicate application.
146. Inspect diagnostics and confirm local intent, persisted binding, authority claim, application state, bound message/transaction/nonce, and lifecycle timestamps are distinct.
147. Force the native application adapter to fail in a disposable test and confirm Application Failed/Interrupted rather than Ambiguous with zero attempts.
148. Reprocess an Applied same-message tuple and confirm the durable state remains Applied with no second native call.
149. Complete one player Strike and confirm exactly one concise Nelflow application summary appears across attack, damage, and application messages.
150. Confirm the viewer-visible native damage card is the canonical summary host.
151. Delete the linked damage message and confirm the visible attack card becomes the deterministic fallback without changing transaction state.
152. Hide the damage record from a viewer and confirm no information from that hidden record is exposed by host selection.
153. Confirm exactly one Nelflow guarded Undo is visible for an Applied transaction.
154. Confirm linked non-canonical cards contain no duplicate Nelflow status or Undo control.
155. Change HP after application, use canonical Undo, and confirm Undo Blocked replaces the button without stale restoration.
156. In Errors Only mode, complete a clean transaction and confirm Transaction Details is absent while flags and sanitized export remain available.
157. In Errors Only mode, force Failed, Interrupted, Ambiguous, Manual, orphan/recovery, and failed-Undo states; confirm Transaction Details appears expanded.
158. In Always mode, confirm the prior GM-only Transaction Details disclosure remains available for clean and exceptional transactions.
159. In Off mode, confirm Transaction Details is absent while recovery health notifications, flags, audit data, and export remain intact.
160. Reload after application and confirm the same canonical host, one summary, and one guarded Undo reconstruct from persistent flags.
161. Test attack, damage, and application whispers/blind rolls with player and GM viewers; confirm native visibility and privacy are unchanged.
162. Inspect stored native attack, damage, and application documents before and after rendering; confirm content, rolls, PF2e flags, ownership, whisper, and blind fields are unchanged.
163. Disable NPC compact stacks and confirm the legacy Strike fallback does not add duplicate player-Strike status or Undo.
164. Repeat NPC Strike, Toolbelt basic-save, autoroll, IWR, recovery, multi-GM, and Dice So Nice coverage; confirm no mechanical or compatibility regression.
