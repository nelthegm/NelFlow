# Nelflow 0.14.7 Test Plan

## Automated

```powershell
npm test
npm run check
npm run package
```

Baseline before slice: **1212** tests at commit `12b6e59` / version **0.14.6**.

Focused coverage: `tests/basic-save-presentation-feed.test.mjs`

## Manual Foundry acceptance

Use the normal Toolbelt basic-save workflow (do not patch Toolbelt).

### A. Single target

1. Enable `game.nelflow.dev.watchBasicSavePresentationFeed()`
2. Trigger an ordinary basic Reflex save
3. Expect Toolbelt to roll normally
4. As soon as the target result appears, expect:

```text
BASIC SAVE TARGET RESULT
...
```

before later batch/application work where architecture permits.

### B. Verify real result

Compare watcher output to Toolbelt/PF2e:

- same target
- same total
- same degree
- same save type
- same DC when exposed
- natural/modifier match exactly when Toolbelt exposes them

### C. Multi-target

Fireball (or similar): each target emits independently as Toolbelt writes results.
Do not require batch completion first.

### D. IWR / damage

Allow normal damage application — completely unchanged.

### E. NelCine

With NelCine enabled: existing save cinematic unchanged; no duplicate cinematic
from the neutral feed.

### F. Secret save

Private Toolbelt saves must not emit player-facing neutral presentation data.

## Hard stop (audit)

If Toolbelt durable data lacked exact target, save type, and degree → stop.
Lack of natural/modifier alone is **not** a hard stop (confirmed available in
Toolbelt 3.53.1 `TargetSaveInstance`: `die`, `value`, `success`, `modifiers`).
