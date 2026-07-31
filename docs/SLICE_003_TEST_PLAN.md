# Slice 003 Runtime Test Plan

Run in a disposable Foundry VTT generation 14 world with PF2e 8.3.0. Use the
browser console and inspect ChatMessage flags after each major transition.
Static and mocked checks do not satisfy this plan.

1. **Four-PC Fireball.** Send an NPC Fireball to chat, target four PCs, start
   the resolver, and confirm one persistent resolver with four rows.
2. **Player-owned saves.** Have each player roll their own Reflex save from the
   correct row; another player must not receive a usable control.
3. **NPC save.** Include one NPC and roll its Reflex save as the authoring GM.
4. **All degrees.** Obtain Critical Success, Success, Failure, and Critical
   Failure and verify PF2e's finalized structured outcomes.
5. **One damage roll.** Click Resolve Damage and confirm exactly one native
   Fireball DamageRoll/message.
6. **Basic multipliers.** Confirm zero, native half, full, and native double
   transformations for the four degrees.
7. **Different resistances.** Give targets different fire resistances and
   confirm each contextual PF2e application.
8. **Different weaknesses.** Give targets different fire weaknesses and
   confirm independent deltas.
9. **Immunity.** Make one target immune to fire and confirm native zero actual
   HP delta without bypassing IWR.
10. **Temporary HP.** Give one target temporary HP and verify pre/post snapshots
    and actual combined delta.
11. **Overkill.** Damage a target with fewer HP remaining than the result and
    verify the recorded actual delta.
12. **Critical Success.** Confirm no `applyDamage`, fake application message,
    or Undo.
13. **Application records.** Verify each safely captured damage-taken message
    links only to its exact target.
14. **Isolated Undo.** Undo one target and confirm no other actor or row changes.
15. **Undo guard.** Change one target's HP/temp HP, then verify Undo Blocked and
    no restoration.
16. **Reset Save.** Reset one completed save, roll again, and verify the prior
    message remains an audit record but cannot satisfy the new attempt.
17. **GM override.** Override a completed result and confirm original outcome,
    adjusted indicator, and chosen multiplier.
18. **Retarget after Start.** Change all current Foundry targets after creation.
19. **Immutable snapshot.** Resolve and confirm only original snapshot rows are
    used.
20. **Double-click Resolve.** Confirm one native damage roll and no duplicate
    applications.
21. **Rapid saves.** Roll four saves quickly and confirm exact independent
    claims and stable target order.
22. **Simultaneous players.** Have two players roll at once with identical save
    type/DC; confirm no cross-link.
23. **Two GMs.** Connect a second GM and verify it cannot mutate, apply, or take
    over the authoring GM's resolver.
24. **GM refresh after completion.** Confirm complete reconstruction and no
    reroll/reapplication.
25. **Player refresh during collection.** Confirm owned pending controls and
    completed rows reconstruct.
26. **Refresh while Ready.** Confirm the resolver stays Ready and waits for an
    explicit Resolve Damage click.
27. **Refresh while processing.** Refresh during damage/application; confirm
    Interrupted/manual state and no automatic replay.
28. **Native Records.** Reveal exact spell, every current/prior save, shared
    damage, and application record.
29. **Unrelated messages.** Roll manual saves and damage nearby; confirm they
    remain unrelated and visible.
30. **Cancel.** Cancel before damage; confirm durable Cancelled state and
    disabled controls.
31. **Auto-Apply disabled.** Confirm one damage roll, transformed summaries,
    no target application, and native records available.
32. **Workbench autoroll disabled.** Confirm normal behavior with other
    Workbench features enabled.
33. **Workbench overlap safety.** Enable overlapping autoroll only for a safety
    test; confirm exact ambiguity/manual failure rather than double application.
34. **Toolbelt.** Confirm intact native cards and controls.
35. **Dice So Nice.** Confirm native save/damage animations and no timing-based
    correlation.
36. **Whisper/blind source.** Confirm resolver is not broader than source and
    inaccessible records are not counted.
37. **Hidden target.** Confirm neutral target presentation to unauthorized
    viewers and no IDs/diagnostics in fallback.
38. **Persistent component.** Confirm all damaging rows become manual and no
    persistent condition is created by Nelflow.
39. **Non-basic save spell.** Confirm no Start control.
40. **Spell attack.** Confirm no Start control and normal PF2e behavior.
41. **Basic save without damage.** Confirm no Start control.
42. **Outside combat.** Confirm one standalone persistent resolver with no
    combat dependency.
43. **Combat ends.** End combat while collecting saves; confirm no crash or
    target mutation.
44. **Delete source.** Delete the source after Start, then confirm Resolve fails
    safely without a damage roll/application.
45. **Delete target token.** Delete one target before resolution; confirm that
    row becomes manual and completed targets do not replay.
46. **Console audit.** Confirm no unhandled rejections, duplicate listeners,
    duplicate native rolls, or duplicate application diagnostics.

## Additional acceptance checks

- Start with no targets: warning and no resolver.
- Target the same token twice: one row.
- Target two tokens sharing one synthetic/unlinked actor: two exact token rows;
  document the resulting sequential actor-resource semantics.
- Use Roll Pending NPC Saves with several identical NPC save statistics/DCs:
  each message must claim one attempt.
- Reset during simultaneous activity: the old attempt option must be stale.
- Try outcome override/reset/cancel after damage starts: controls and service
  guards must refuse.
- Delete a linked save/damage/application message: the resolver remains safe,
  with remaining exact records accessible.
- Toggle Stack-First Native Records and Collapse Linked Native Cards; native
  messages must never become inaccessible without a resolver control.
- Run the complete Slice 1 and Slice 2 regression plans afterward.

## Evidence

Record Foundry, PF2e, Nelflow, Workbench, Toolbelt, and Dice So Nice versions;
resolver/source/save/damage/application message IDs; parent revision and phase;
target attempt/application IDs; structured PF2e outcomes/DCs; HP/temp-HP
snapshots; console diagnostics; and screenshots. Do not mark runtime
acceptance complete until this plan has been run in Foundry.
