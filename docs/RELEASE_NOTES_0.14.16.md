# Nelflow 0.14.16 — Shield Block prompt on Strike auto-apply

When a Strike target has **Raise a Shield** active (`system.attributes.shield.raised`),
Nelflow pauses auto-apply and asks the token's controlling user whether to
**Shield Block**. The choice is passed to PF2e as native `shieldBlockRequest`
so hardness and shield HP remain authoritative.

## Scope

| Path | Prompted |
| --- | --- |
| PC Strike auto-apply | Yes |
| NPC Strike auto-apply | Yes |
| Multi-target Strike auto-apply | Yes (per target) |
| Spell attack auto-apply | No |
| Toolbelt / basic-save damage | No |

## Chooser

Prefer an active non-GM OWNER of the target actor; otherwise the processing GM.
Remote owners receive a socket prompt. After ~45s with no answer, damage applies
**without** Shield Block.

## Setting

**Prompt Shield Block on Strike Auto-Apply** (world, default on).

## Undo

Unchanged: restores HP and temporary HP only. Shield HP damaged by a successful
Shield Block is not restored by Nelflow Undo.

See [`NELFLOW_0.14.16_TEST_PLAN.md`](NELFLOW_0.14.16_TEST_PLAN.md).
