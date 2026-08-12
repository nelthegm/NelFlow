/**
 * Attack-stage presentation-neutral Strike feed (protocol 3 / 0.14.7).
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
  hasStrikeAttackPresentationFeedEmission,
  hasStrikePresentationFeedEmission,
  installStrikePresentationFeedApi,
  seedStrikeAttackPresentationFeedEmission,
  tryEmitStrikeAttackPresentationFeed,
  tryEmitStrikePresentationFeed,
} from "../scripts/strike-presentation-feed.js";
import { NELCINE_STRIKE_RESOLVED_HOOK } from "../scripts/nelcine-strike-delivery.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function attackArgs(overrides = {}) {
  return {
    transactionId: "nelflow-atk-001",
    stage: "attack",
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
    includeDamage: false,
    ...overrides,
  };
}

describe("Strike attack presentation feed", () => {
  beforeEach(() => {
    clearStrikePresentationFeedEmissions();
    globalThis.game = {
      user: { isGM: true },
      modules: { get: () => ({ active: false }) },
      nelflow: undefined,
      settings: { get: () => false },
    };
    globalThis.Hooks = {
      calls: [],
      callAll(hook, payload) {
        this.calls.push({ hook, payload });
      },
    };
  });

  it("1-4. attack hook + protocol 3 + preserves resolved hook", () => {
    assert.equal(STRIKE_ATTACK_PRESENTATION_FEED_HOOK, "nelflow.strikeAttackResolvedPresentation");
    assert.equal(STRIKE_PRESENTATION_FEED_HOOK, "nelflow.strikeResolvedPresentation");
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 3);
    installStrikePresentationFeedApi();
    const api = game.nelflow.integrations.strikePresentation;
    assert.equal(api.protocol, 3);
    assert.equal(api.attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
    assert.equal(api.damageRolledHook, "nelflow.strikeDamageRolledPresentation");
    assert.equal(api.resolvedHook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(api.hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.deepEqual(api.stages, {
      attack: true,
      damageRolled: true,
      resolved: true,
    });
  });

  it("5-9. NPC degrees emit attack; attack precedes resolved in source order", () => {
    for (const [outcome, degree] of [
      ["success", 2],
      ["criticalSuccess", 3],
      ["failure", 1],
      ["criticalFailure", 0],
    ]) {
      clearStrikePresentationFeedEmissions();
      Hooks.calls = [];
      const result = tryEmitStrikeAttackPresentationFeed(
        attackArgs({ transactionId: `npc-${outcome}`, outcome }),
      );
      assert.equal(result.emitted, true);
      assert.equal(Hooks.calls[0].hook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
      assert.equal(Hooks.calls[0].payload.attack.degreeOfSuccess, degree);
      assert.equal(Hooks.calls[0].payload.stage, "attack");
      assert.equal(Object.hasOwn(Hooks.calls[0].payload, "damage"), false);
    }

    const resolver = source("scripts/strike-resolver.js");
    const attackIdx = resolver.indexOf("tryEmitStrikeAttackPresentationFeed");
    const damageIdx = resolver.indexOf("rollStrikeDamage");
    const missResolvedIdx = resolver.indexOf("deliverResolvedStrikePresentation");
    assert.ok(attackIdx > 0);
    assert.ok(attackIdx < damageIdx);
    assert.ok(attackIdx < missResolvedIdx);
  });

  it("10-15. PC attack emits before damage path; miss needs no damage", () => {
    const player = source("scripts/player-strike-service.js");
    assert.match(player, /emitPlayerStrikeAttackPresentation/);
    assert.match(player, /tryEmitStrikeAttackPresentationFeed/);
    // Stage 1 is called from observeAttack before WAITING_FOR_DAMAGE claim work.
    const observeStart = player.indexOf("async function observeAttack");
    const emitCall = player.indexOf("emitPlayerStrikeAttackPresentation", observeStart);
    const claimCall = player.indexOf("claimPlayerStrike", observeStart);
    assert.ok(emitCall > observeStart);
    assert.ok(emitCall < claimCall);

    const miss = tryEmitStrikeAttackPresentationFeed(
      attackArgs({ transactionId: "pc-miss", outcome: "failure" }),
    );
    assert.equal(miss.emitted, true);
    assert.equal(Object.hasOwn(Hooks.calls[0].payload, "damage"), false);
    assert.equal(hasStrikePresentationFeedEmission("pc-miss"), false);

    // Native PC cards / no auto damage roll from attack feed.
    assert.doesNotMatch(source("scripts/strike-presentation-feed.js"), /rollStrikeDamage|DamageButton|compact/);
    assert.doesNotMatch(player, /hideDamage|suppressNative|compactAttackCard/);
  });

  it("16-21. shared transactionId; two strikes; exactly-once per stage", () => {
    const idA = "nelflow-msgA";
    const idB = "nelflow-msgB";
    assert.equal(tryEmitStrikeAttackPresentationFeed(attackArgs({ transactionId: idA })).emitted, true);
    assert.equal(tryEmitStrikeAttackPresentationFeed(attackArgs({ transactionId: idB })).emitted, true);
    assert.equal(tryEmitStrikeAttackPresentationFeed(attackArgs({ transactionId: idA })).emitted, false);
    assert.equal(tryEmitStrikePresentationFeed(attackArgs({
      transactionId: idA,
      includeDamage: true,
      damageSummary: { total: 22 },
    })).emitted, true);
    assert.equal(tryEmitStrikePresentationFeed(attackArgs({
      transactionId: idB,
      includeDamage: true,
      damageSummary: { total: 18 },
    })).emitted, true);
    assert.equal(tryEmitStrikePresentationFeed(attackArgs({
      transactionId: idA,
      includeDamage: true,
      damageSummary: { total: 22 },
    })).emitted, false);

    const hooks = Hooks.calls.map((c) => `${c.hook}:${c.payload.transactionId}`);
    assert.deepEqual(hooks, [
      `${STRIKE_ATTACK_PRESENTATION_FEED_HOOK}:${idA}`,
      `${STRIKE_ATTACK_PRESENTATION_FEED_HOOK}:${idB}`,
      `${STRIKE_PRESENTATION_FEED_HOOK}:${idA}`,
      `${STRIKE_PRESENTATION_FEED_HOOK}:${idB}`,
    ]);
    assert.equal(hasStrikeAttackPresentationFeedEmission(idA), true);
    assert.equal(hasStrikePresentationFeedEmission(idA), true);

    seedStrikeAttackPresentationFeedEmission("seeded-atk");
    assert.equal(
      tryEmitStrikeAttackPresentationFeed(attackArgs({ transactionId: "seeded-atk" })).emitted,
      false,
    );

    // Deterministic id strategy uses attack message id — not timestamps.
    assert.match(source("scripts/player-strike-service.js"), /TransactionStore\.deterministicId\(message\)/);
    assert.match(source("scripts/transaction-store.js"), /nelflow-\$\{attackMessage\.id\}|\$\{MODULE_ID\}-\$\{attackMessage\.id\}/);
    assert.doesNotMatch(source("scripts/strike-presentation-feed.js"), /Date\.now\(\).*transactionId|transactionId.*Date\.now/);
  });

  it("22-30. attack payload fields; no invented damage; plain JSON", () => {
    const result = tryEmitStrikeAttackPresentationFeed(attackArgs());
    assert.equal(result.emitted, true);
    const payload = Hooks.calls[0].payload;
    assert.equal(payload.attack.dieResult, 17);
    assert.equal(payload.attack.modifier, 24);
    assert.equal(payload.attack.total, 41);
    assert.equal(payload.attack.degreeOfSuccess, 2);
    assert.equal(payload.attackerTokenUuid, "Scene.s1.Token.a1");
    assert.equal(payload.targetTokenUuid, "Scene.s1.Token.t1");
    assert.equal(payload.actionName, "Longsword");
    assert.equal(payload.itemUuid, "Item.sword");
    assert.equal(Object.hasOwn(payload, "damage"), false);
    assert.equal(payload.stage, "attack");
    JSON.stringify(payload);
  });

  it("31-34. miss attack events; no fake damage; final not required", () => {
    for (const id of ["pc-fail", "npc-fail"]) {
      clearStrikePresentationFeedEmissions();
      Hooks.calls = [];
      assert.equal(
        tryEmitStrikeAttackPresentationFeed(attackArgs({ transactionId: id, outcome: "failure" })).emitted,
        true,
      );
      assert.equal(Object.hasOwn(Hooks.calls[0].payload, "damage"), false);
      assert.equal(hasStrikePresentationFeedEmission(id), false);
    }
  });

  it("35-50. regression contracts", () => {
    assert.equal(STRIKE_PRESENTATION_FEED_HOOK, "nelflow.strikeResolvedPresentation");
    assert.equal(NELCINE_STRIKE_RESOLVED_HOOK, "nelflow.strikeResolved");
    assert.notEqual(STRIKE_ATTACK_PRESENTATION_FEED_HOOK, NELCINE_STRIKE_RESOLVED_HOOK);

    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /Hooks\.callAll\(\s*["']nelflow\.strikeResolved["']/);
    assert.doesNotMatch(feed, /applyDamage|Actor\.update|Roll\.evaluate|parseChat|innerHTML/);
    assert.doesNotMatch(feed, /savingThrow|healPresentation|defeated|NelZones/i);

    const player = source("scripts/player-strike-service.js");
    assert.match(player, /tryEmitStrikePresentationFeed/);
    assert.match(player, /processDamage/);
    assert.doesNotMatch(player, /Hooks\.callAll\(\s*["']nelflow\.strikeResolved["']/);

    const resolver = source("scripts/strike-resolver.js");
    assert.match(resolver, /tryDeliverStrikeImpactSync/);
    assert.match(resolver, /nelflow\.strikeResolved|tryDeliverStrikePresentation/);

    const module = JSON.parse(source("module.json"));
    assert.equal(module.version, "0.14.8");
  });
});
