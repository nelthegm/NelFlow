# Nelflow 0.8.0 — NelCine Impact Commit Bridge

## Summary

Optional world setting `nelcineImpactSync` (default **false**) delays NPC Strike HP application until NelCine emits `nelcine.strikeImpact` for the same `transactionId`, or until NelFlow’s emergency timeout fires.

## Ownership

- **NelFlow** rolls damage, prepares the transaction, applies HP once, creates Undo.
- **NelCine** provides timing only. Impact payload damage totals are ignored mechanically.

## Safety

- If NelCine is absent, Off, disabled, not primary-GM, wrong scene, etc., damage applies immediately (no artificial delay).
- Emergency commit timeout = `nelcineImpactTimeoutMs + 1500` (clamped 2000–18000).
- Exactly-one commit via pending registry claim.

## Scope

Single-target NPC Strike auto-apply path (`StrikeResolver`) only. Multi-target and player strikes unchanged.
