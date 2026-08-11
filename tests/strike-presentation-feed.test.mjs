/**
 * Presentation-neutral Strike feed tests (NelTactics compatibility).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_PROTOCOL,
  clearStrikePresentationFeedEmissions,
  evaluateStrikePresentationFeedEligibility,
  hasStrikePresentationFeedEmission,
  installStrikePresentationFeedApi,
  seedStrikePresentationFeedEmission,
  tryEmitStrikeAttackPresentationFeed,
  tryEmitStrikePresentationFeed,
} from "../scripts/strike-presentation-feed.js";
import {
  NELCINE_STRIKE_RESOLVED_HOOK,
  clearStrikeDeliveries,
  evaluateStrikePresentationEligibility,
  tryDeliverStrikePresentation,
  tryDeliverStrikeImpactSync,
} from "../scripts/nelcine-strike-delivery.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function baseArgs(overrides = {}) {
  return {
    transactionId: "tx-feed-001",
    outcome: "success",
    dieResult: 17,
    modifier: 24,
    total: 41,
    attackerTokenUuid: "Scene.s1.Token.a1",
    attackerActorUuid: "Actor.a1",
    targetTokenUuid: "Scene.s1.Token.t1",
    targetActorUuid: "Actor.t1",
    actionName: "Longsword",
    itemUuid: "Item.sword",
    includeDamage: true,
    damageSummary: { total: 38, components: [{ type: "slashing", total: 38 }] },
    ...overrides,
  };
}

describe("strike presentation feed", () => {
  beforeEach(() => {
    clearStrikePresentationFeedEmissions();
    clearStrikeDeliveries();
    globalThis.game = {
      user: { isGM: true },
      modules: { get: () => ({ active: false }) },
      nelflow: undefined,
      settings: {
        get: () => false,
      },
    };
    globalThis.Hooks = {
      calls: [],
      callAll(hook, payload) {
        this.calls.push({ hook, payload });
      },
    };
  });

  it("1. neutral hooks exist; protocol 2", () => {
    assert.equal(STRIKE_PRESENTATION_FEED_HOOK, "nelflow.strikeResolvedPresentation");
    assert.equal(STRIKE_ATTACK_PRESENTATION_FEED_HOOK, "nelflow.strikeAttackResolvedPresentation");
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 2);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeResolvedPresentation/);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeAttackResolvedPresentation/);
  });

  it("2. Strike success emits neutral event", () => {
    const result = tryEmitStrikePresentationFeed(baseArgs({ outcome: "success" }));
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls.length, 1);
    assert.equal(Hooks.calls[0].hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, 2);
  });

  it("3. criticalSuccess emits", () => {
    const result = tryEmitStrikePresentationFeed(
      baseArgs({ transactionId: "tx-crit", outcome: "criticalSuccess", dieResult: 20, total: 44 }),
    );
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, 3);
  });

  it("4. failure emits", () => {
    const result = tryEmitStrikePresentationFeed(
      baseArgs({
        transactionId: "tx-fail",
        outcome: "failure",
        includeDamage: false,
        damageSummary: undefined,
      }),
    );
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, 1);
  });

  it("5. criticalFailure emits", () => {
    const result = tryEmitStrikePresentationFeed(
      baseArgs({
        transactionId: "tx-cf",
        outcome: "criticalFailure",
        includeDamage: false,
        damageSummary: undefined,
      }),
    );
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, 0);
  });

  it("6. NelCine absent → neutral event emits", () => {
    globalThis.game.modules = { get: () => null };
    const result = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-no-cine" }));
    assert.equal(result.emitted, true);
  });

  it("7. NelCine inactive → neutral event emits", () => {
    globalThis.game.modules = { get: () => ({ active: false }) };
    const result = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-inactive" }));
    assert.equal(result.emitted, true);
  });

  it("8. nelcineStrikeCinematics false → neutral event emits", () => {
    globalThis.game.settings.get = (_m, key) => {
      if (key === "nelcineStrikeCinematics") return false;
      return false;
    };
    // Feed has no cinematic gate
    assert.equal(
      evaluateStrikePresentationFeedEligibility({
        isGM: true,
        transactionId: "t",
        hasAuthoritativeAttack: true,
      }).eligible,
      true,
    );
    const result = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-cine-off" }));
    assert.equal(result.emitted, true);
  });

  it("9. nelcineImpactSync true → neutral event emits", () => {
    globalThis.game.settings.get = (_m, key) => {
      if (key === "nelcineImpactSync") return true;
      if (key === "nelcineStrikeCinematics") return true;
      return false;
    };
    const result = tryEmitStrikePresentationFeed(
      baseArgs({ transactionId: "tx-impact", impactSyncSelected: true }),
    );
    assert.equal(result.emitted, true);
  });

  it("10. existing NelCine presentation gating unchanged", () => {
    assert.equal(
      evaluateStrikePresentationEligibility({
        settingEnabled: false,
        isGM: true,
        nelcineActive: true,
        transactionId: "t1",
        hasAuthoritativeAttack: true,
      }).reason,
      "setting-disabled",
    );
    assert.equal(
      evaluateStrikePresentationEligibility({
        settingEnabled: true,
        isGM: true,
        nelcineActive: false,
        transactionId: "t1",
        hasAuthoritativeAttack: true,
      }).reason,
      "nelcine-inactive",
    );
  });

  it("11. existing NelCine impact-sync behavior unchanged", () => {
    const broadcasts = [];
    const payload = {
      schemaVersion: 1,
      transactionId: "tx-isync",
      type: "strike",
      attack: { dieResult: 10, modifier: 5, total: 15, degreeOfSuccess: 2 },
      damage: { total: 9 },
    };
    const delivery = tryDeliverStrikeImpactSync({
      transactionId: "tx-isync",
      payload,
      broadcast: (p, opts) => {
        broadcasts.push({ p, opts });
        return Promise.resolve();
      },
    });
    assert.equal(delivery.delivered, true);
    assert.equal(broadcasts.length, 1);
    // Neutral feed is a separate channel — impact sync still one broadcast
    assert.equal(
      Hooks.calls.filter((c) => c.hook === NELCINE_STRIKE_RESOLVED_HOOK).length,
      0,
    );
  });

  it("12. neutral event does not cause duplicate NelCine playback", () => {
    globalThis.game.modules = { get: () => ({ active: true }) };
    globalThis.game.settings.get = (_m, key) => key === "nelcineStrikeCinematics";
    globalThis.game.nelcine = { sync: { isPrimaryGM: () => true } };

    const feed = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-nodupe" }));
    assert.equal(feed.emitted, true);

    // NelCine presentation still requires its own delivery call
    const nelcineCallsBefore = Hooks.calls.filter((c) => c.hook === NELCINE_STRIKE_RESOLVED_HOOK).length;
    assert.equal(nelcineCallsBefore, 0);

    const presented = tryDeliverStrikePresentation(baseArgs({ transactionId: "tx-nodupe" }));
    assert.equal(presented.delivered, true);
    const nelcineCalls = Hooks.calls.filter((c) => c.hook === NELCINE_STRIKE_RESOLVED_HOOK);
    assert.equal(nelcineCalls.length, 1);

    // Second NelCine attempt blocked by existing exactly-once registry
    const again = tryDeliverStrikePresentation(baseArgs({ transactionId: "tx-nodupe" }));
    assert.equal(again.delivered, false);
    assert.equal(Hooks.calls.filter((c) => c.hook === NELCINE_STRIKE_RESOLVED_HOOK).length, 1);
  });

  it("13. exactly one neutral event per transaction", () => {
    const a = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-once" }));
    const b = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-once" }));
    assert.equal(a.emitted, true);
    assert.equal(b.emitted, false);
    assert.equal(b.reason, "already-emitted");
    assert.equal(Hooks.calls.filter((c) => c.hook === STRIKE_PRESENTATION_FEED_HOOK).length, 1);
    assert.equal(hasStrikePresentationFeedEmission("tx-once"), true);
  });

  it("14. two Strike transactions produce two events", () => {
    assert.equal(tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-a" })).emitted, true);
    assert.equal(tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-b" })).emitted, true);
    assert.equal(Hooks.calls.filter((c) => c.hook === STRIKE_PRESENTATION_FEED_HOOK).length, 2);
  });

  it("15. transactionId preserved exactly", () => {
    tryEmitStrikePresentationFeed(baseArgs({ transactionId: "nelflow-stable-id" }));
    assert.equal(Hooks.calls[0].payload.transactionId, "nelflow-stable-id");
  });

  it("16. natural die preserved", () => {
    tryEmitStrikePresentationFeed(baseArgs({ dieResult: 17 }));
    assert.equal(Hooks.calls[0].payload.attack.dieResult, 17);
  });

  it("17. modifier preserved", () => {
    tryEmitStrikePresentationFeed(baseArgs({ modifier: 24 }));
    assert.equal(Hooks.calls[0].payload.attack.modifier, 24);
  });

  it("18. attack total preserved", () => {
    tryEmitStrikePresentationFeed(baseArgs({ total: 41 }));
    assert.equal(Hooks.calls[0].payload.attack.total, 41);
  });

  it("19. degree preserved", () => {
    tryEmitStrikePresentationFeed(baseArgs({ outcome: "criticalSuccess" }));
    assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, 3);
  });

  it("20. damage total preserved when supplied", () => {
    tryEmitStrikePresentationFeed(
      baseArgs({ includeDamage: true, damageSummary: { total: 38 } }),
    );
    assert.equal(Hooks.calls[0].payload.damage.total, 38);
  });

  it("21. Miss does not invent damage", () => {
    tryEmitStrikePresentationFeed(
      baseArgs({
        transactionId: "tx-miss",
        outcome: "failure",
        includeDamage: false,
        damageSummary: { total: 99 },
      }),
    );
    assert.equal(Object.hasOwn(Hooks.calls[0].payload, "damage"), false);
  });

  it("22-27. payload plain-data only; no documents / HTML parse", () => {
    tryEmitStrikePresentationFeed(baseArgs());
    const payload = Hooks.calls[0].payload;
    JSON.stringify(payload);
    assert.equal(typeof payload, "object");
    assert.equal(payload.update, undefined);
    const feedSrc = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feedSrc, /parseChat|message\.content|innerHTML/);
    assert.doesNotMatch(feedSrc, /new Roll\(|Roll\.evaluate/);
    assert.doesNotMatch(feedSrc, /Actor\.update|Token\.update|applyDamage/);
  });

  it("28. no HTML mechanics parsing in feed module", () => {
    const feedSrc = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feedSrc, /querySelector|DOMParser|chat HTML/i);
  });

  it("29-32. event has no mechanical mutation; HP/Undo/impact untouched", () => {
    const feedSrc = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feedSrc, /applyDamage/);
    assert.doesNotMatch(feedSrc, /healthSnapshot/);
    assert.doesNotMatch(feedSrc, /guardedHealthRestore/);
    assert.doesNotMatch(feedSrc, /armPendingImpactCommit|commitStrikeApplication/);
    // Resolver still uses separate NelCine impact path
    const resolver = source("scripts/strike-resolver.js");
    assert.match(resolver, /tryDeliverStrikeImpactSync/);
    assert.match(resolver, /tryEmitStrikePresentationFeed/);
    assert.match(resolver, /tryEmitStrikeAttackPresentationFeed/);
    assert.match(resolver, /deliverResolvedStrikePresentation/);
  });

  it("33-35. Toolbelt / save / other bridges unchanged by feed module", () => {
    const feedSrc = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feedSrc, /Toolbelt|SaveResolver|healing|defeated|broadcastEffect/i);
  });

  it("public API installs strikePresentation integration protocol 2", () => {
    installStrikePresentationFeedApi();
    assert.equal(game.nelflow.integrations.strikePresentation.hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(game.nelflow.integrations.strikePresentation.resolvedHook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(game.nelflow.integrations.strikePresentation.attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
    assert.equal(game.nelflow.integrations.strikePresentation.protocol, 2);
    assert.equal(game.nelflow.integrations.strikePresentation.available, true);
    assert.deepEqual(game.nelflow.integrations.strikePresentation.stages, { attack: true, damage: true });
    assert.equal(typeof game.nelflow.dev.watchStrikePresentationFeed, "function");
    assert.equal(typeof game.nelflow.dev.stopWatchingStrikePresentationFeed, "function");
    assert.equal(game.nelflow.integrations.strikePresentation.getStatus().hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(game.nelflow.integrations.strikePresentation.getStatus().attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
  });

  it("seed / already-emitted gate", () => {
    seedStrikePresentationFeedEmission("seeded");
    const result = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "seeded" }));
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "already-emitted");
  });

  it("throwing listener still counts as emitted once", () => {
    const result = tryEmitStrikePresentationFeed({
      ...baseArgs({ transactionId: "tx-throw" }),
      hooksCallAll: () => {
        throw new Error("boom");
      },
    });
    assert.equal(result.emitted, true);
    assert.equal(result.reason, "listener-failed");
    const again = tryEmitStrikePresentationFeed(baseArgs({ transactionId: "tx-throw" }));
    assert.equal(again.emitted, false);
  });

  it("main wires installStrikePresentationFeedApi", () => {
    assert.match(source("scripts/main.js"), /installStrikePresentationFeedApi/);
  });

  it("impact-sync path emits feed without nelflow.strikeResolved", () => {
    // Source contract: impact path calls tryEmitStrikePresentationFeed + tryDeliverStrikeImpactSync
    const resolver = source("scripts/strike-resolver.js");
    assert.match(resolver, /Impact-sync owns NelCine cinematic delivery|tryEmitStrikePresentationFeed/);
    assert.match(resolver, /tryDeliverStrikeImpactSync/);
    // Comment retained: do not also emit nelflow.strikeResolved on impact path
    assert.match(resolver, /do not also emit nelflow\.strikeResolved/);
  });
});
