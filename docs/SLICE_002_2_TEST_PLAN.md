# Slice 002.2 Runtime Test Plan

Run this plan in a disposable Foundry VTT generation 14 world with PF2e 8.3.0.
Inspect stored ChatMessage documents and the browser console throughout.
Static checks do not satisfy runtime acceptance.

1. **Hit and Critical Miss.** Make two NPC Strikes in one turn, one success and
   one critical failure. Expect one compact stack using **Hit** and **Critical
   Miss**, one Native Records control, unchanged mechanical results, and linked
   native records hidden by default.
2. **Reveal Native Records.** Activate the stack control. Expect only the exact
   linked attack, damage, and application audit stubs for that stack.
3. **Expand attack.** Expand one attack stub. Expect its complete original PF2e
   attack card, header, actor, traits, modifiers, target, result, buttons,
   context menu, author, visibility, and timestamp behavior.
4. **Expand damage.** Expect the complete PF2e damage roll, formula, Damage,
   Half, Double, Triple, Block, inspection, and module-added controls.
5. **Expand application.** Expect complete PF2e application content and native
   revert/Undo controls.
6. **Hide Native Records.** Activate the stack control again. Expect the linked
   rendered records to disappear, the stack to remain, and all documents and
   flags to remain stored.
7. **Always Show Audit Stubs.** Select that Stack-First Native Records mode.
   Expect audit stubs to remain visible and each Show Details control to work.
8. **Disable native collapse.** Expect normal full PF2e messages, no stack-first
   hiding, and the Nelflow stack to remain.
9. **Disable compact stacks.** With native collapse enabled, expect compact
   audit stubs to remain accessible and no record hidden behind an absent
   stack.
10. **Improved Grab.** Use a Strike whose structured attack effects contain
    Improved Grab. Expect a GM-visible Actions indicator. Activate it and
    verify the exact attack card expands and PF2e's original interaction works.
11. **Whip Reposition.** Expect awareness in the exact row and no automatic
    execution or replacement action.
12. **Multiple supplemental actions.** Expect a safe count or generic
    indicator. Confirm ordinary Strike attack, Damage, Critical Damage, roll
    inspection, Nelflow, context-menu, and revert controls are not counted.
13. **No supplemental action.** Expect no Actions indicator.
14. **Miss with a hit-dependent rider.** Expect Nelflow not to claim the rider
    is legally available. The tooltip must say availability is not evaluated.
15. **Actions while records hidden.** Expect exact stack records to reveal, the
    exact attack card to expand, scroll/focus, and receive a brief highlight.
16. **Identical Strike names.** Use the same Strike twice. Each Actions control
    must open its own persisted attack message ID.
17. **Different targets.** Change targets between Strikes. Each Actions control
    must open its own linked attack message and row.
18. **Outside combat rider.** Expect one standalone stack with the same outcome,
    awareness, compact records, Actions, Details, and guarded Undo behavior.
19. **Browser reload.** Expect no reroll, reapplication, duplicate row, or
    duplicate stack. Native Records returns to the configured default and
    structured awareness reconstructs.
20. **Two GM clients.** Toggle records independently. Expect no synchronized
    local expansion state and no duplicate mechanical processing or projection.
21. **PF2e Toolbelt.** Expand linked cards and verify Toolbelt controls remain
    present and functional.
22. **PF2e Workbench.** Repeat hit, miss, and rider cases. Expect no duplicate
    automation or changed PF2e result.
23. **Dice So Nice.** Verify dice animations and native message creation remain
    unchanged with records hidden and shown.
24. **Changed chat DOM.** Use a module that removes or relocates the direct
    Foundry message header/content structure. Expect the complete native record
    visible and a concise debug diagnostic.
25. **Blind and whispered messages.** Test GM, blind, self, and whispered
    Strikes. Expect no private native record, target, damage, applied amount,
    supplemental name, or unsafe count to be exposed.
26. **Nearby healing and manual damage.** Create both near a Nelflow Strike.
    Expect neither unrelated message to be linked, counted, compacted, or
    hidden.
27. **Three or more Strikes.** Expect one substantially shorter stack-first
    view, stable creation order, exact independent rows, and access to every
    native record.

## Regression and evidence

- Repeat Slice 1 success, critical success, failure, auto-apply-off, resistance,
  weakness, immunity, temporary HP, and guarded Undo cases.
- Undo one of several rows, then change HP and verify another Undo is blocked
  without changing the target.
- Delete one linked message. Its record count and exact link must disappear
  without rerolling or weakening Undo.
- Delete the stack. Native records must become visible and remain stored.
- Change each presentation setting while records are hidden. Accessibility must
  be restored even if chat rerendering fails.
- Inspect flags before and after every presentation control. No transaction,
  stack, PF2e flag, content, flavor, roll, whisper, or ownership field may
  change.
- Use keyboard activation for Native Records, Actions, Show/Hide Details,
  row Details, record links, and Undo.
- Record Foundry, PF2e, Nelflow, browser, and companion-module versions; exact
  message/transaction/stack IDs; console diagnostics; screenshots; and stored
  flags. Do not mark the plan passed until it has run inside Foundry.
