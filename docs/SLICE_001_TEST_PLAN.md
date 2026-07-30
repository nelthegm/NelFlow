# Slice 001 Manual Test Plan

## Test environment

Use a disposable world. Do not run the first damage tests against production
actors.

1. Install Foundry VTT generation 14 and a compatible PF2e 8.x release.
2. Copy this module into the Foundry user-data folder as
   `Data/modules/nelflow`.
3. Enable Nelflow in the disposable PF2e world.
4. Create or import:
   - one NPC with at least one damaging melee or ranged Strike;
   - one player-owned creature target;
   - optional targets with resistance, weakness, immunity, and temporary HP.
5. Open browser developer tools and keep the Console visible.
6. Enable **Enable Debug Logging** while diagnosing. Confirm entries begin
   with `Nelflow |` and do not contain full Actor documents.
7. For HP-changing tests, record the target's initial HP and temporary HP.

For each attack, verify that PF2e's native attack and damage cards remain
present and usable. Check the target actor sheet rather than relying only on
floating combat text.

## Acceptance tests

### 1. Module disabled

1. Disable **Enable NPC Strike Auto-Resolution**.
2. Target exactly one creature.
3. Roll an NPC Strike that succeeds.

Expected: the Strike behaves exactly like ordinary PF2e. No damage is
autorolled, no Nelflow status appears, and HP does not change.

### 2. No target

1. Enable the module and auto-application.
2. Clear all targets.
3. Roll an NPC Strike.

Expected: the attack rolls normally, Nelflow warns that one target is
required, no damage is autorolled, and no HP changes.

### 3. Multiple targets

1. Target two creatures.
2. Roll an NPC Strike.

Expected: the attack rolls normally, Nelflow warns that multiple targets are
unsupported, no damage is autorolled, and neither target changes.

### 4. Single target, attack failure

1. Target one creature.
2. Roll or force a failure.

Expected: no damage roll and no HP change. The attack card has a compact
skipped status.

### 5. Single target, critical failure

1. Target one creature.
2. Roll or force a critical failure.

Expected: no damage roll and no HP change. The transaction is skipped once.

### 6. Single target, success

1. Target one creature with no relevant IWR.
2. Roll or force a success.

Expected: normal damage rolls automatically, applies exactly once to the
recorded target, and a compact status reports the target and actual HP/temp-HP
change. Only one PF2e damage-taken message is created.

### 7. Single target, critical success

1. Reset target HP.
2. Roll or force a critical success.

Expected: PF2e's critical damage rolls automatically and applies exactly once.
Confirm the damage card identifies a critical-success damage context.

### 8. Resistance

1. Give the target resistance matching the Strike's damage type.
2. Roll a successful Strike.

Expected: PF2e reduces damage by the resistance. Nelflow's displayed applied
amount agrees with the actual HP/temp-HP delta.

### 9. Weakness

1. Give the target a matching weakness.
2. Roll a successful Strike.

Expected: PF2e adds the weakness through its native damage processing.

### 10. Immunity

1. Give the target a matching immunity.
2. Roll a successful Strike.

Expected: PF2e prevents the applicable damage. The transaction completes
without directly changing HP.

### 11. Temporary HP

1. Give the target temporary HP.
2. Roll a successful Strike.

Expected: PF2e consumes temporary HP before ordinary HP according to system
rules. The recorded pre/post values match the actor sheet.

### 12. Auto Apply disabled

1. Disable **Automatically Apply Strike Damage**.
2. Target one creature and roll a successful Strike.

Expected: correct normal or critical damage autorolls, the status says
**Damage rolled**, HP does not change automatically, and PF2e's native damage
application controls remain usable.

### 13. Undo succeeds

1. Enable auto-application and Undo.
2. Apply a successful Strike automatically.
3. Make no other actor changes.
4. Click Nelflow's **Undo** on the damage card.

Expected: pre-damage HP and temporary HP are restored, state changes to
**Undone**, and the Undo button disappears. Attack and damage messages remain.

### 14. Undo is guarded

1. Apply damage automatically.
2. Change either HP or temporary HP again by any other action.
3. Click Nelflow's **Undo**.

Expected: Nelflow warns that the target changed and refuses to overwrite the
new values.

### 15. Page reload

1. Apply damage automatically and record HP.
2. Reload the GM client.
3. Reopen chat and wait for rendering.

Expected: the status remains, and the existing attack is not processed or
applied again.

### 16. Two GM clients

1. Connect two different GM users.
2. Have GM A target one creature and author an NPC Strike.
3. Watch both consoles and the target actor.

Expected: only GM A's client initiates automation. One damage roll and one
application occur. Repeat with GM B as author.

### 17. Two sequential Strikes

1. Make a normal first Strike.
2. Make a second MAP Strike using PF2e's second-attack control.

Expected: each message has an independent transaction. Only successful
attacks roll and apply damage. PF2e remains solely responsible for MAP.

### 18. Different target after attack

1. Target creature A and roll a successful NPC Strike.
2. Immediately retarget creature B while damage resolves.

Expected: damage applies only to creature A, whose UUID was stored on the
attack message. If target identity cannot be proven at message creation,
Nelflow fails closed instead of applying to B.

### 19. Module conflict sanity test

1. Enable the normal module set used in the test world.
2. Repeat one failure, success, critical success, and manual-application test.
3. Use PF2e's native buttons on unrelated attack and damage cards.

Expected: native cards and other chat hooks remain functional. Nelflow neither
suppresses nor replaces chat messages.

## Additional failure checks

- Roll a spell attack, generic attack-trait check, hazard attack, PC Strike,
  and player-authored NPC roll. Nelflow must ignore each.
- Delete the target token after the attack and before attempting Undo. Undo
  must refuse safely.
- With debug enabled, confirm the diagnostic contains IDs, outcome, context
  keys, and native-method availability, but no serialized actor data.
- Inspect `flags.nelflow.transaction` on the attack and damage messages.
  Confirm the IDs match and terminal state is persisted.
