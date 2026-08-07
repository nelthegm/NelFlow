/**
 * NelCine Strike presentation delivery tests (0.9.1).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NELCINE_STRIKE_RESOLVED_HOOK,
  STRIKE_DELIVERY_PATHS,
  STRIKE_DELIVERY_STATES,
  buildStrikePresentationPayload,
  clearStrikeDeliveries,
  deliverStrikeToNelCine,
  evaluateStrikePresentationEligibility,
  getStrikeDeliveryDiagnostic,
  hasStrikeDelivery,
  isSerializableStrikePayload,
  seedStrikeDelivery,
  skipStrikeDelivery,
  tryDeliverStrikeImpactSync,
  tryDeliverStrikePresentation,
} from "../scripts/nelcine-strike-delivery.js";
import {
  COMMIT_TRIGGERS,
  evaluateNelcineImpactEligibility,
} from "../scripts/nelcine-impact-bridge.js";

const root = dirname(fileURLToPath(import.meta.url));
const resolverSource = readFileSync(join(root, "../scripts/strike-resolver.js"), "utf8");

describe("nelcine strike delivery", () => {
  beforeEach(() => {
    clearStrikeDeliveries();
    globalThis.game = {
      user: { isGM: true },
      modules: { get: () => ({ active: true }) },
      nelcine: { sync: { isPrimaryGM: () => true } },
      settings: {
        get: (_module, key) => {
          if (key === "nelcineStrikeCinematics") return true;
          if (key === "nelcineImpactSync") return false;
          return undefined;
        },
      },
    };
  });

  it("1. presentation setting off emits no cinematic", () => {
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
  });

  it("2-3. NelCine absent/inactive skips without mechanics change", () => {
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

  it("4-5. miss and critical failure payloads omit damage", () => {
    for (const outcome of ["failure", "criticalFailure"]) {
      const built = buildStrikePresentationPayload({
        transactionId: "nelflow-msg",
        outcome,
        attackerActorUuid: "Actor.a",
        targetActorUuid: "Actor.b",
        targetTokenUuid: "Scene.s.Token.t",
        includeDamage: false,
      });
      assert.equal(built.ok, true);
      assert.equal(Object.hasOwn(built.payload, "damage"), false);
      assert.equal(built.payload.transactionId, "nelflow-msg");
    }
  });

  it("6-10. hit payload can include partial damage; zero and missing die remain valid", () => {
    const built = buildStrikePresentationPayload({
      transactionId: "nelflow-hit",
      outcome: "success",
      includeDamage: true,
      damageSummary: { total: 0, components: [{ type: "slashing", total: 0 }] },
      dieResult: null,
      modifier: 5,
      total: 15,
      attackerActorUuid: "Actor.a",
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    });
    assert.equal(built.ok, true);
    assert.equal(built.payload.attack.dieResult, null);
    assert.equal(built.payload.damage.total, 0);
    assert.equal(isSerializableStrikePayload(built.payload), true);
  });

  it("11-13. payload keeps transaction ID, is serializable, has no documents", () => {
    const built = buildStrikePresentationPayload({
      transactionId: "stable-id",
      outcome: "criticalSuccess",
      includeDamage: false,
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    });
    assert.equal(built.payload.transactionId, "stable-id");
    assert.equal(isSerializableStrikePayload(built.payload), true);
    JSON.stringify(built.payload);
  });

  it("14-17. exactly-once delivery; throwing listener does not retry", () => {
    const calls = [];
    const payload = buildStrikePresentationPayload({
      transactionId: "once",
      outcome: "failure",
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    }).payload;
    const first = deliverStrikeToNelCine({
      transactionId: "once",
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      payload,
      hooksCallAll: (hook, data) => {
        calls.push({ hook, data });
        throw new Error("listener boom");
      },
    });
    const second = deliverStrikeToNelCine({
      transactionId: "once",
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      payload,
      hooksCallAll: (hook) => calls.push({ hook }),
    });
    assert.equal(first.delivered, true);
    assert.equal(second.delivered, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hook, NELCINE_STRIKE_RESOLVED_HOOK);
    assert.equal(hasStrikeDelivery("once"), true);
  });

  it("15-16. stack rerender / reload do not replay terminal delivery", () => {
    seedStrikeDelivery({
      transactionId: "term",
      state: STRIKE_DELIVERY_STATES.DELIVERED,
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      createdAt: 1,
      deliveredAt: 2,
      reason: null,
    });
    const result = tryDeliverStrikePresentation({
      transactionId: "term",
      outcome: "success",
      includeDamage: false,
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    });
    assert.equal(result.delivered, false);
  });

  it("18. manual/review terminal hit may emit attack-only once", () => {
    const calls = [];
    globalThis.Hooks = { callAll: (hook, payload) => calls.push({ hook, payload }) };
    const result = tryDeliverStrikePresentation({
      transactionId: "manual-hit",
      outcome: "success",
      includeDamage: false,
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    });
    assert.equal(result.delivered, true);
    assert.equal(Object.hasOwn(calls[0].payload, "damage"), false);
  });

  it("19. multi-target Strike does not emit ordinary cinematic", () => {
    const result = tryDeliverStrikePresentation({
      transactionId: "mt",
      multiTarget: true,
      outcome: "success",
    });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, "multi-target-unsupported");
  });

  it("20. presentation delivery never changes HP (no apply helpers)", () => {
    assert.doesNotMatch(
      readFileSync(join(root, "../scripts/nelcine-strike-delivery.js"), "utf8"),
      /applyDamage|updateActor|hp\s*=/,
    );
  });

  it("21-24. presentation and impact-sync paths are mutually exclusive", () => {
    const payload = buildStrikePresentationPayload({
      transactionId: "xor",
      outcome: "success",
      includeDamage: true,
      damageSummary: { total: 10, components: [] },
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    }).payload;
    const hooks = [];
    const broadcasts = [];
    deliverStrikeToNelCine({
      transactionId: "xor",
      path: STRIKE_DELIVERY_PATHS.IMPACT_SYNC,
      payload,
      broadcast: (data, options) => {
        broadcasts.push({ data, options });
        return Promise.resolve({ ok: true });
      },
      broadcastOptions: { authoritativeImpact: true },
    });
    const second = deliverStrikeToNelCine({
      transactionId: "xor",
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      payload,
      hooksCallAll: (hook) => hooks.push(hook),
    });
    assert.equal(broadcasts.length, 1);
    assert.equal(second.delivered, false);
    assert.equal(hooks.length, 0);
    assert.equal(
      tryDeliverStrikePresentation({
        transactionId: "pres-blocked",
        impactSyncSelected: true,
        outcome: "success",
        targetTokenUuid: "Scene.s.Token.t",
        targetActorUuid: "Actor.b",
      }).reason,
      "impact-sync-owns-delivery",
    );
  });

  it("25-26. broadcast rejection path stays mechanical; late hook cannot second-deliver", () => {
    const payload = buildStrikePresentationPayload({
      transactionId: "bcast",
      outcome: "success",
      targetTokenUuid: "Scene.s.Token.t",
      targetActorUuid: "Actor.b",
    }).payload;
    tryDeliverStrikeImpactSync({
      transactionId: "bcast",
      payload,
      broadcast: () => {
        throw new Error("reject");
      },
    });
    assert.equal(hasStrikeDelivery("bcast"), true);
    assert.equal(
      tryDeliverStrikePresentation({
        transactionId: "bcast",
        outcome: "success",
        targetTokenUuid: "Scene.s.Token.t",
        targetActorUuid: "Actor.b",
      }).delivered,
      false,
    );
  });

  it("27-34. impact sync eligibility regressions remain intact", () => {
    const base = {
      settingEnabled: true,
      isGM: true,
      nelcineActive: true,
      hasBroadcastApi: true,
      hasImpactContract: true,
      isPrimaryGM: true,
      nelcineClientEnabled: true,
      presentationMode: "full",
      canvasReady: true,
      activeSceneId: "sc1",
      targetSceneId: "sc1",
      outcome: "success",
      hasAuthoritativeDamage: true,
      damageTotal: 12,
      supportsDelayedCommit: true,
    };
    assert.equal(evaluateNelcineImpactEligibility(base).eligible, true);
    assert.equal(evaluateNelcineImpactEligibility({ ...base, settingEnabled: false }).reason, "setting-disabled");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, presentationMode: "off" }).reason, "presentation-off");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, nelcineActive: false }).reason, "nelcine-inactive");
    assert.equal(COMMIT_TRIGGERS.IMPACT, "nelcine-impact");
    assert.equal(COMMIT_TRIGGERS.TIMEOUT, "nelflow-timeout");
  });

  it("46-47. durable claim precedes commitStrikeApplication in handleAttackMessage", () => {
    const handle =
      resolverSource.match(/static async handleAttackMessage[\s\S]*?(?=static async undoFromMessage)/)?.[0] ??
      "";
    const claimIdx = handle.indexOf("PF2eAdapter.persistDamageClaim");
    const commitIdx = handle.indexOf("commitStrikeApplication");
    assert.ok(claimIdx >= 0);
    assert.ok(commitIdx >= 0);
    assert.ok(claimIdx < commitIdx);
    assert.match(resolverSource, /PF2eAdapter\.applyDamageToRecordedTarget/);
  });

  it("GM diagnostics omit full payloads", () => {
    seedStrikeDelivery({
      transactionId: "diag",
      state: STRIKE_DELIVERY_STATES.DELIVERED,
      path: STRIKE_DELIVERY_PATHS.PRESENTATION,
      createdAt: 1,
      deliveredAt: 2,
      reason: null,
    });
    const diag = getStrikeDeliveryDiagnostic("diag");
    assert.equal(diag.transactionId, "diag");
    assert.equal(Object.hasOwn(diag, "payload"), false);
    globalThis.game.user.isGM = false;
    assert.equal(getStrikeDeliveryDiagnostic("diag"), null);
  });

  it("skip helper records skipped state", () => {
    skipStrikeDelivery({ transactionId: "skip1", reason: "setting-disabled" });
    assert.equal(hasStrikeDelivery("skip1"), false);
  });
});
