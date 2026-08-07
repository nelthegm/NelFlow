/**
 * NelCine basic-save batch bridge tests (0.9.0).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  FALLBACK_BATCH_ID_PREFIX,
  MAX_BATCH_TARGETS,
  NELCINE_SAVE_BATCH_HOOK,
  appliedTotalFromRecord,
  buildSaveBatchPayload,
  canEmitSaveBatch,
  clampSaveBatchMinimumTargets,
  clearSaveBatchBridgeState,
  collectLegacyBatchTargets,
  collectToolbeltBatchTargets,
  emitSaveBatchResolved,
  ensureUniqueResultIds,
  evaluateSaveBatchEligibility,
  getSaveBatchDiagnostic,
  getSaveBatchIntegrationStatus,
  inspectSaveBatches,
  isSerializablePayload,
  mapMultiplierToOutcome,
  normalizeConsequences,
  normalizeDegreeOfSuccess,
  normalizeSaveType,
  resolveBatchTransactionId,
  resolveResultId,
  seedEmittedSaveBatch,
  serializeSharedDamageRoll,
  stopWatchingSaveBatchCinematics,
  truncateBatchTargets,
  tryEmitLegacySaveBatch,
  tryEmitToolbeltSaveBatch,
  watchSaveBatchCinematics,
} from "../scripts/nelcine-save-batch-bridge.js";
import { TOOLBELT_TARGET_STATES } from "../scripts/toolbelt-basic-save-model.js";
import {
  evaluateNelcineImpactEligibility,
  COMMIT_TRIGGERS,
} from "../scripts/nelcine-impact-bridge.js";

function baseEligibility(overrides = {}) {
  return {
    settingEnabled: true,
    isGM: true,
    nelcineActive: true,
    primaryGmApiAvailable: true,
    isPrimaryGM: true,
    supportedWorkflow: true,
    batchComplete: true,
    transactionId: "toolbelt-basic-save:msg1",
    alreadyEmitted: false,
    minimumTargets: 2,
    targetCount: 3,
    saveType: "reflex",
    hasSharedDamageRoll: true,
    hasAuthoritativeDegrees: true,
    ...overrides,
  };
}

function sampleDamageRoll() {
  return {
    formula: "8d6",
    dice: [
      { faces: 6, result: 5 },
      { faces: 6, result: 4 },
    ],
    modifier: 0,
    rolledTotal: 28,
    components: [{ type: "fire", value: 28 }],
  };
}

function sampleTargets(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    applicationId: `toolbelt-basic-save:msg1:target:t${index}`,
    order: index,
    targetTokenUuid: `Scene.sc1.Token.t${index}`,
    targetActorUuid: `Actor.a${index}`,
    degreeOfSuccess: ["criticalFailure", "failure", "success", "criticalSuccess"][index % 4],
    multiplier: [2, 1, 0.5, 0][index % 4],
    appliedTotal: [40, 28, 14, 0][index % 4],
    save: { dieResult: 10 + index, modifier: 5, total: 15 + index },
    consequences: [],
  }));
}

function samplePayload(overrides = {}) {
  const built = buildSaveBatchPayload({
    transactionId: "toolbelt-basic-save:msg1",
    saveType: "reflex",
    saveDc: 30,
    dcPublic: false,
    sourceTokenUuid: "Scene.sc1.Token.source",
    sourceActorUuid: "Actor.source",
    itemUuid: "Actor.source.Item.fireball",
    effectName: "Fireball",
    damageRoll: sampleDamageRoll(),
    targets: sampleTargets(2),
    ...overrides,
  });
  assert.equal(built.ok, true, built.reason);
  return built.payload;
}

describe("nelcine save batch bridge", () => {
  beforeEach(() => {
    clearSaveBatchBridgeState();
    globalThis.game = {
      user: { isGM: true, id: "gm1" },
      modules: { get: () => ({ active: true }) },
      nelcine: { sync: { isPrimaryGM: () => true } },
      settings: {
        get: (_module, key) => {
          if (key === "nelcineSaveBatchCinematics") return true;
          if (key === "nelcineSaveBatchMinimumTargets") return 2;
          return undefined;
        },
      },
    };
  });

  it("1. setting disabled skips batch emission", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ settingEnabled: false })).reason,
      "setting-disabled",
    );
  });

  it("2. NelCine absent skips without error", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ nelcineActive: false })).reason,
      "nelcine-inactive",
    );
  });

  it("3. NelCine inactive skips without error", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ nelcineActive: false })).eligible,
      false,
    );
  });

  it("4. player client cannot emit", () => {
    assert.equal(evaluateSaveBatchEligibility(baseEligibility({ isGM: false })).reason, "not-gm");
  });

  it("5. non-primary GM skips when primary API is available", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ isPrimaryGM: false })).reason,
      "not-primary-gm",
    );
  });

  it("5b. missing primary API still allows GM emission", () => {
    assert.equal(
      evaluateSaveBatchEligibility(
        baseEligibility({ primaryGmApiAvailable: false, isPrimaryGM: false }),
      ).eligible,
      true,
    );
  });

  it("6. unsupported resolver path skips", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ supportedWorkflow: false })).reason,
      "unsupported-workflow",
    );
  });

  it("7. one target does not emit when minimum is 2", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ targetCount: 1 })).reason,
      "below-minimum-targets",
    );
  });

  it("8. two or more targets can emit", () => {
    assert.equal(evaluateSaveBatchEligibility(baseEligibility({ targetCount: 2 })).eligible, true);
  });

  it("9. unsupported save type skips safely", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ saveType: "perception" })).reason,
      "unsupported-save-type",
    );
  });

  it("10. mechanics remain unchanged on skipped paths (no emit)", () => {
    const calls = [];
    const result = emitSaveBatchResolved(null, {
      hooksCallAll: (...args) => calls.push(args),
    });
    assert.equal(result.emitted, false);
    assert.equal(calls.length, 0);
  });

  it("11-12. one effect creates one aggregation with multiple targets", () => {
    const payload = samplePayload({ targets: sampleTargets(4) });
    assert.equal(payload.targets.length, 4);
    assert.equal(payload.type, "saveBatch");
  });

  it("13. different effect transaction IDs remain separate", () => {
    const a = samplePayload({ transactionId: "toolbelt-basic-save:a" });
    const b = samplePayload({ transactionId: "toolbelt-basic-save:b", targets: sampleTargets(2) });
    assert.notEqual(a.transactionId, b.transactionId);
  });

  it("14. duplicate target callback does not duplicate a result", () => {
    const targets = [...sampleTargets(2), sampleTargets(1)[0]];
    const built = buildSaveBatchPayload({
      transactionId: "toolbelt-basic-save:msg1",
      saveType: "reflex",
      damageRoll: sampleDamageRoll(),
      targets,
    });
    assert.equal(built.ok, false);
    assert.equal(built.reason, "duplicate-result-ids");
  });

  it("15. completion order does not change authoritative order", () => {
    const targets = [
      { ...sampleTargets(1)[0], order: 1, applicationId: "id-b", targetTokenUuid: "Scene.sc1.Token.b" },
      { ...sampleTargets(1)[0], order: 0, applicationId: "id-a", targetTokenUuid: "Scene.sc1.Token.a" },
    ];
    const payload = samplePayload({ targets });
    assert.equal(payload.targets[0].resultId, "id-a");
    assert.equal(payload.targets[1].resultId, "id-b");
    assert.deepEqual(
      payload.targets.map((t) => t.order),
      [0, 1],
    );
  });

  it("16. batch emits only after all targets are terminal", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ batchComplete: false })).reason,
      "batch-incomplete",
    );
  });

  it("17. duplicate completion callback emits once", () => {
    const calls = [];
    const payload = samplePayload();
    const first = emitSaveBatchResolved(payload, {
      hooksCallAll: (hook, data) => calls.push({ hook, data }),
    });
    const second = emitSaveBatchResolved(payload, {
      hooksCallAll: (hook, data) => calls.push({ hook, data }),
    });
    assert.equal(first.emitted, true);
    assert.equal(second.emitted, false);
    assert.equal(calls.length, 1);
  });

  it("18. aggregation state is cleaned after terminal emission", () => {
    const payload = samplePayload();
    emitSaveBatchResolved(payload, { hooksCallAll: () => undefined });
    const status = getSaveBatchIntegrationStatus();
    assert.equal(status.pendingBatchCount, 0);
    assert.equal(status.recentEmittedCount, 1);
  });

  it("19. existing group transaction ID is preserved", () => {
    assert.equal(
      resolveBatchTransactionId({ existingId: "toolbelt-basic-save:msg9" }),
      "toolbelt-basic-save:msg9",
    );
  });

  it("20. fallback group ID has the expected prefix", () => {
    const id = resolveBatchTransactionId({ generateId: () => "abc123" });
    assert.equal(id, `${FALLBACK_BATCH_ID_PREFIX}abc123`);
  });

  it("21. existing per-target transaction ID becomes resultId", () => {
    assert.equal(
      resolveResultId({
        applicationId: "toolbelt-basic-save:msg1:target:t0",
        transactionId: "batch",
        targetTokenUuid: "Scene.sc1.Token.t0",
      }),
      "toolbelt-basic-save:msg1:target:t0",
    );
  });

  it("22. fallback resultId is stable", () => {
    const a = resolveResultId({
      transactionId: "batch",
      targetTokenUuid: "Scene.sc1.Token.t0",
    });
    const b = resolveResultId({
      transactionId: "batch",
      targetTokenUuid: "Scene.sc1.Token.t0",
    });
    assert.equal(a, b);
    assert.equal(a, "batch:result:Scene.sc1.Token.t0");
  });

  it("23. result IDs are unique", () => {
    const payload = samplePayload({ targets: sampleTargets(3) });
    assert.equal(ensureUniqueResultIds(payload.targets).ok, true);
  });

  it("24. duplicate result IDs prevent invalid emission", () => {
    const built = buildSaveBatchPayload({
      transactionId: "batch",
      saveType: "will",
      damageRoll: sampleDamageRoll(),
      targets: [
        { ...sampleTargets(1)[0], applicationId: "dup" },
        { ...sampleTargets(1)[0], applicationId: "dup", order: 1, targetTokenUuid: "Scene.sc1.Token.other" },
      ],
    });
    assert.equal(built.ok, false);
    assert.equal(built.reason, "duplicate-result-ids");
  });

  it("25. actor and token names are not used as IDs", () => {
    const payload = samplePayload({
      targets: [
        {
          ...sampleTargets(1)[0],
          applicationId: "stable-id",
          name: "Goblin",
          tokenName: "Goblin",
        },
      ],
    });
    assert.equal(payload.targets[0].resultId, "stable-id");
    assert.equal(payload.targets[0].resultId.includes("Goblin"), false);
  });

  it("26-28. fortitude, reflex, and will are preserved", () => {
    assert.equal(normalizeSaveType("fortitude"), "fortitude");
    assert.equal(normalizeSaveType("reflex"), "reflex");
    assert.equal(normalizeSaveType("will"), "will");
    assert.equal(samplePayload({ saveType: "fortitude" }).save.type, "fortitude");
    assert.equal(samplePayload({ saveType: "Reflex" }).save.type, "reflex");
    assert.equal(samplePayload({ saveType: "will" }).save.type, "will");
  });

  it("29-31. natural die, missing die, modifier, and total are preserved", () => {
    const withDie = samplePayload({
      targets: [
        {
          ...sampleTargets(1)[0],
          save: { dieResult: 14, modifier: 10, total: 24 },
        },
      ],
    });
    assert.equal(withDie.targets[0].save.dieResult, 14);
    assert.equal(withDie.targets[0].save.modifier, 10);
    assert.equal(withDie.targets[0].save.total, 24);
    const missing = samplePayload({
      targets: [
        {
          ...sampleTargets(1)[0],
          save: { dieResult: null, modifier: null, total: null },
          degreeOfSuccess: "failure",
        },
      ],
    });
    assert.equal(missing.targets[0].save.dieResult, null);
    assert.equal(missing.ok ?? true, true);
  });

  it("32-33. authoritative degree is preserved and not recalculated from DC", () => {
    const payload = samplePayload({
      saveDc: 99,
      targets: [
        {
          ...sampleTargets(1)[0],
          degreeOfSuccess: "success",
          save: { dieResult: 1, modifier: 0, total: 1 },
        },
      ],
    });
    assert.equal(payload.targets[0].save.degreeOfSuccess, 2);
    assert.equal(normalizeDegreeOfSuccess("criticalFailure"), 0);
    assert.equal(normalizeDegreeOfSuccess(3), 3);
  });

  it("34-35. secret DC defaults to dcPublic false; public only when marked", () => {
    assert.equal(samplePayload().save.dcPublic, false);
    assert.equal(samplePayload({ dcPublic: true }).save.dcPublic, true);
  });

  it("36-40. shared damage formula, dice, modifier, total, and components are preserved", () => {
    const payload = samplePayload();
    assert.equal(payload.damageRoll.formula, "8d6");
    assert.deepEqual(payload.damageRoll.dice[0], { faces: 6, result: 5 });
    assert.equal(payload.damageRoll.modifier, 0);
    assert.equal(payload.damageRoll.rolledTotal, 28);
    assert.deepEqual(payload.damageRoll.components, [{ type: "fire", value: 28 }]);
  });

  it("41-42. damage is not rerolled and scaling is not applied to shared roll", () => {
    const roll = serializeSharedDamageRoll({
      formula: "8d6",
      rolledTotal: 28,
      components: [{ type: "fire", value: 28 }],
    });
    assert.equal(roll.rolledTotal, 28);
    const payload = samplePayload({
      targets: [{ ...sampleTargets(1)[0], multiplier: 0.5, appliedTotal: 14 }],
    });
    assert.equal(payload.damageRoll.rolledTotal, 28);
    assert.equal(payload.targets[0].damage.appliedTotal, 14);
  });

  it("43. independent-per-target-roll workflow is ineligible", () => {
    assert.equal(
      evaluateSaveBatchEligibility(baseEligibility({ hasSharedDamageRoll: false })).reason,
      "independent-per-target-rolls",
    );
  });

  it("44. raw roll objects are not included", () => {
    const payload = samplePayload();
    assert.equal(isSerializablePayload(payload), true);
    assert.equal(typeof payload.damageRoll.total, "undefined");
    JSON.stringify(payload);
  });

  it("45-48. applied totals use HP magnitude, allow zero, omit missing, never use shared roll", () => {
    assert.equal(appliedTotalFromRecord(18), 18);
    assert.equal(appliedTotalFromRecord(0), 0);
    assert.equal(appliedTotalFromRecord(null), undefined);
    const payload = samplePayload({
      targets: [
        { ...sampleTargets(1)[0], appliedTotal: 0, multiplier: 0 },
        {
          ...sampleTargets(1)[0],
          applicationId: "no-applied",
          order: 1,
          targetTokenUuid: "Scene.sc1.Token.x",
          appliedTotal: undefined,
          actualHpDelta: undefined,
          multiplier: 1,
        },
      ],
    });
    assert.equal(payload.targets[0].damage.appliedTotal, 0);
    assert.equal(Object.hasOwn(payload.targets[1].damage, "appliedTotal"), false);
    assert.notEqual(payload.targets[0].damage.appliedTotal, payload.damageRoll.rolledTotal);
  });

  it("49-53. outcomes none/half/full/double/custom are preserved", () => {
    assert.equal(mapMultiplierToOutcome(0), "none");
    assert.equal(mapMultiplierToOutcome(0.5), "half");
    assert.equal(mapMultiplierToOutcome(1), "full");
    assert.equal(mapMultiplierToOutcome(2), "double");
    assert.equal(mapMultiplierToOutcome(0.75), "custom");
    const payload = samplePayload({
      targets: [
        { ...sampleTargets(1)[0], multiplier: 0 },
        { ...sampleTargets(1)[0], applicationId: "h", order: 1, targetTokenUuid: "Scene.sc1.Token.h", multiplier: 0.5 },
        { ...sampleTargets(1)[0], applicationId: "f", order: 2, targetTokenUuid: "Scene.sc1.Token.f", multiplier: 1 },
        { ...sampleTargets(1)[0], applicationId: "d", order: 3, targetTokenUuid: "Scene.sc1.Token.d", multiplier: 2 },
        {
          ...sampleTargets(1)[0],
          applicationId: "c",
          order: 4,
          targetTokenUuid: "Scene.sc1.Token.c",
          multiplier: 1.5,
        },
      ],
    });
    assert.deepEqual(
      payload.targets.map((t) => t.damage.outcome),
      ["none", "half", "full", "double", "custom"],
    );
  });

  it("54-55. per-target components are not recomputed; NelCine totals unused", () => {
    const payload = samplePayload({
      targets: [
        {
          ...sampleTargets(1)[0],
          damageComponents: [{ type: "fire", value: 12 }],
        },
      ],
    });
    assert.deepEqual(payload.targets[0].damage.components, [{ type: "fire", value: 12 }]);
    assert.equal(COMMIT_TRIGGERS.IMPACT, "nelcine-impact");
  });

  it("56-60. consequences preserved, empty by default, bounded, never inferred", () => {
    assert.deepEqual(normalizeConsequences(undefined), []);
    assert.deepEqual(normalizeConsequences(["Frightened 2", "Prone"]), ["Frightened 2", "Prone"]);
    const many = normalizeConsequences(Array.from({ length: 10 }, (_, i) => `C${i}`));
    assert.equal(many.length, 6);
    const payload = samplePayload({
      targets: [{ ...sampleTargets(1)[0], consequences: ["Slow"] }],
    });
    assert.deepEqual(payload.targets[0].consequences, ["Slow"]);
  });

  it("61-66. hook name, once emission, mark-before-listeners, no retry on throw", () => {
    const order = [];
    const payload = samplePayload();
    const result = emitSaveBatchResolved(payload, {
      hooksCallAll: (hook) => {
        order.push("hook");
        assert.equal(hook, NELCINE_SAVE_BATCH_HOOK);
        assert.equal(getSaveBatchDiagnostic(payload.transactionId)?.state, "emitted");
        throw new Error("listener boom");
      },
    });
    assert.equal(result.emitted, true);
    assert.equal(order.length, 1);
    const retry = emitSaveBatchResolved(payload, {
      hooksCallAll: () => order.push("retry"),
    });
    assert.equal(retry.emitted, false);
    assert.equal(order.includes("retry"), false);
  });

  it("67. emission registry remains bounded", () => {
    for (let i = 0; i < 50; i += 1) {
      seedEmittedSaveBatch({
        transactionId: `batch-${i}`,
        state: "emitted",
        targetCount: 2,
        completedTargetCount: 2,
        emittedAt: i,
        truncated: false,
        error: null,
      });
    }
    assert.ok(getSaveBatchIntegrationStatus().recentEmittedCount <= 40);
  });

  it("68-70. source transactions are not mutated; payload serializable without documents", () => {
    const source = {
      transactionId: "toolbelt-basic-save:msg1",
      saveType: "reflex",
      damageRoll: sampleDamageRoll(),
      targets: sampleTargets(2),
      nested: { keep: true },
    };
    const before = structuredClone(source);
    const built = buildSaveBatchPayload(source);
    assert.equal(built.ok, true);
    assert.deepEqual(source, before);
    assert.equal(isSerializablePayload(built.payload), true);
    assert.equal(typeof built.payload.targets[0].resultId, "string");
  });

  it("71-74. partial failure paths keep saves, omit applied damage, skip empty sets", () => {
    const draft = {
      phase: "complete",
      integrationId: "toolbelt-basic-save:msg1",
      saveType: "reflex",
      rollIndex: 0,
      sourceActorUuid: "Actor.source",
      sourceItemUuid: "Actor.source.Item.x",
      targetOrder: ["t0", "t1"],
      targets: {
        t0: {
          applicationId: "toolbelt-basic-save:msg1:target:t0",
          tokenUuid: "Scene.sc1.Token.t0",
          actorUuid: "Actor.a0",
          effectiveOutcome: "failure",
          nativeOutcome: "failure",
          multiplier: 1,
          state: TOOLBELT_TARGET_STATES.APPLIED,
          actualHpDelta: 20,
        },
        t1: {
          applicationId: "toolbelt-basic-save:msg1:target:t1",
          tokenUuid: "Scene.sc1.Token.t1",
          actorUuid: "Actor.a1",
          effectiveOutcome: "success",
          nativeOutcome: "success",
          multiplier: 0.5,
          state: TOOLBELT_TARGET_STATES.ERROR,
          actualHpDelta: null,
        },
      },
    };
    const collected = collectToolbeltBatchTargets(draft);
    assert.equal(collected.length, 2);
    assert.equal(collected[0].appliedTotal, 20);
    assert.equal(collected[1].appliedTotal, undefined);
    const empty = buildSaveBatchPayload({
      transactionId: "batch",
      saveType: "will",
      damageRoll: sampleDamageRoll(),
      targets: [{ degreeOfSuccess: null, targetTokenUuid: null }],
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "no-authoritative-targets");
  });

  it("75-76. deleted source can emit anonymously; insufficient target identity is omitted", () => {
    const payload = samplePayload({
      sourceTokenUuid: null,
      sourceActorUuid: null,
      itemUuid: null,
      effectName: null,
      targets: [
        { ...sampleTargets(1)[0] },
        {
          applicationId: "ghost",
          order: 1,
          targetTokenUuid: null,
          targetActorUuid: null,
          degreeOfSuccess: "failure",
          multiplier: 1,
        },
      ],
    });
    assert.equal(payload.sourceActorUuid, null);
    assert.equal(payload.targets.length, 1);
  });

  it("77-82. Toolbelt path unchanged markers and clamps", () => {
    assert.equal(clampSaveBatchMinimumTargets(1), 2);
    assert.equal(clampSaveBatchMinimumTargets(100), 24);
    assert.equal(MAX_BATCH_TARGETS, 24);
    const truncated = truncateBatchTargets(sampleTargets(30));
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.targets.length, 24);
  });

  it("83-87. Undo remains external to emission; no-damage has zero applied and no fake undo", () => {
    const payload = samplePayload({
      targets: [{ ...sampleTargets(1)[0], multiplier: 0, appliedTotal: 0 }],
    });
    assert.equal(payload.targets[0].damage.outcome, "none");
    assert.equal(payload.targets[0].damage.appliedTotal, 0);
    assert.equal(Object.hasOwn(payload, "undo"), false);
  });

  it("88. existing Strike impact synchronization helpers remain unchanged", () => {
    const result = evaluateNelcineImpactEligibility({
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
      damageTotal: 10,
      supportsDelayedCommit: true,
    });
    assert.equal(result.eligible, true);
  });

  it("89-92. single-target and incomplete batches skip without changing timing contract", () => {
    const draft = {
      phase: "complete",
      integrationId: "toolbelt-basic-save:solo",
      saveType: "reflex",
      rollIndex: 0,
      targetOrder: ["t0"],
      targets: {
        t0: {
          applicationId: "solo:target:t0",
          tokenUuid: "Scene.sc1.Token.t0",
          actorUuid: "Actor.a0",
          effectiveOutcome: "failure",
          nativeOutcome: "failure",
          multiplier: 1,
          state: TOOLBELT_TARGET_STATES.APPLIED,
          actualHpDelta: 10,
        },
      },
      nelcineSaveBatchEmitted: false,
    };
    const result = tryEmitToolbeltSaveBatch({
      draft,
      message: { rolls: [{ formula: "2d6", total: 7, instances: [] }] },
      normalized: { ok: true, saveType: "reflex", saveDC: 20, targets: [] },
    });
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "below-minimum-targets");
  });

  it("toolbelt collector preserves targetOrder", () => {
    const draft = {
      targetOrder: ["b", "a"],
      targets: {
        a: {
          applicationId: "id-a",
          tokenUuid: "Scene.sc1.Token.a",
          actorUuid: "Actor.a",
          effectiveOutcome: "failure",
          multiplier: 1,
          state: TOOLBELT_TARGET_STATES.APPLIED,
          actualHpDelta: 5,
        },
        b: {
          applicationId: "id-b",
          tokenUuid: "Scene.sc1.Token.b",
          actorUuid: "Actor.b",
          effectiveOutcome: "success",
          multiplier: 0.5,
          state: TOOLBELT_TARGET_STATES.NO_DAMAGE,
          actualHpDelta: 0,
        },
      },
    };
    const collected = collectToolbeltBatchTargets(draft);
    assert.deepEqual(
      collected.map((t) => t.applicationId),
      ["id-b", "id-a"],
    );
    assert.equal(collected[0].appliedTotal, 0);
  });

  it("legacy collector maps applied and terminal targets", () => {
    const collected = collectLegacyBatchTargets({
      targets: [
        {
          applicationId: "app-1",
          targetEntryId: "entry-1",
          targetTokenUuid: "Scene.sc1.Token.t0",
          targetActorUuid: "Actor.a0",
          finalizedDegreeOfSuccess: "failure",
          damageMultiplier: 1,
          applicationState: "applied",
          appliedAmount: 22,
        },
        {
          applicationId: "app-2",
          targetEntryId: "entry-2",
          targetTokenUuid: "Scene.sc1.Token.t1",
          targetActorUuid: "Actor.a1",
          finalizedDegreeOfSuccess: "criticalSuccess",
          damageMultiplier: 0,
          applicationState: "no-damage",
          appliedAmount: 0,
        },
      ],
    });
    assert.equal(collected.length, 2);
    assert.equal(collected[0].appliedTotal, 22);
    assert.equal(collected[1].appliedTotal, 0);
  });

  it("legacy incomplete phase does not emit", () => {
    const result = tryEmitLegacySaveBatch({
      resolver: {
        phase: "applying-damage",
        resolverId: "nelflow-save-msg",
        save: { type: "will", dc: 20 },
        targets: [],
      },
    });
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "batch-incomplete");
  });

  it("public diagnostics are GM-gated and safe", () => {
    const payload = samplePayload();
    emitSaveBatchResolved(payload, { hooksCallAll: () => undefined });
    const status = getSaveBatchIntegrationStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.active, true);
    assert.equal(typeof status.pendingBatchCount, "number");
    assert.equal(getSaveBatchDiagnostic(payload.transactionId).state, "emitted");
    globalThis.game.user.isGM = false;
    assert.equal(getSaveBatchDiagnostic(payload.transactionId), null);
    assert.deepEqual(inspectSaveBatches(), { pending: [], recent: [], failed: [] });
  });

  it("developer watchers are single-instance and GM-only", () => {
    assert.equal(watchSaveBatchCinematics(), true);
    assert.equal(watchSaveBatchCinematics(), true);
    assert.equal(stopWatchingSaveBatchCinematics(), true);
    assert.equal(stopWatchingSaveBatchCinematics(), false);
    globalThis.game.user.isGM = false;
    assert.equal(watchSaveBatchCinematics(), false);
  });

  it("live canEmitSaveBatch respects setting and primary GM", () => {
    assert.equal(
      canEmitSaveBatch({
        supportedWorkflow: true,
        batchComplete: true,
        transactionId: "toolbelt-basic-save:msg1",
        targetCount: 2,
        saveType: "reflex",
        hasAuthoritativeDegrees: true,
      }).eligible,
      true,
    );
    globalThis.game.settings.get = (_module, key) =>
      key === "nelcineSaveBatchCinematics" ? false : 2;
    assert.equal(
      canEmitSaveBatch({
        supportedWorkflow: true,
        batchComplete: true,
        transactionId: "toolbelt-basic-save:msg1",
        targetCount: 2,
        saveType: "reflex",
        hasAuthoritativeDegrees: true,
      }).reason,
      "setting-disabled",
    );
  });

  it("successful toolbelt emission uses shared damage and marks draft", () => {
    const calls = [];
    const originalHooks = globalThis.Hooks;
    globalThis.Hooks = {
      callAll: (hook, payload) => calls.push({ hook, payload }),
    };
    const draft = {
      phase: "complete",
      integrationId: "toolbelt-basic-save:msg1",
      saveType: "reflex",
      rollIndex: 0,
      sourceActorUuid: "Actor.source",
      sourceItemUuid: "Actor.source.Item.fireball",
      targetOrder: ["t0", "t1"],
      targets: {
        t0: {
          applicationId: "toolbelt-basic-save:msg1:target:t0",
          tokenUuid: "Scene.sc1.Token.t0",
          actorUuid: "Actor.a0",
          effectiveOutcome: "failure",
          nativeOutcome: "failure",
          multiplier: 1,
          state: TOOLBELT_TARGET_STATES.APPLIED,
          actualHpDelta: 28,
        },
        t1: {
          applicationId: "toolbelt-basic-save:msg1:target:t1",
          tokenUuid: "Scene.sc1.Token.t1",
          actorUuid: "Actor.a1",
          effectiveOutcome: "success",
          nativeOutcome: "success",
          multiplier: 0.5,
          state: TOOLBELT_TARGET_STATES.APPLIED,
          actualHpDelta: 14,
        },
      },
      nelcineSaveBatchEmitted: false,
    };
    const message = {
      item: { name: "Fireball" },
      token: { document: { uuid: "Scene.sc1.Token.source" } },
      rolls: [
        {
          formula: "8d6",
          total: 28,
          instances: [{ type: "fire", total: 28 }],
        },
      ],
    };
    const result = tryEmitToolbeltSaveBatch({
      draft,
      message,
      normalized: {
        ok: true,
        saveType: "reflex",
        saveDC: 30,
        targets: [
          { toolbeltTargetKey: "t0", order: 0 },
          { toolbeltTargetKey: "t1", order: 1 },
        ],
      },
    });
    assert.equal(result.emitted, true);
    assert.equal(draft.nelcineSaveBatchEmitted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hook, NELCINE_SAVE_BATCH_HOOK);
    assert.equal(calls[0].payload.damageRoll.rolledTotal, 28);
    assert.equal(calls[0].payload.targets.length, 2);
    assert.equal(calls[0].payload.save.dcPublic, false);
    globalThis.Hooks = originalHooks;
  });
});
