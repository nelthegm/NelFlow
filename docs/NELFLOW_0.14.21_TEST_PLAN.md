# Nelflow 0.14.21 Runtime Test Plan — Damage Resource Accounting

Use Foundry V14, supported PF2e 8.x, Nelflow 0.14.21. Static tests must be green.

## TEST 1 — HP ONLY
Target with no Temp HP/Stamina. Deal known damage.
Expected: Applied total equals actual HP lost; no breakdown line.

## TEST 2 — TEMP HP ONLY
Enough Temp HP to absorb the hit. Ordinary HP unchanged.
Expected: Applied equals consumed Temp HP; breakdown `N Temp HP`.

## TEST 3 — TEMP HP + HP
Partial Temp HP then HP.
Expected: total = Temp + HP; breakdown lists both.

## TEST 4 — STAMINA ONLY
Enable PF2e Stamina variant. Damage absorbed entirely by Stamina.
Expected: Applied equals Stamina loss; not 0.

## TEST 5 — STAMINA + HP
Cross pools.
Expected: combined total and breakdown.

## TEST 6 — ALL POOLS
Temp HP + Stamina + HP where PF2e permits.
Expected: all losses in total and breakdown.

## TEST 7 — RESISTANCE
Expected: post-PF2e resource loss, not raw requested.

## TEST 8 — IMMUNITY
Expected: Applied 0 Damage.

## TEST 9 — OVERKILL
Low-resource target, high incoming.
Expected: actual resource loss only.

## TEST 10 — PC NATIVE CARD
Expected: native PF2e card intact; footer shows combined Applied total (+ breakdown when needed).

## TEST 11 — NPC STACK
Expected: compact stack unchanged except correct Applied total/breakdown.

## TEST 12 — BASIC SAVE / MULTI-TARGET
Different pools per target.
Expected: independent breakdowns.

## TEST 13 — UNDO
Mixed-pool apply then Undo.
Expected: authoritative restore; no double apply/remove.

## TEST 14 — RELOAD
Apply mixed-pool damage; reload.
Expected: historical Applied total/breakdown unchanged by later healing.

## TEST 15 — INTEGRATIONS
- `nelflow.damageApplied` once
- optional `resourceLoss` present
- NelZones / NelCine timing unchanged; no console errors
