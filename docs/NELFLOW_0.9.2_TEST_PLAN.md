# Nelflow 0.9.2 runtime test plan

Focused regression plan for actionable PC Strike chat presentation on the
0.9.x main line (NelCine integrations preserved).

## TEST 1 — Basic PC Hit

- PC targets NPC.
- Roll Strike.
- Hit.

Expected immediately:

- attack result visible in chat;
- Damage button visible;
- no need to reopen sheet.

Click Damage.

Expected:

- native damage rolls once;
- Nelflow applies once;
- card updates to Applied + Undo;
- NelCine Strike presentation emits once when configured (no duplicate impact).

## TEST 2 — Critical Hit

- Produce critical hit.
- Critical Damage button appears.
- Click it.

Expected:

- native PF2e critical damage;
- correct final application;
- Undo available;
- one cinematic damage lifecycle when NelCine is enabled.

## TEST 3 — Miss

Expected:

- attack result visible;
- no Damage button;
- attack outcome is not hidden behind Results alone.

## TEST 4 — Two Hits Before Damage

- Attack twice.
- Leave both unresolved.
- Click Damage on first.
- Click Damage on second.

Expected:

- correct correlation for each.

## TEST 5 — MAP

- First Strike hit.
- Second Strike with MAP hit.

Expected:

- each attack result correct;
- each has its own damage control.

## TEST 6 — Fatal/Deadly Weapon

Expected:

- native PF2e critical damage remains correct.

## TEST 7 — Change Targets

- Attack target A.
- Change Foundry target to B.
- Click damage for attack against A.

Expected:

- does not silently damage B.

## TEST 8 — Reload

- Attack and hit.
- Do not roll damage.
- Reload.
- Continue from chat.

Expected:

- action remains safe, or native fallback remains visible.

## TEST 9 — Double Click

Expected:

- one damage roll/application.

## TEST 10 — NPC Regression

- NPC performs automated Strike.

Expected:

- existing NPC flow remains unchanged;
- NelCine Strike delivery / impact-sync exclusivity unchanged.

## TEST 11 — NelCine basic-save batch

- Multi-target basic save resolves as before.

Expected:

- save-batch bridge unchanged.
