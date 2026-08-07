# Nelflow 0.13.0 release notes

Nelflow 0.13.0 presents supported PF2e **combat action** check results through
NelCine **after** resolution (presentation only).

## Detection

Authoritative identity is `action:<slug>` inside `flags.pf2e.context.options`
on the resolved check ChatMessage (`createChatMessage`). Generic Athletics
checks without that option are **not** guessed as maneuvers.

Supported: Grapple, Trip, Shove, Reposition, Disarm, Demoralize, Feint, Escape.

## Setting

- `nelcineActionCinematics` — Enable NelCine Combat Action Cinematics (default On)

## Consequences

Display-only. Trip/Grapple may show Prone/Grabbed on success. Demoralize does
**not** invent Frightened N; value appears only when known from correlation.
Shove/Reposition never invent movement distance.

## Condition correlation

When an actionResult represents a child condition, the ordinary condition
cinematic for that same application is suppressed (action-first or
condition-first with a short presentation defer). Unrelated later applications
still present.

## Companion

Requires NelCine **0.10.0+** (`broadcastActionResult`). No actionImpact protocol.

## Runtime acceptance

Pending; see `docs/NELFLOW_0.13.0_TEST_PLAN.md`.
