# Slice 002 Runtime Test Plan

Run these tests in a disposable Foundry VTT generation 14 PF2e world using the
PF2e 8.3.0 release. Enable Nelflow debug logging while diagnosing failures.
Record Foundry, PF2e, Nelflow, browser, and companion-module versions with each
run.

Static checks do not satisfy this plan. Inspect the native attack, damage, and
application messages after every relevant scenario: their rolls, flags,
visibility, controls, and Dice So Nice behavior must remain native and usable.

## Core combat scenarios

1. **Three Strikes in one turn.** One NPC makes three qualifying Strikes.
   Expect one Nelflow stack with three rows in attack-message creation order.
2. **Independent outcomes.** Make the first Strike succeed, the second
   critically succeed, and the third fail. Expect independent Success, Critical
   Success, and Failure rows with no extra damage roll for the miss.
3. **Rapid asynchronous Strikes.** Start two Strikes before the first damage
   roll completes. Expect two unique rows, no duplicate stack, and creation
   order even if the second damage operation finishes first.
4. **Target changes.** Change the selected target between Strikes. Expect each
   row to preserve its snapshotted target name and UUID.
5. **Identical Strike names.** Use the same Strike twice. Expect separate row
   and transaction IDs and independent controls.
6. **Agile and non-agile MAP.** Test first, second, and third attacks with agile
   and non-agile actions, including any effect that adjusts MAP. Expect the
   enabled structured `multiple-attack-penalty` value actually used by PF2e,
   not a reconstructed default.
7. **Auto-application disabled.** Disable automatic application and hit.
   Expect structured damage in the row, `Not Applied`, and working native PF2e
   application controls.
8. **Undo one row.** Apply several Strikes, then Undo one compact row. Expect
   only its exact transaction and row to become Undone and only its guarded HP
   delta to be restored.
9. **Undo guard.** Change target HP or temporary HP after automatic
   application, then use row Undo. Expect restoration refusal, an Undo Blocked
   row, and unchanged current resources.
10. **Next combatant.** Advance combat and Strike with another NPC. Expect a new
    stack.
11. **Later round.** Return to the original NPC in a later round. Expect a new
    stack and turn marker.

## Persistence and authority

12. **Reload mid-turn.** Reload after one row while another qualifying action
    is pending, then continue the turn. Expect the stored stack to render from
    flags, existing rows not to duplicate, and new rows to use the bound stack
    where their already-claimed transactions continue.
13. **Reload after terminal resolution.** Reload after damage is applied or a
    miss is terminal. Expect no damage reroll, no reapplication, stable row
    order, native collapse linkage, and guarded Undo to remain correct.
14. **Two GM clients.** Connect two active GM clients and author the Strike from
    one. Expect only the authoring/processing GM to claim, create, and mutate
    the deterministic stack; the other GM only renders it. Confirm one damage
    roll, one application, one stack, and one row per transaction.

## Native cards and unusual lifecycle

15. **Collapse enabled.** Leave Collapse Linked Native Cards enabled. Expect
    linked PF2e cards to show their message header and Show Details control.
    Expand each independently and verify every native button still works.
16. **Collapse disabled.** Disable native collapse while leaving compact stacks
    enabled. Expect normal full PF2e cards and the compact stack.
17. **Delete linked damage message.** Delete a native damage message. Expect
    its row to remain, its native reference to report unavailable, and no crash,
    reroll, reapplication, or weakened Undo guard.
18. **End combat with a pending row.** End combat while a row is resolving or
    pending application. Expect no unhandled rejection or duplicate resolution;
    its persisted `stackRef` must keep later updates on the original stack.
19. **Outside combat.** Make two qualifying NPC Strikes outside combat. Expect
    two separate standalone one-row summaries and no unrelated merge.
20. **Companion modules.** Repeat representative hit, critical hit, miss,
    collapse/expand, and Undo cases with PF2e Workbench, PF2e Toolbelt, Dice So
    Nice, and relevant chat-rendering modules enabled separately and together.
    Expect native behavior and animations to remain intact.

## Additional regression checks

- Disable Compact Turn Stacks. Expect Slice 1's native messages and compact
  per-message status/Undo behavior, with no new stack and no native collapse.
- Reorder combatants without changing the active combatant. Expect the current
  turn marker and stack to remain stable.
- Advance away from a combatant and return within the same round. Expect a
  genuinely new turn marker and stack.
- Test public, GM-only, self, and blind attack messages. Expect separate stacks
  for different visibility and no information leakage.
- Delete the stack message. Expect native PF2e messages and the canonical
  transaction to remain intact. Do not expect automatic recovery of the
  user-deleted presentation message.
- Attempt Undo after the turn and round advance. Expect success only when the
  existing HP/temp-HP guard still passes.

## Evidence to capture

For every failure, save the browser console diagnostic, relevant message and
Combat flags, stack/row IDs, message creation order, and the exact enabled
module set. Do not report this plan as passed until all scenarios have been run
inside Foundry.
