# Nelflow 0.14.4 runtime test plan

Run with Foundry generation 14, published Nelflow **0.14.4**, and NelTactics
**0.1.1** (optional but required for the consumer checks below). Preserve the
full 0.14.3 native PC Strike checklist as a regression gate.

## Test 0 — Install / capability

1. Update via Foundry using:

```text
https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json
```

2. Confirm:

```js
game.modules.get("nelflow")?.version
// "0.14.4"

game.nelflow.integrations.strikePresentation.getStatus()
// protocol: 1
// hook: "nelflow.strikeResolvedPresentation"
// available: true
```

3. With NelTactics 0.1.1 enabled:

```js
game.neltactics.integrationStatus()
// nelFlowAvailable: true
// strikeFeedAvailable: true
// strikeFeedHook: "nelflow.strikeResolvedPresentation"
// strikeFeedProtocol: 1
```

4. Enable the feed watcher:

```js
game.nelflow.dev.watchStrikePresentationFeed()
```

## Test 1 — NPC Strike hit

Make a real NPC single-target Strike that applies damage.

Expected:

- one `STRIKE FEED` diagnostic
- one NelTactics presentation
- NPC compact stack unchanged
- no duplicate HP application

## Test 2 — Character Strike + native Damage

Make a real character Strike and click PF2e’s native Damage control.

Expected:

- native PF2e attack card remains intact
- native PF2e damage card remains intact
- one Applied / HP / Undo footer only
- one neutral feed event
- one NelTactics presentation
- no duplicated damage roll or application

## Test 3 — Miss

Produce an authoritative Miss (NPC skip path at minimum).

Expected:

- neutral feed emits with failure / criticalFailure degree
- NelTactics shows d20 / math / MISS
- no invented damage total

## Test 4 — Critical hit

Produce a critical success with authoritative damage.

Expected:

- one feed event
- one NelTactics tactical presentation
- `damage.total` matches the authoritative Strike damage display value

## Test 5 — Second Strike same turn

Resolve a second unique Strike.

Expected:

- second unique feed event (`transactionId` differs)
- NelTactics queue handles it

## Test 6 — End Turn

End the turn after a lingering NelTactics result.

Expected:

- NelTactics clears independently
- Nelflow does not invent End Turn presentation hooks for this feed

## Test 7 — NelCine regression

A. Cinematics ON, impact sync OFF → existing NelCine presentation exactly once; neutral feed also emits once  
B. Cinematics OFF → no NelCine presentation; neutral feed still emits  
C. Impact sync ON → existing impact-sync path once; neutral feed once; no duplicate NelCine Strike  
D. NelCine absent → neutral feed still emits; mechanics unaffected

## Test 8 — NelZones / damageApplied

Confirm `nelflow.damageApplied` still fires exactly once per correlated application
with unchanged protocol and fire/cold classification inputs.

## Test 9 — 0.14.3 native PC regression

Re-run Tests 1–8 from `docs/NELFLOW_0.14.3_TEST_PLAN.md`. No character stacks,
no hidden native cards, no replacement Damage buttons.
