# Nelflow 0.12.0 release notes

Nelflow 0.12.0 presents **explicitly classified** beneficial and harmful PF2e
Effect Items through NelCine **after** the effect is applied.

## Classification (deterministic only)

PF2e Effect Items have **no** native beneficial/harmful field. NelFlow never
guesses from name, description, icon, or chat HTML.

Priority:

1. NelFlow transaction override
2. `flags.nelflow.nelcineEffectKind` (`beneficial` | `harmful` | `null`)
3. Reviewed stable registry (`sourceId` / `slug`)
4. Unsupported → no cinematic

## Setting

- `nelcineGenericEffectCinematics` — **Show Buff & Debuff Cinematics** (default On)
- Still gated by master `nelcineEffectCinematics`

## Lifecycle

- CREATE of Actor-owned `type: "effect"` → present when classified
- Routine DELETE / expiration → **suppressed** in 0.12.0
- Conditions remain on the 0.11.0 path
- Granted-item children and `aura-*` carriers suppressed
- Aura-transmitted grants use a short noise window for reconstruct churn

## Coalescing

When `system.context.origin.item` (or aura origin) is known, multiple targets
share one `transactionId` so NelCine **0.9.1** can coalesce into `effectBatch`.
NelFlow does not implement a second coalescer.

## Companion

Requires NelCine **0.9.1+** effect API. NelCine is not modified by this release.

## Runtime acceptance

Pending; see `docs/NELFLOW_0.12.0_TEST_PLAN.md`.
