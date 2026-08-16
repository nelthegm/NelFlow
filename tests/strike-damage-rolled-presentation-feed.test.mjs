/**
 * Three-stage presentation-neutral Strike feed — Stage 2 damage-rolled (0.14.6).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
  STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_PROTOCOL,
  clearStrikePresentationFeedEmissions,
  hasStrikeAttackPresentationFeedEmission,
  hasStrikeDamageRolledPresentationFeedEmission,
  hasStrikePresentationFeedEmission,
  installStrikePresentationFeedApi,
  seedStrikeAttackPresentationFeedEmission,
  seedStrikeDamageRolledPresentationFeedEmission,
  seedStrikePresentationFeedEmission,
  tryEmitStrikeAttackPresentationFeed,
  tryEmitStrikeDamageRolledPresentationFeed,
  tryEmitStrikePresentationFeed,
} from "../scripts/strike-presentation-feed.js";
import { NELCINE_STRIKE_RESOLVED_HOOK } from "../scripts/nelcine-strike-delivery.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function damageArgs(overrides = {}) {
  return {
    transactionId: "nelflow-dmg-001",
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
    damageSummary: { total: 32, components: [{ type: "slashing", total: 32 }] },
    critical: false,
    sceneId: "Scene.s1",
    ...overrides,
  };
}

describe("0.14.6 three-stage Strike presentation feed", () => {
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

  it("1-6. protocol 4 exposes attack, damageRolled, and resolved hooks", () => {
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 4);
    assert.equal(STRIKE_ATTACK_PRESENTATION_FEED_HOOK, "nelflow.strikeAttackResolvedPresentation");
    assert.equal(STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK, "nelflow.strikeDamageRolledPresentation");
    assert.equal(STRIKE_PRESENTATION_FEED_HOOK, "nelflow.strikeResolvedPresentation");
    installStrikePresentationFeedApi();
    const api = game.nelflow.integrations.strikePresentation;
    assert.equal(api.protocol, 4);
    assert.equal(api.attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
    assert.equal(api.damageRolledHook, STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK);
    assert.equal(api.resolvedHook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(api.hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.deepEqual(api.stages, {
      attack: true,
      damageRolled: true,
      damageApplied: true,
      resolved: true,
    });
    assert.equal(api.getStatus().damageRolledHook, STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK);
  });

  it("7-13. PC Stage 2 emits after exact correlation and before application", () => {
    const player = source("scripts/player-strike-service.js");
    assert.match(player, /tryEmitStrikeDamageRolledPresentationFeed\(presentationArgs\)/);
    assert.match(player, /tryEmitStrikePresentationFeed\(presentationArgs\)/);
    assert.match(player, /tryDeliverStrikePresentation\(presentationArgs\)/);

    const damageFn = player.indexOf("async function processDamage");
    const stage2 = player.indexOf("tryEmitStrikeDamageRolledPresentationFeed", damageFn);
    const applying = player.indexOf('TRANSACTION_STATES.APPLYING', damageFn);
    const applyCall = player.indexOf("applyDamageRollToRecordedTarget", damageFn);
    const stage3 = player.indexOf("tryEmitStrikePresentationFeed", damageFn);
    assert.ok(stage2 > damageFn);
    assert.ok(stage2 < applying);
    assert.ok(stage2 < applyCall);
    assert.ok(stage3 > applyCall);

    // Click intent alone must not emit Stage 2.
    assert.doesNotMatch(
      player.slice(player.indexOf("preCreateChatMessage"), player.indexOf("async function processDamage")),
      /tryEmitStrikeDamageRolledPresentationFeed/,
    );
  });

  it("14-18. NPC Stage 2 after rollStrikeDamage success; miss has no Stage 2", () => {
    const resolver = source("scripts/strike-resolver.js");
    const attackIdx = resolver.indexOf("tryEmitStrikeAttackPresentationFeed");
    const rollIdx = resolver.indexOf("await PF2eAdapter.rollStrikeDamage");
    const stage2Idx = resolver.indexOf("tryEmitStrikeDamageRolledPresentationFeed", rollIdx);
    const applyIdx = resolver.indexOf('stage = "apply-damage"');
    assert.ok(attackIdx > 0 && attackIdx < rollIdx);
    assert.ok(stage2Idx > rollIdx);
    assert.ok(stage2Idx < applyIdx);

    // Miss path: failure returns before rollStrikeDamage; no Stage 2 on that branch.
    const missBlock = resolver.slice(
      resolver.indexOf('["failure", "criticalFailure"]'),
      rollIdx,
    );
    assert.doesNotMatch(missBlock, /tryEmitStrikeDamageRolledPresentationFeed/);

    const crit = tryEmitStrikeDamageRolledPresentationFeed(
      damageArgs({
        transactionId: "npc-crit",
        outcome: "criticalSuccess",
        critical: true,
        damageSummary: { total: 64 },
      }),
    );
    assert.equal(crit.emitted, true);
    assert.equal(Hooks.calls[0].payload.critical, true);
    assert.equal(Hooks.calls[0].payload.stage, "damageRolled");
  });

  it("19-28. Stage 2 payload: rolled total, critical, identity, plain JSON", () => {
    const result = tryEmitStrikeDamageRolledPresentationFeed(
      damageArgs({ damageSummary: { total: 30 }, critical: false }),
    );
    assert.equal(result.emitted, true);
    const payload = Hooks.calls[0].payload;
    assert.equal(Hooks.calls[0].hook, STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK);
    assert.equal(payload.stage, "damageRolled");
    assert.equal(payload.transactionId, "nelflow-dmg-001");
    assert.equal(payload.damage.total, 30);
    assert.equal(payload.critical, false);
    assert.equal(payload.attackerTokenUuid, "Scene.s1.Token.a1");
    assert.equal(payload.targetTokenUuid, "Scene.s1.Token.t1");
    assert.equal(payload.actionName, "Longsword");
    assert.equal(payload.sceneId, "Scene.s1");
    JSON.stringify(payload);
    assert.equal(payload.update, undefined);
    assert.equal(typeof payload.damage, "object");

    // Never invent damage when summary missing.
    clearStrikePresentationFeedEmissions();
    Hooks.calls = [];
    const missing = tryEmitStrikeDamageRolledPresentationFeed(
      damageArgs({
        transactionId: "no-dmg",
        damageSummary: undefined,
        includeDamage: false,
      }),
    );
    assert.equal(missing.emitted, false);
    assert.equal(missing.reason, "missing-authoritative-damage");
  });

  it("29-32. Stage 2 uses rolled total; independent of mechanics damageApplied / HP delta", () => {
    tryEmitStrikeDamageRolledPresentationFeed(
      damageArgs({ damageSummary: { total: 30 } }),
    );
    assert.equal(Hooks.calls[0].payload.damage.total, 30);

    const feed = source("scripts/strike-presentation-feed.js");
    // Stage 2 path must not call PF2e applyDamage / mutate HP.
    assert.doesNotMatch(feed, /applyDamageToRecordedTarget|Actor\.update|healthSnapshot\(/);
    assert.match(feed, /nelflow\.strikeDamageAppliedPresentation/);
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
    assert.match(source("scripts/player-strike-service.js"), /emitDamageAppliedFromApplication|applyDamageRollToRecordedTarget/);
  });

  it("33-38. shared transactionId across three stages; independent registries", () => {
    const id = "nelflow-shared-abc";
    assert.equal(tryEmitStrikeAttackPresentationFeed(damageArgs({
      transactionId: id,
      includeDamage: false,
      damageSummary: undefined,
    })).emitted, true);
    assert.equal(tryEmitStrikeDamageRolledPresentationFeed(damageArgs({ transactionId: id })).emitted, true);
    assert.equal(tryEmitStrikePresentationFeed(damageArgs({ transactionId: id })).emitted, true);

    assert.equal(hasStrikeAttackPresentationFeedEmission(id), true);
    assert.equal(hasStrikeDamageRolledPresentationFeedEmission(id), true);
    assert.equal(hasStrikePresentationFeedEmission(id), true);

    assert.deepEqual(
      Hooks.calls.map((c) => c.hook),
      [
        STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
        STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
        STRIKE_PRESENTATION_FEED_HOOK,
      ],
    );
    assert.equal(Hooks.calls[0].payload.transactionId, id);
    assert.equal(Hooks.calls[1].payload.transactionId, id);
    assert.equal(Hooks.calls[2].payload.transactionId, id);
  });

  it("39-42. Stage 2 exactly once; other stage seeds do not block", () => {
    const id = "once-dmg";
    seedStrikeAttackPresentationFeedEmission(id);
    seedStrikePresentationFeedEmission(id);
    const first = tryEmitStrikeDamageRolledPresentationFeed(damageArgs({ transactionId: id }));
    const second = tryEmitStrikeDamageRolledPresentationFeed(damageArgs({ transactionId: id }));
    assert.equal(first.emitted, true);
    assert.equal(second.emitted, false);
    assert.equal(second.reason, "already-emitted");
    assert.equal(
      Hooks.calls.filter((c) => c.hook === STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK).length,
      1,
    );

    seedStrikeDamageRolledPresentationFeedEmission("seeded-dmg");
    assert.equal(
      tryEmitStrikeDamageRolledPresentationFeed(damageArgs({ transactionId: "seeded-dmg" })).emitted,
      false,
    );
  });

  it("43-45. failure / ambiguity / missing roll do not invent Stage 2", () => {
    const player = source("scripts/player-strike-service.js");
    const damageFn = player.indexOf("async function processDamage");
    // Ambiguous / rejected correlation returns before Stage 2 emit.
    const stage2 = player.indexOf("tryEmitStrikeDamageRolledPresentationFeed", damageFn);
    const ambiguous = player.indexOf("DAMAGE_AMBIGUOUS", damageFn);
    assert.ok(ambiguous > damageFn && ambiguous < stage2);

    assert.equal(
      tryEmitStrikeDamageRolledPresentationFeed(
        damageArgs({ transactionId: "empty", damageSummary: { total: Number.NaN } }),
      ).emitted,
      false,
    );
  });

  it("46-49. NelCine delivery untouched by Stage 2", () => {
    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /nelcine\.strikeImpact|tryDeliverStrikePresentation|tryDeliverStrikeImpactSync/);
    assert.doesNotMatch(feed, /Hooks\.callAll\(\s*["']nelflow\.strikeResolved["']/);
    assert.match(source("scripts/nelcine-strike-delivery.js"), /NELCINE_STRIKE_RESOLVED_HOOK/);
    assert.match(source("scripts/nelcine-impact-bridge.js"), /nelcine\.strikeImpact/);

    // Emitting Stage 2 does not deliver NelCine.
    tryEmitStrikeDamageRolledPresentationFeed(damageArgs());
    assert.equal(
      Hooks.calls.filter((c) => c.hook === NELCINE_STRIKE_RESOLVED_HOOK).length,
      0,
    );
  });

  it("50-63. regressions: native PC cards, damageApplied, no extra mechanics", () => {
    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /new Roll\(|Roll\.evaluate|Actor\.update|applyDamage/);
    assert.doesNotMatch(feed, /parseChat|innerHTML|querySelector|DOMParser/);
    assert.match(source("scripts/strike-presentation-mode.js"), /NATIVE_AUGMENTED/);
    assert.match(source("scripts/player-strike-service.js"), /tryEmitStrikeDamageRolledPresentationFeed/);
    assert.match(source("scripts/strike-resolver.js"), /tryEmitStrikeDamageRolledPresentationFeed/);
    assert.match(source("scripts/main.js"), /installStrikePresentationFeedApi/);

    const module = JSON.parse(source("module.json"));
    assert.equal(module.version, "0.14.12");
  });
});
