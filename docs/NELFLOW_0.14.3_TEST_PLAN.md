# Nelflow 0.14.3 runtime test plan

Run with Foundry generation 14 and a supported PF2e 8.x version. Test with the
Player Strike Auto-Apply setting enabled for the selected target disposition.

## Test 1 — Normal PC hit

1. Target one NPC with a PC and roll a Strike.
2. Confirm the ordinary full PF2e attack card and native Damage button remain.
3. Confirm no Nelflow Strike stack, Results, Waiting for Damage, or replacement
   button appears.
4. Click PF2e's native Damage button.
5. Confirm the ordinary full PF2e damage card remains, HP applies exactly once,
   and one small Applied/Undo footer appears on that damage card.

## Test 2 — Critical hit

1. Produce a PC critical success.
2. Confirm PF2e's native Critical Damage control remains.
3. Click it and confirm the full native critical damage card, one application,
   and one guarded Undo footer.

## Test 3 — Chat effects and linked content

Use a Strike whose PF2e card includes effects, roll notes, item links, or other
linked content. Confirm everything remains visible and native drag/drop, links,
tooltips, and listeners still work after Nelflow adds its footer.

## Test 4 — Two unresolved hits

Create hits A and B without rolling damage. Resolve B first, then A. Confirm each
native damage card binds to its own transaction and target, applies once, and
receives only its own footer.

## Test 5 — Target switch

Attack target A, switch the current target to B, then click Damage on attack A.
Confirm Nelflow applies to proven target A or safely enters Review. It must never
silently apply to B.

## Test 6 — Reload

After a completed PC application, reload the browser. Confirm both native cards
remain complete, the footer reconstructs exactly once, Undo remains guarded and
valid, and damage is not applied again.

## Test 7 — NPC Strike

Roll an NPC Strike. Confirm the existing compact Nelflow NPC stack, Results,
application, and Undo behavior is unchanged.

## Test 8 — Riders

Produce an NPC critical hit with a structured rider. Confirm the current Riders
presentation and native Details recovery remain unchanged. Confirm PC cards do
not receive a duplicate Nelflow Riders section.

## Test 9 — NelCine

Test one PC and one NPC Strike with NelCine enabled. Confirm one supported Strike
presentation event, one configured impact event, one application, and no missing
or duplicate cinematic.

## Test 10 — NelZones / damageApplied

Trigger an eligible exact Nelflow application with the integration consumer
enabled. Confirm one `nelflow.damageApplied` event with the current 0.14.2
contract and no duplicate application or fabricated post-IWR typed amounts.

## Additional regression checks

1. PC miss and critical miss remain wholly native and create no Nelflow footer.
2. Disable auto-apply and confirm the native workflow remains manual and usable.
3. Exercise fatal, deadly, property runes, precision, splash, and persistent
   components; confirm PF2e constructs and displays the roll normally.
4. Test a hidden target/private roll and confirm the footer reveals no forbidden
   name, amount, UUID, transaction ID, or diagnostic data.
5. Modify HP or temporary HP after application and confirm Undo becomes blocked.
6. Test a shared-roll multi-target character Strike and confirm its existing
   minimum batch summary and per-target Undo behavior remain unchanged.
7. Test Toolbelt basic saves, save-batch impact sync, healing, conditions,
   effects, combat actions, and Defeated cinematics for unchanged behavior.

Static automation is not Foundry runtime acceptance. Record runtime status as
pending until these scenarios are exercised in Foundry.
