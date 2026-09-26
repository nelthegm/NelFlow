/**
 * Compact Strike stack grouping regression (0.14.17).
 * Parent identity must stay stable across same-activation Strikes even when
 * combat.turn / Combat._stats.modifiedTime drift (NelTempo / Dynamic Initiative).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  combatStackKey,
  makeDurableTurnMarker,
} from "../scripts/turn-stack-service.js";
import { isActiveCombatStack } from "../scripts/stack-presentation-controller.js";

const root = dirname(fileURLToPath(import.meta.url));
const source = (rel) => readFileSync(join(root, "..", rel), "utf8");

const baseIdentity = (changes = {}) => ({
  combatId: "combat-1",
  round: 1,
  combatantId: "gorewing",
  turnIndex: 0,
  turnMarkerId: "window-1",
  activationSeq: 1,
  attackerTokenUuid: "Scene.s.Token.gorewing",
  authorUserId: "gm1",
  visibilityKey: "visible:public",
  ...changes,
});

describe("0.14.17 durable combat-turn stack grouping", () => {
  it("1-4. same activation: three Strikes share one parent key and message id hash inputs", () => {
    const first = combatStackKey(baseIdentity({ turnIndex: 0 }));
    const second = combatStackKey(baseIdentity({ turnIndex: 1 }));
    const third = combatStackKey(baseIdentity({ turnIndex: 2 }));
    assert.equal(first, second);
    assert.equal(second, third);
    assert.match(first, /^combat-turn\|combat-1\|1\|gorewing\|window-1\|/);
    assert.doesNotMatch(first, /\|0\|window-1\|/); // turnIndex no longer in key
  });

  it("5. row identity remains the transaction id (source contract)", () => {
    assert.match(source("scripts/turn-stack-service.js"), /id:\s*transaction\.id/);
    assert.match(source("scripts/turn-stack-service.js"), /candidate\.id === row\.id/);
  });

  it("6. different NPC attacker token => different stack", () => {
    assert.notEqual(
      combatStackKey(baseIdentity()),
      combatStackKey(baseIdentity({ attackerTokenUuid: "Scene.s.Token.other" })),
    );
  });

  it("7-8. next logical activation / next round => new stack", () => {
    const first = makeDurableTurnMarker(
      { id: "combat-1", round: 1, turn: 0 },
      { id: "gorewing" },
    );
    const afterOther = makeDurableTurnMarker(
      { id: "combat-1", round: 1, turn: 1 },
      { id: "other" },
      { previousMarker: first },
    );
    const gorewingReturns = makeDurableTurnMarker(
      { id: "combat-1", round: 1, turn: 2 },
      { id: "gorewing" },
      { previousMarker: afterOther },
    );
    assert.notEqual(first.markerId, gorewingReturns.markerId);
    assert.equal(afterOther.activationSeq, 2);
    assert.equal(gorewingReturns.activationSeq, 3);

    const nextRound = makeDurableTurnMarker(
      { id: "combat-1", round: 2, turn: 0 },
      { id: "gorewing" },
      { previousMarker: gorewingReturns },
    );
    assert.notEqual(gorewingReturns.markerId, nextRound.markerId);
    assert.notEqual(
      combatStackKey(baseIdentity({ turnMarkerId: first.markerId, round: 1 })),
      combatStackKey(baseIdentity({ turnMarkerId: nextRound.markerId, round: 2 })),
    );
  });

  it("9. out-of-turn different attacker => separate stack", () => {
    assert.notEqual(
      combatStackKey(baseIdentity({ combatantId: "pc1", attackerTokenUuid: "Scene.s.Token.npc-a" })),
      combatStackKey(baseIdentity({ combatantId: "pc1", attackerTokenUuid: "Scene.s.Token.npc-b" })),
    );
  });

  it("10. genuine later activation same round => separate turnMarkerId", () => {
    const a1 = makeDurableTurnMarker({ id: "c", round: 3, turn: 0 }, { id: "a" });
    const b = makeDurableTurnMarker({ id: "c", round: 3, turn: 1 }, { id: "b" }, { previousMarker: a1 });
    const a2 = makeDurableTurnMarker({ id: "c", round: 3, turn: 2 }, { id: "a" }, { previousMarker: b });
    assert.notEqual(a1.markerId, a2.markerId);
  });

  it("11-12. MAP / hit-miss / damage state do not affect parent key", () => {
    const key = combatStackKey(baseIdentity());
    assert.equal(key, combatStackKey(baseIdentity({ turnIndex: 5 })));
    // damage/undo/revision are not key fields — assert they are absent from key builder
    const keySource = source("scripts/turn-stack-service.js");
    const keyFn = keySource.slice(keySource.indexOf("export function combatStackKey"));
    const end = keyFn.indexOf("\n}");
    const body = keyFn.slice(0, end);
    assert.doesNotMatch(body, /damageMessageId|appliedAmount|undoBlocked|revision|updatedAt|results/i);
    assert.doesNotMatch(body, /turnIndex/);
  });

  it("13-18. damage/undo/revision/results/collapse are not parent-key inputs", () => {
    const before = combatStackKey(baseIdentity());
    const after = combatStackKey(baseIdentity({ turnIndex: 99, activationSeq: 1 }));
    assert.equal(before, after);
    const keyFnStart = source("scripts/turn-stack-service.js").indexOf("export function combatStackKey");
    const keyFn = source("scripts/turn-stack-service.js").slice(keyFnStart, keyFnStart + 400);
    assert.doesNotMatch(keyFn, /damageMessageId|appliedAmount|undoBlocked|revision|collapse|keepActive/);
  });

  it("19-20. markerId ignores Combat modifiedTime and turn-index drift", () => {
    const combatA = { id: "c", round: 1, turn: 0, _stats: { modifiedTime: 1000 } };
    const combatB = { id: "c", round: 1, turn: 4, _stats: { modifiedTime: 999999 } };
    const m1 = makeDurableTurnMarker(combatA, { id: "gorewing" });
    const m2 = makeDurableTurnMarker(combatB, { id: "gorewing" }, { previousMarker: m1 });
    assert.equal(m1.markerId, m2.markerId);
    assert.equal(m1.activationSeq, m2.activationSeq);
    const markerFn = source("scripts/turn-stack-service.js");
    const start = markerFn.indexOf("export function makeDurableTurnMarker");
    const body = markerFn.slice(start, start + 900);
    assert.doesNotMatch(body, /_stats|Date\.now\(\)/);
    assert.match(body, /activationSeq/);
  });

  it("21. reload contract: stackRef freeze + deterministic message id (source)", () => {
    const svc = source("scripts/turn-stack-service.js");
    assert.match(svc, /stackRef/);
    assert.match(svc, /keepId:\s*true/);
    assert.match(svc, /game\.messages\.get\(descriptor\.id\)/);
  });

  it("22. enqueue serializes updates per stack key (multi-GM safety)", () => {
    assert.match(source("scripts/turn-stack-service.js"), /function enqueue\(key/);
    assert.match(source("scripts/turn-stack-service.js"), /updateQueues/);
  });

  it("23-24. visibility buckets remain in the parent key", () => {
    assert.notEqual(
      combatStackKey(baseIdentity({ visibilityKey: "visible:public" })),
      combatStackKey(baseIdentity({ visibilityKey: "blind:gm1" })),
    );
    assert.notEqual(
      combatStackKey(baseIdentity({ visibilityKey: "visible:public" })),
      combatStackKey(baseIdentity({ visibilityKey: "visible:user2" })),
    );
  });

  it("NelTempo: same combatant mid-activation turn reshuffle reuses marker", () => {
    const first = makeDurableTurnMarker({ id: "c", round: 2, turn: 0 }, { id: "gorewing" });
    const reshuffled = makeDurableTurnMarker(
      { id: "c", round: 2, turn: 7 },
      { id: "gorewing" },
      { previousMarker: first },
    );
    assert.equal(first.markerId, reshuffled.markerId);
    assert.equal(
      combatStackKey(baseIdentity({ turnMarkerId: first.markerId, turnIndex: 0 })),
      combatStackKey(baseIdentity({ turnMarkerId: reshuffled.markerId, turnIndex: 7 })),
    );
  });

  it("follow: turnIndex drift still follows when durable marker matches", () => {
    const stack = {
      kind: "combat-turn",
      identity: {
        combatId: "c1",
        round: 1,
        combatantId: "g",
        turnIndex: 99,
        turnMarkerId: "marker-a",
      },
    };
    const combat = {
      id: "c1",
      started: true,
      round: 1,
      turn: 0,
      combatant: { id: "g" },
      getFlag: () => ({ markerId: "marker-a" }),
    };
    assert.equal(isActiveCombatStack(stack, combat), true);
  });

  it("follow: stale marker never follows", () => {
    const stack = {
      kind: "combat-turn",
      identity: {
        combatId: "c1",
        round: 1,
        combatantId: "g",
        turnIndex: 0,
        turnMarkerId: "old",
      },
    };
    const combat = {
      id: "c1",
      started: true,
      round: 1,
      turn: 0,
      combatant: { id: "g" },
      getFlag: () => ({ markerId: "marker-a" }),
    };
    assert.equal(isActiveCombatStack(stack, combat), false);
  });

  it("debug identity logging is gated behind SETTINGS.DEBUG", () => {
    assert.match(source("scripts/turn-stack-service.js"), /SETTINGS\.DEBUG/);
    assert.match(source("scripts/turn-stack-service.js"), /Stack identity/);
  });

  it("version metadata is 0.14.18", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.18");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.18");
  });
});
