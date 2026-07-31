# Slice 002.2.2 Runtime Test Plan

Run in a disposable Foundry VTT generation 14 world with PF2e 8.3.0. Enable
Nelflow debug logging for correlation evidence. Static and mocked tests are not
runtime acceptance.

1. **Two rapid successful Strikes.** Expect two exact native damage links, two
   applications, and no Error rows.
2. **Rapid Hit and Critical Hit.** Let completion order reverse. Expect normal
   and critical damage on their exact rows.
3. **Three identical Strikes.** Expect three distinct messages/claims while row
   order remains attack-message creation order.
4. **Four mixed outcomes.** Misses create no damage; each success owns one
   unique card and no card is reused.
5. **Repeated same Strike and target.** Expect correlation independent of
   actor, Strike, and target names.
6. **Change targets rapidly.** Expect each exact roll and application to retain
   its recorded target.
7. **Two NPCs attack rapidly.** Expect no cross-actor claim and no global
   serialization.
8. **Rapid attacks outside combat.** Expect independent standalone summaries
   and exact claims.
9. **Dice So Nice enabled.** Expect animation/visual order not to affect
   document correlation.
10. **Workbench with damage autoroll off.** Expect normal Nelflow behavior.
11. **Workbench with overlapping autoroll on.** Expect no additional Nelflow
    invocation; untagged Workbench cards are not claimed, and any copied exact
    tagged context fails ambiguous. Record the installed Workbench behavior.
12. **PF2e Toolbelt enabled.** Expect native damage controls and target helpers
    intact.
13. **Two GM clients.** Only the authoring GM may invoke, claim, persist, and
    apply. The other GM only renders.
14. **Reload after rapid completion.** Expect exact links and stacks to
    reconstruct with no roll, claim, or application replay.
15. **Refresh while unresolved.** Expect no duplicate invocation and no
    authority handoff; use native controls for interrupted recovery.
16. **Native call produces no ChatMessage.** Expect controlled Error/manual
    behavior and no application.
17. **Two exact matching tagged messages.** Expect ambiguous failure and no
    automatic application of either.
18. **Manual damage at nearly the same time.** Expect the untagged manual card
    not to be claimed.
19. **Improved Grab and Whip Reposition.** Supplemental awareness and exact
    Actions focus must remain unchanged.
20. **Nelflow Undo after rapid attacks.** Each Undo must affect only its exact
    applied transaction.
21. **Native PF2e application revert.** Native behavior remains available; the
    existing transaction-state desynchronization limitation remains.
22. **Delete linked damage after application.** Transaction remains safe and
    the ID cannot be substituted by another live message.
23. **Browser reload.** Stack rehydration and viewer-local Native Records
    behavior remain correct with no mechanics replay.
24. **Console during spam.** Expect no unhandled rejection or missing-message
    failure during supported concurrency. True ambiguity must emit concise
    controlled debug events.
25. **`preUpdateActor` / `setProperty` investigation.** Reproduce with only
    Nelflow, then modules individually. Expect no Nelflow source/hook match and
    no unrelated Nelflow actor-update changes.

## Evidence

- Record transaction, attack, damage, application, stack, and row IDs.
- Record the correlation option, invocation sequence, strategy, state,
  candidate count, and claim owner from flags/debug output.
- Confirm each native damage call occurs once and each application follows a
  successful exact claim.
- Confirm failures leave native damage cards visible and the row says manual
  application is required only when a DamageRoll actually returned.
- Repeat core Slice 1, Slice 2, Slice 2.1, Slice 2.2, and Slice 2.2.1
  regression scenarios.
- Do not mark this plan passed until executed inside Foundry.
