/**
 * Strike damageApplied presentation feed (0.14.12 / protocol 4).
 * Actual target damage after PF2e application (HP+temp snapshots). Stage 2
 * rolled semantics remain unchanged.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
  STRIKE_DAMAGE_APPLIED_PRESENTATION_FEED_HOOK,
  STRIKE_DAMAGE_APPLIED_SOURCE,
  STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
  STRIKE_DAMAGE_TEMP_HP_AWARE,
  STRIKE_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_PROTOCOL,
  buildStrikeDamageAppliedPresentationPayload,
  buildStrikeDamageAppliedResultId,
  clearStrikePresentationFeedEmissions,
  deriveActualStrikeHpLoss,
  hasStrikeDamageAppliedPresentationFeedEmission,
  installStrikePresentationFeedApi,
  seedStrikeAttackPresentationFeedEmission,
  seedStrikeDamageAppliedPresentationFeedEmission,
  seedStrikeDamageRolledPresentationFeedEmission,
  seedStrikePresentationFeedEmission,
  tryEmitStrikeAttackPresentationFeed,
  tryEmitStrikeDamageAppliedPresentationFeed,
  tryEmitStrikeDamageRolledPresentationFeed,
  tryEmitStrikePresentationFeed,
} from "../scripts/strike-presentation-feed.js";
import { BASIC_SAVE_PRESENTATION_PROTOCOL } from "../scripts/basic-save-presentation-feed.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function appliedArgs(overrides = {}) {
  return {
    transactionId: "nelflow-applied-001",
    outcome: "success",
    attackerTokenUuid: "Scene.s1.Token.a1",
    attackerActorUuid: "Actor.a1",
    targetTokenUuid: "Scene.s1.Token.t1",
    targetActorUuid: "Actor.t1",
    actionName: "Longsword",
    itemUuid: "Item.sword",
    sceneId: "Scene.s1",
    applied: 30,
    damageSummary: { total: 20 },
    critical: false,
    ...overrides,
  };
}

describe("0.14.12 Strike damageApplied presentation feed", () => {
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

  it("1-6. protocol 4 advertises damageApplied; preserves prior hooks", () => {
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 4);
    assert.equal(STRIKE_ATTACK_PRESENTATION_FEED_HOOK, "nelflow.strikeAttackResolvedPresentation");
    assert.equal(STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK, "nelflow.strikeDamageRolledPresentation");
    assert.equal(STRIKE_DAMAGE_APPLIED_PRESENTATION_FEED_HOOK, "nelflow.strikeDamageAppliedPresentation");
    assert.equal(STRIKE_PRESENTATION_FEED_HOOK, "nelflow.strikeResolvedPresentation");
    installStrikePresentationFeedApi();
    const api = game.nelflow.integrations.strikePresentation;
    assert.equal(api.protocol, 4);
    assert.equal(api.attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
    assert.equal(api.damageRolledHook, STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK);
    assert.equal(api.damageAppliedHook, STRIKE_DAMAGE_APPLIED_PRESENTATION_FEED_HOOK);
    assert.equal(api.resolvedHook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.equal(api.hook, STRIKE_PRESENTATION_FEED_HOOK);
    assert.deepEqual(api.stages, {
      attack: true,
      damageRolled: true,
      damageApplied: true,
      resolved: true,
    });
    const status = api.getStatus();
    assert.equal(status.protocol, 4);
    assert.equal(status.damageAppliedHook, STRIKE_DAMAGE_APPLIED_PRESENTATION_FEED_HOOK);
    assert.equal(status.actualDamageSource, STRIKE_DAMAGE_APPLIED_SOURCE);
    assert.equal(status.tempHpAware, true);
    assert.equal(STRIKE_DAMAGE_TEMP_HP_AWARE, true);
    // Protocol >= 3 consumers still see prior hooks.
    assert.ok(api.protocol >= 3);
    assert.equal(typeof api.damageRolledHook, "string");
  });

  it("7-12. normalization: target, transactionId, damageResultId, applied, rolledTotal", () => {
    const built = buildStrikeDamageAppliedPresentationPayload(appliedArgs());
    assert.equal(built.ok, true);
    const { payload } = built;
    assert.equal(payload.stage, "damageApplied");
    assert.equal(payload.targetTokenUuid, "Scene.s1.Token.t1");
    assert.equal(payload.transactionId, "nelflow-applied-001");
    assert.equal(payload.damageResultId, "nelflow-applied-001:damage-applied");
    assert.equal(payload.damage.applied, 30);
    assert.equal(payload.damage.rolledTotal, 20);
    assert.equal(buildStrikeDamageAppliedResultId("tx-a"), "tx-a:damage-applied");
    JSON.parse(JSON.stringify(payload));
    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /innerHTML|querySelector|DOMParser|parseChat/);
  });

  it("13-14. weakness: rolled 20 / actual 30 publishes applied=30", () => {
    const result = tryEmitStrikeDamageAppliedPresentationFeed(
      appliedArgs({ applied: 30, damageSummary: { total: 20 } }),
    );
    assert.equal(result.emitted, true);
    const payload = Hooks.calls.at(-1).payload;
    assert.equal(payload.damage.applied, 30);
    assert.equal(payload.damage.rolledTotal, 20);
    assert.notEqual(payload.damage.applied, payload.damage.rolledTotal);
  });

  it("15. resistance: rolled 30 / actual 20 publishes applied=20", () => {
    tryEmitStrikeDamageAppliedPresentationFeed(
      appliedArgs({ transactionId: "resist", applied: 20, damageSummary: { total: 30 } }),
    );
    assert.equal(Hooks.calls.at(-1).payload.damage.applied, 20);
  });

  it("16. immunity / zero application publishes applied=0", () => {
    const result = tryEmitStrikeDamageAppliedPresentationFeed(
      appliedArgs({ transactionId: "immune", applied: 0, damageSummary: { total: 20 } }),
    );
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls.at(-1).payload.damage.applied, 0);
  });

  it("17-19. temp HP loss included; mixed; not falsely zero", () => {
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 100, tempHp: 20 },
        postApplication: { hp: 100, tempHp: 0 },
      }),
      20,
    );
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 100, tempHp: 10 },
        postApplication: { hp: 85, tempHp: 0 },
      }),
      25,
    );
    assert.equal(
      deriveActualStrikeHpLoss({
        beforeHp: 100,
        beforeTempHp: 10,
        afterHp: 100,
        afterTempHp: 0,
      }),
      10,
    );
    const result = tryEmitStrikeDamageAppliedPresentationFeed(
      appliedArgs({
        transactionId: "temp-only",
        applied: undefined,
        preApplication: { hp: 100, tempHp: 20 },
        postApplication: { hp: 100, tempHp: 0 },
      }),
    );
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls.at(-1).payload.damage.applied, 20);
  });

  it("20-23. no IWR reimplementation; snapshots are authoritative", () => {
    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /weakness\s*\+|resistance\s*-|iwrCalculate|applyIWR/i);
    assert.match(feed, /hp-temp-snapshots/);
    assert.equal(STRIKE_DAMAGE_APPLIED_SOURCE, "hp-temp-snapshots");
    assert.match(source("scripts/pf2e-adapter.js"), /applyDamage/);
  });

  it("24-27. timing: damageRolled before apply; damageApplied after; same tx; resolved ordered", () => {
    const player = source("scripts/player-strike-service.js");
    const damageFn = player.indexOf("async function processDamage");
    const stage2 = player.indexOf("tryEmitStrikeDamageRolledPresentationFeed", damageFn);
    const applying = player.indexOf("TRANSACTION_STATES.APPLYING", damageFn);
    const stage3 = player.indexOf("tryEmitStrikeDamageAppliedPresentationFeed", damageFn);
    const stage4 = player.indexOf("tryEmitStrikePresentationFeed(presentationArgs)", damageFn);
    assert.ok(stage2 > damageFn && stage2 < applying);
    assert.ok(stage3 > applying && stage3 < stage4);

    const resolver = source("scripts/strike-resolver.js");
    const commit = resolver.indexOf("async function commitStrikeApplication");
    const applyCall = resolver.indexOf("applyDamageToRecordedTarget", commit);
    const appliedEmit = resolver.indexOf("tryEmitStrikeDamageAppliedPresentationFeed", commit);
    assert.ok(appliedEmit > applyCall);

    const id = "timing-tx";
    tryEmitStrikeDamageRolledPresentationFeed({
      transactionId: id,
      targetTokenUuid: "Scene.s1.Token.t1",
      includeDamage: true,
      damageSummary: { total: 20 },
      outcome: "success",
    });
    tryEmitStrikeDamageAppliedPresentationFeed(appliedArgs({ transactionId: id, applied: 30 }));
    tryEmitStrikePresentationFeed({
      transactionId: id,
      targetTokenUuid: "Scene.s1.Token.t1",
      includeDamage: true,
      damageSummary: { total: 20 },
      outcome: "success",
    });
    assert.deepEqual(
      Hooks.calls.map((c) => c.hook),
      [
        STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
        STRIKE_DAMAGE_APPLIED_PRESENTATION_FEED_HOOK,
        STRIKE_PRESENTATION_FEED_HOOK,
      ],
    );
    assert.equal(Hooks.calls[0].payload.transactionId, id);
    assert.equal(Hooks.calls[1].payload.transactionId, id);
    assert.equal(Hooks.calls[2].payload.transactionId, id);
  });

  it("28-29. PC hit emits once; miss emits none (wiring)", () => {
    assert.match(source("scripts/player-strike-service.js"), /tryEmitStrikeDamageAppliedPresentationFeed/);
    const player = source("scripts/player-strike-service.js");
    // Miss path never reaches processDamage Stage 3.
    assert.ok(player.indexOf("tryEmitStrikeAttackPresentationFeed") < player.indexOf("async function processDamage"));
  });

  it("30-31. NPC hit emits from commit; miss has no applied emit on attack-only", () => {
    assert.match(source("scripts/strike-resolver.js"), /tryEmitStrikeDamageAppliedPresentationFeed/);
    const resolver = source("scripts/strike-resolver.js");
    const attackEmit = resolver.indexOf("tryEmitStrikeAttackPresentationFeed");
    const appliedEmit = resolver.indexOf("tryEmitStrikeDamageAppliedPresentationFeed");
    assert.ok(appliedEmit > attackEmit);
    assert.match(resolver, /commitStrikeApplication/);
  });

  it("32-33. zero emitted accurately; missing applied does not fabricate", () => {
    assert.equal(
      tryEmitStrikeDamageAppliedPresentationFeed(
        appliedArgs({ transactionId: "zero-ok", applied: 0 }),
      ).emitted,
      true,
    );
    assert.equal(
      tryEmitStrikeDamageAppliedPresentationFeed(
        appliedArgs({ transactionId: "missing", applied: undefined, preApplication: null }),
      ).emitted,
      false,
    );
  });

  it("34-36. exactly-once dedicated registry; distinct transactions", () => {
    const id = "once-applied";
    seedStrikeAttackPresentationFeedEmission(id);
    seedStrikeDamageRolledPresentationFeedEmission(id);
    seedStrikePresentationFeedEmission(id);
    const first = tryEmitStrikeDamageAppliedPresentationFeed(appliedArgs({ transactionId: id }));
    const second = tryEmitStrikeDamageAppliedPresentationFeed(appliedArgs({ transactionId: id }));
    assert.equal(first.emitted, true);
    assert.equal(second.emitted, false);
    assert.equal(second.reason, "already-emitted");
    assert.equal(hasStrikeDamageAppliedPresentationFeedEmission(id), true);

    seedStrikeDamageAppliedPresentationFeedEmission("seeded-applied");
    assert.equal(
      tryEmitStrikeDamageAppliedPresentationFeed(appliedArgs({ transactionId: "seeded-applied" }))
        .emitted,
      false,
    );

    assert.equal(
      tryEmitStrikeDamageAppliedPresentationFeed(appliedArgs({ transactionId: "other-tx", applied: 5 }))
        .emitted,
      true,
    );
  });

  it("37-38. Undo emits no reverse damageApplied presentation", () => {
    const undo = source("scripts/strike-resolver.js").slice(
      source("scripts/strike-resolver.js").indexOf("static async undoFromMessage"),
    );
    assert.doesNotMatch(undo, /tryEmitStrikeDamageAppliedPresentationFeed/);
    assert.match(source("scripts/strike-resolver.js"), /guardedHealthRestore/);
  });

  it("39-46. mechanics / damageApplied / NelZones / Toolbelt / PC correlation unchanged", () => {
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
    assert.match(source("scripts/pf2e-adapter.js"), /applyDamage/);
    assert.doesNotMatch(source("scripts/strike-presentation-feed.js"), /Actor\.update|setFlag\(/);
    assert.doesNotMatch(source("scripts/strike-presentation-feed.js"), /Toolbelt/);
    assert.match(source("scripts/player-strike-service.js"), /correlatePlayerStrikeDamage|validateCharacterStrikeCorrelation/);
  });

  it("47-50. basic-save protocol 3 unchanged", () => {
    assert.equal(BASIC_SAVE_PRESENTATION_PROTOCOL, 3);
    assert.match(
      source("scripts/basic-save-presentation-feed.js"),
      /BASIC_SAVE_PRESENTATION_PROTOCOL = 3/,
    );
    assert.match(
      source("scripts/basic-save-damage-presentation-feed.js"),
      /nelflow\.basicSaveTargetDamageApplyingPresentation/,
    );
    assert.match(
      source("scripts/basic-save-damage-presentation-feed.js"),
      /nelflow\.basicSaveTargetDamageAppliedPresentation/,
    );
  });

  it("51-57. safety: no Roll, no Actor.update, no float suppress, plain JSON", () => {
    const feed = source("scripts/strike-presentation-feed.js");
    assert.doesNotMatch(feed, /new Roll\(|Roll\.evaluate|Actor\.update|applyDamage/);
    assert.doesNotMatch(feed, /suppressNative|floating.?text|cssText/i);
    assert.doesNotMatch(feed, /rollSaveForTarget|Actor\.setFlag|document\.setFlag/);
    const payload = buildStrikeDamageAppliedPresentationPayload(appliedArgs()).payload;
    assert.equal(typeof payload.damage.applied, "number");
    assert.ok(payload.damage.applied >= 0);
    JSON.parse(JSON.stringify(payload));
  });

  it("overkill uses actual resource loss from snapshots", () => {
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 5, tempHp: 0 },
        postApplication: { hp: 0, tempHp: 0 },
      }),
      5,
    );
  });

  it("version metadata is 0.14.12", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.12");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.12");
    assert.match(
      source("module.json"),
      /releases\/download\/v0\.14\.12\/nelflow\.zip/,
    );
  });

  it("watcher documents damageApplied stage", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /STRIKE DAMAGE APPLIED/);
    assert.match(source("scripts/strike-presentation-feed.js"), /watchStrikePresentationFeed/);
  });
});
