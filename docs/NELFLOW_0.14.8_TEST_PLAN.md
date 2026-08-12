# Nelflow 0.14.8 Test Plan

## Automated

```powershell
npm test
npm run check
npm run package
```

Baseline before slice: **1245** tests at commit `56e482f` / version **0.14.7**.

Focused coverage:

- `tests/toolbelt-3.54-compatibility.test.mjs`
- updated `tests/toolbelt-basic-save.test.mjs` version gate cases

## Manual Foundry acceptance (Forge + Toolbelt 3.54.0)

### A. Ready log

Expect **no** unsupported Toolbelt warning for 3.54.0.

### B. Console

```js
game.nelflow.integrations.strikePresentation.protocol // 3
game.nelflow.integrations.basicSavePresentation.protocol // 1
game.nelflow.dev.getBasicSavePresentationStatus()
// toolbeltVersion: "3.54.0", toolbeltSupported: true, producerAvailable: true
```

### C. NelTactics ready

Expect healthy Strike and basic-save feed status (e.g. available).

### D. Spell + watcher

```js
game.nelflow.dev.watchBasicSavePresentationFeed()
```

Cast an ordinary Toolbelt basic-save spell. Expect `BASIC SAVE TARGET RESULT`
as each target becomes READY.

### E. NelTactics overlay

Expect Reflex / d20 / mod / total / SAVED|FAILED over targets when NelTactics
0.3.0 consumes the feed.

### F. Strike

Verify existing accepted Strike presentation still works.

### G. Damage

Spell damage presentation is out of scope for this repair.
