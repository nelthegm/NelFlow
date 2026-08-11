# Nelflow 0.14.5 runtime test plan

Run with Foundry generation 14, published Nelflow **0.14.5**, and optionally
NelTactics (consumer only — do not modify NelTactics for this release).

## Integration status

```js
game.modules.get("nelflow")?.version // "0.14.5"
game.nelflow.integrations.strikePresentation.getStatus()
// protocol: 2
// attackHook: "nelflow.strikeAttackResolvedPresentation"
// resolvedHook / hook: "nelflow.strikeResolvedPresentation"
game.nelflow.dev.watchStrikePresentationFeed()
```

## A. Player hit

1. Roll a PC Strike.
2. **Before** clicking Damage, watcher must show `STRIKE ATTACK <id>`.
3. Wait several seconds — attack-stage event must already exist.
4. Click Damage → `STRIKE RESOLVED <same-id>`.

## B. Player miss

1. Roll a miss.
2. Expect `STRIKE ATTACK` immediately.
3. No damage click required. No fake damage.

## C. Two attacks before damage

1. Roll Attack A, then Attack B.
2. Watcher: `ATTACK A`, `ATTACK B`.
3. Click Damage for A → `RESOLVED A`.
4. Click Damage for B → `RESOLVED B`.
5. IDs must correlate correctly.

## D. NPC Strike

1. Expect `ATTACK` immediately after the attack resolves.
2. Expect final/resolved if damage occurs (or existing miss skip path).

## E. Native PC cards

Attack card stays full native PF2e. Damage/Critical Damage buttons remain.
NelFlow still only adds the application/Undo footer after silent apply.

## F. NelCine / NelZones

`nelflow.strikeResolved` and impact-sync unchanged.
`nelflow.damageApplied` unchanged.
