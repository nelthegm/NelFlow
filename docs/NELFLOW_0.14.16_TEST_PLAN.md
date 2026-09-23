# Nelflow 0.14.16 Runtime Test Plan

Use Foundry VTT 14, PF2e 8.x, Nelflow 0.14.16.

## Setup

Ensure **Prompt Shield Block on Strike Auto-Apply** is enabled.

## A. PC Strike — raised shield

1. Player raises shield (Raise a Shield effect / `shield.raised`).
2. Enemy (or ally per settings) Strikes and rolls damage.
3. Expect a dialog for the controlling player: **Shield Block** / **Apply without blocking**.
4. Choose Shield Block → damage reduced by hardness; shield may take damage.
5. Repeat and choose Apply without blocking → full IWR path, no shield block.

## B. NPC Strike — raised shield

1. NPC/ally token with raised shield is Strike-hit under GM auto-apply.
2. Expect dialog on the controlling user (usually GM).
3. Confirm Block uses native PF2e behavior.

## C. Multi-target

1. Shared-roll multi-target Strike hits a raised-shield target among others.
2. Expect a prompt for that target before its apply; other targets unaffected.

## D. Spell attack (negative)

1. Ray of Frost (or similar) auto-apply against raised shield.
2. Expect **no** Shield Block dialog.

## E. Setting off

1. Disable the setting.
2. Strike auto-apply with raised shield applies immediately without prompt.

## F. Undo

1. After a successful Shield Block, Undo restores HP/temp only; shield HP may remain damaged.
