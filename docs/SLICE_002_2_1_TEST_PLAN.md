# Slice 002.2.1 Runtime Test Plan

Run in a disposable Foundry VTT generation 14 world with PF2e 8.3.0. Inspect
stored ChatMessage content and flags, exact IDs, browser console, HP/temp HP,
and native cards. Static checks are not runtime acceptance.

1. **Two Strikes then refresh.** Expect the formatted stack and correct rows,
   not placeholder-only content; no reroll, reapplication, duplicate row, or
   replacement stack.
2. **Four Strikes then refresh.** Expect all rows in creation order with correct
   Hit/Miss terminology and application values.
3. **Refresh with Native Records hidden.** Expect the stack, configured default
   hidden state, and correct viewer-safe count.
4. **Reveal after refresh.** Expect only exact linked records; unrelated
   messages remain unchanged.
5. **Expand all record roles.** Attack, Damage, and Application must restore
   their complete original PF2e cards and controls.
6. **Improved Grab and Whip Reposition.** After refresh expect Actions (2);
   activating it opens the exact attack card and does not execute either rider.
7. **No riders.** Refresh a simple Strike and expect no false Actions indicator.
8. **Outside combat.** Refresh a standalone result; expect the standalone
   summary and no combat-stack merge.
9. **Active combat reload.** Historical and current stacks render without a new
   turn marker or replacement stack.
10. **Reload after combat.** Prior stacks remain readable and no transaction
    resumes.
11. **Stack before native records.** Later exact records reconcile with the
    existing functional control.
12. **Native records before stack.** They remain visible until the exact
    functional stack control renders, then use configured visibility.
13. **Older history batch.** Scroll older chat into view and expect each stack
    to enhance when Foundry renders it.
14. **Switch chat tabs.** Return to chat and verify controls work once with no
    duplicate handlers.
15. **Second GM refresh.** Expect reconstruction and local controls without
    transaction authority transfer or persistent render writes.
16. **Player refresh.** Expect only viewer-permitted data and no GM-only rider,
    target UUID, private target, damage, or HP disclosure.
17. **Whisper and blind refresh.** Verify Foundry content visibility and
    recipients remain authoritative with no leak.
18. **Deleted damage record.** Refresh after deletion; stack reconstructs,
    missing link is omitted/disabled, and no other record is substituted.
19. **Schema-1 stack.** Render a preserved old stack conservatively without
    error or migration write.
20. **Schema-2 placeholder stack.** Enhanced stack renders from flags without a
    page-load update.
21. **Intentional enhancement failure.** Expect meaningful stored or locally
    generated fallback and visible native records.
22. **Always Show Audit Stubs.** Refresh and expect compact native stubs visible.
23. **Disable native collapse.** Refresh and expect full native messages plus
    reconstructed stack.
24. **Disable compact stacks.** Refresh and confirm no native record is hidden
    behind an absent control.
25. **Nelflow Undo after refresh.** Expect the existing exact guarded Undo,
    including Undo Blocked behavior after intervening HP/temp-HP change.
26. **Native application revert.** Expect native behavior intact and the known
    Nelflow transaction-state limitation unchanged.
27. **PF2e Workbench.** Repeat hit/miss/reload; expect no reconstruction
    conflict or duplicate mechanics.
28. **PF2e Toolbelt.** Expand after refresh and verify Toolbelt controls remain
    intact.
29. **Dice So Nice.** Historical rendering must not replay rolls or animations.
30. **Altered chat DOM.** Expect debug-only diagnostics, readable fallback, and
    visible native records.

## Additional evidence

- Capture the stack message ID, transaction IDs, row sequence, stored content,
  `flags.nelflow.stack`, and native role markers before and after refresh.
- Verify refreshing causes zero ChatMessage creates or updates attributable
  solely to Nelflow rendering.
- Confirm new stack fallback content updates atomically with each legitimate
  row transition and does not contain UUIDs, raw JSON, or buttons.
- Open and close Native Records repeatedly across rerenders; inspect listeners
  and local state for duplication or growth.
- Do not mark this plan passed until it has been executed inside Foundry.
