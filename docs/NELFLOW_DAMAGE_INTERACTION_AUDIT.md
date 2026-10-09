# NelFlow Damage Interaction Audit (0.14.22 repair)

## Repository state at audit

| Field | Value |
|-------|--------|
| Branch | `fix/0.14.22-damage-interaction-repair` |
| Base HEAD | `8037789` — NelFlow 0.14.21 damage resource accounting |
| Version | `0.14.22` (repair slice) |
| Worktree | Dirty with repair WIP → then committed locally |
| Baseline tests (pre-repair) | 1645 pass / 0 fail |

## Established product rule

For NPC / canonical-stack damage, the **final** user-facing presentation is the
NelFlow stack. A second settled PF2e damage result must not remain visible.

PF2e remains authoritative for interactive mitigation. NelFlow must not suppress
required native interaction (Shield Block toggle + Apply Damage).

Interactive native PF2e damage UI may exist **temporarily** while mitigation is
pending. After settlement, stack-first hiding resumes.

## NPC Strike pipeline (repaired)

1. Strike roll ChatMessage → `StrikeResolver` claims transaction
2. Hit/crit outcome from PF2e context
3. Native DamageRoll ChatMessage created by PF2e
4. NelFlow correlates damage → `TransactionStore.linkMessage(..., "damage")`
5. Optional NelCine impact-sync arm; else immediate commit
6. `PF2eAdapter.applyDamageRollToRecordedTarget` (+ `shieldBlockPrompt`)
7. **Shield gate** (`resolveShieldBlockForApplication`):
   - if raised + setting on → `{ deferToNative: true }` (no Dialog)
   - else continue auto-apply
8. **Deferred path:** leave `pendingApplicationCaptures` open; register
   `registerDeferredMitigation`; transaction → `AWAITING_MITIGATION`;
   `NativeRecordsController.failOpen` / skip hide while pending
9. Player uses native `data-action="shield-block"` + Apply Damage
10. PF2e `Actor#applyDamage({ shieldBlockRequest })` mutates HP/Temp/Stamina/shield
11. Unique `damage-taken` → `observeDeferredMitigationMessage` → settle handler
12. Pre/post `healthSnapshot` → `resourceLoss` / `appliedAmount`
13. Transaction → `APPLIED`; stack row updated; `nelflow.damageApplied`
14. `NativeRecordsController.markStackRendered` restores stack-first hide

## Where code hides / correlates / settles

| Concern | Location |
|---------|----------|
| Hide native behind stack | `NativeRecordsController.registerNative` / `markStackRendered` when stack-first + not mitigation-pending |
| Compact linked natives | `NativeCardCompactor.render` |
| Correlate damage | `DamageCaptureRegistry` via `PF2eAdapter` |
| Auto-apply start | `strike-resolver` / `player-strike-service` / `multi-target-strike-service` → `applyDamageRollToRecordedTarget` |
| Wait for application | Deferred: open capture + `native-mitigation-deferral`; Immediate: await `applyDamage` then `finishApplicationCapture` |
| Settled | Unique damage-taken + resource snapshots → `APPLIED` |
| Stack result | `TurnStackService.syncTransaction` / `projectTransaction` |

## PF2e Shield Block findings (installed `pf2e.mjs`)

| Topic | Finding |
|-------|---------|
| Raised signal | `actor.system.attributes.shield.raised` |
| Native UI | Damage ChatMessage `data-action="shield-block"` toggles `CONFIG.PF2E.chatDamageButtonShieldToggle` |
| Apply path | Manual Apply Damage reads that toggle into `shieldBlockRequest` |
| `applyDamage({ shieldBlockRequest })` | **No player dialog** — immediate hardness + shield HP when true |
| Completion signal | PF2e creates `damage-taken` ChatMessage with `flags.pf2e.appliedDamage` |

**Conclusion:** Interactive Shield Block is the **damage card toggle + Apply**,
not an async prompt inside `applyDamage`.

## Regression source (0.14.16 Dialog gate)

Custom DialogV2 / socket prompt + stack-first hide of the damage card caused:

1. Stack hang waiting for a Dialog the player never got
2. Missing native Shield Block controls
3. Duplicate presentation when hide failed while stack already projected

## Repair

`scripts/shield-block-gate.js` returns `deferToNative`.
`scripts/native-mitigation-deferral.js` settles after native Apply.
Resource accounting from 0.14.21 runs only after PF2e's final application.
