# Slice 002.1 Runtime Test Plan

Run in a disposable Foundry VTT generation 14 world with PF2e 8.3.0. Inspect
the stored ChatMessage documents and expanded native controls throughout.
Static checks do not satisfy this runtime plan.

1. **One successful NPC Strike.** Expect one Nelflow stack; independently
   collapsed attack, damage, and uniquely linked application cards; and correct
   compact summaries.
2. **One failed NPC Strike.** Expect one compact attack card, a Failure stack
   row, and no damage or application message.
3. **One success and one failure.** Expect one two-row stack, two compact attack
   cards, one compact damage card, and one compact application card when safely
   linked.
4. **Manual attack expansion.** Expand the first attack card. Expect the full
   native card to remain readable and functional; manual expansion is not a
   defect.
5. **Damage expansion.** Expand the damage card. Verify formula, total, Damage,
   Half, Double, Triple, Block, tooltips, roll interaction, and module-added
   controls.
6. **Application expansion.** Expand the application card. Verify original
   PF2e content, applied-damage data, and native Undo/revert control.
7. **Nelflow row Undo.** Use compact-row Undo. Expect the exact existing Slice
   1 HP/temp-HP guards and only that row's state update.
8. **Native application revert.** Use PF2e's application-card revert if
   present. Verify native behavior is uninterrupted and record that Nelflow's
   separate transaction/row does not reconcile automatically.
9. **Collapse disabled.** Disable Collapse Linked Native Cards. Expect normal
   attack, damage, and application layouts with no Nelflow collapse controls;
   the compact stack remains.
10. **Browser reload.** Reload after a terminal Strike. Expect linked cards to
    default collapsed again, the stack to reconstruct, and no reroll or
    reapplication.
11. **Two GM clients.** Verify permission-correct presentation on both clients,
    one mechanical transaction, one stack row, and no duplicate message
    summaries or listeners.
12. **Different targets.** Strike different targets in one turn. Verify each
    application audit line resolves through its own canonical transaction and
    exact target.
13. **Nearby healing.** Create a healing application while Nelflow resolves
    damage. Expect the healing message to remain unrelated and uncollapsed.
14. **Nearby manual damage application.** Apply unrelated native damage during
    Nelflow resolution. Expect it not to receive the Nelflow transaction marker
    or compact summary; record any exact source/item/target ambiguity.
15. **PF2e Toolbelt.** Expand affected native cards and verify Toolbelt target
    and damage controls remain present and operational.
16. **PF2e Workbench.** Repeat hit and miss flows. Expect no presentation
    exception and no new mechanical automation.
17. **Dice So Nice.** Verify animations and native roll/message creation are
    unchanged.
18. **Changed chat DOM.** Use a chat module that removes or relocates the direct
    standard message header/content structure. Expect a debug-only diagnostic
    and the full native message left readable.
19. **Blind and whispered rolls.** Test GM roll, blind roll, self roll, and
    whispers. Expect no summary for content the current viewer cannot see and
    no disclosure of a PF2e-obscured target name.
20. **Three or more Strikes.** Compare chat height with native collapse enabled
    and disabled. Expect a substantially shorter stack and native audit trail
    while every original message remains expandable.

## Additional regression checks

- Expand and collapse attack, damage, and application cards in different
  orders; only the selected message should change.
- Append new messages after expansion and rerender chat. Controls must not
  duplicate and newly rendered linked cards should use the collapsed default.
- Use keyboard activation on every Show Details, Hide Details, Details, and
  Undo control.
- Delete a linked message and use stack Details. Expect a localized unavailable
  notification and no transaction mutation.
- Test a zero-damage or fully immune result. If PF2e omits `appliedDamage`,
  expect the application card to remain fully native.
- Inspect flags before and after expansion. No ChatMessage flag or stored
  content should change due to presentation.

## Evidence

Record Foundry, PF2e, Nelflow, browser, and companion-module versions; message
IDs and roles; relevant canonical transaction IDs; console diagnostics; and
screenshots of collapsed and expanded states. Do not mark this plan passed
until it has been executed inside Foundry.
