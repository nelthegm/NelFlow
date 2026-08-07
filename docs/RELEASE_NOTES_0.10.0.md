# Nelflow 0.10.0 release notes

Nelflow 0.10.0 optionally synchronizes eligible multi-target basic-save HP
commits with NelCine 0.8.x per-result batch impacts (`nelcine.saveBatchImpact`).

## Setting

**Synchronize Basic-Save Damage with NelCine Impacts**
(`nelcineSaveBatchImpactSync`, default **Off**)

Requires **Enable NelCine Basic-Save Batches**. When both are enabled and the
Toolbelt Target Helper workflow can safely pause before HP application, NelFlow:

1. prepares each authoritative target application;
2. broadcasts one authoritative NelCine save batch (`authoritativeImpacts: true`);
3. commits each target through the existing PF2e contextual application path when
   NelCine signals that result's impact (`visual`, `immediate`, or `fallback`);
4. exposes guarded Undo only after that target commits.

Ordinary `nelflow.basicSaveBatchResolved` is **not** emitted for the same
synchronized transaction (one cinematic path only).

When the setting is off, or any precondition fails, NelFlow 0.9.x immediate
mechanics and ordinary post-resolution batch presentation are preserved.

## Supported / unsupported paths

- **Supported:** Toolbelt Target Helper basic-save application (safe pre-HP
  suspension in `process()`).
- **Not impact-sync eligible in this slice:** Legacy basic-save resolver remains
  on immediate HP timing + ordinary presentation-only batch. Fail open.

## Safety

- NelCine never supplies damage math, multipliers, IWR, or Undo state.
- Exactly-once claim before async Actor application.
- Broadcast failure and NelFlow emergency timeout commit remaining prepared
  results once.
- Reload while prepared abandons memory pending state and marks Toolbelt rows
  interrupted for manual review (no silent reapply).
- Prepared lifecycle is memory-only in this slice.

## Testing status

Automated coverage covers eligibility, exclusivity, claim/races, timeout,
broadcast failure, Toolbelt wiring, and regressions. Foundry/Forge runtime
acceptance is pending; see `docs/NELFLOW_0.10.0_TEST_PLAN.md`.
