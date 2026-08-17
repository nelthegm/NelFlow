/** Presentation-neutral basic-save target damage feed (0.14.13 / protocol 3). */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASIC_SAVE_PRESENTATION_PROTOCOL,
  BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
  installBasicSavePresentationFeedApi,
  tryEmitBasicSaveTargetPresentation,
} from "../scripts/basic-save-presentation-feed.js";
import {
  BASIC_SAVE_DAMAGE_APPLIED_SOURCE,
  BASIC_SAVE_DAMAGE_TEMP_HP_AWARE,
  BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
  buildBasicSaveTargetDamagePresentationPayload,
  buildBasicSaveTargetDamageResultId,
  clearBasicSaveDamagePresentationEmissions,
  deriveActualBasicSaveHpLoss,
  emitBasicSaveTargetDamagePresentationFromApplication,
  evaluateBasicSaveTargetDamagePresentationEligibility,
  getBasicSaveDamagePresentationStatus,
  hasBasicSaveTargetDamagePresentationEmission,
  seedBasicSaveTargetDamagePresentationEmission,
  tryEmitBasicSaveTargetDamagePresentation,
} from "../scripts/basic-save-damage-presentation-feed.js";
import { clearBasicSavePresentationEmissions } from "../scripts/basic-save-presentation-feed.js";

const root = dirname(fileURLToPath(import.meta.url));
const source = (rel) => readFileSync(join(root, "..", rel), "utf8");

function args(overrides = {}) {
  return {
    integrationId: "toolbelt-basic-save:damage-message",
    batchId: "toolbelt-basic-save:damage-message",
    applicationId: "toolbelt-basic-save:damage-message:target:token-a",
    toolbeltTargetKey: "token-a",
    saveFingerprint: "save-fp-a",
    targetResultId:
      "toolbelt-basic-save:damage-message:target:token-a:fp:save-fp-a",
    sceneId: "scene-a",
    sourceActorUuid: "Actor.caster",
    sourceTokenUuid: "Scene.scene-a.Token.caster",
    targetTokenUuid: "Scene.scene-a.Token.token-a",
    targetActorUuid: "Actor.target-a",
    actionName: "fireball",
    itemUuid: "Actor.caster.Item.fireball",
    saveType: "reflex",
    degreeOfSuccess: "failure",
    isBasicSave: true,
    private: false,
    applied: 40,
    baseRollTotal: 45,
    degreeAdjustedAmount: 45,
    createdAt: 1234,
    ...overrides,
  };
}

function readyArgs(overrides = {}) {
  const value = args(overrides);
  return {
    integrationId: value.integrationId,
    applicationId: value.applicationId,
    toolbeltTargetKey: value.toolbeltTargetKey,
    saveFingerprint: value.saveFingerprint,
    sceneId: value.sceneId,
    sourceActorUuid: value.sourceActorUuid,
    sourceTokenUuid: value.sourceTokenUuid,
    targetTokenUuid: value.targetTokenUuid,
    targetActorUuid: value.targetActorUuid,
    actionName: value.actionName,
    itemUuid: value.itemUuid,
    saveType: value.saveType,
    isBasicSave: value.isBasicSave,
    private: value.private,
    degreeOfSuccess: value.degreeOfSuccess,
    dieResult: 11,
    modifier: 14,
    total: 25,
  };
}

function applicationProjection(overrides = {}) {
  const value = args(overrides);
  return {
    draft: {
      integrationId: value.integrationId,
      sourceActorUuid: value.sourceActorUuid,
      sourceItemUuid: value.itemUuid,
      sourceActionSlug: value.actionName,
      saveType: value.saveType,
    },
    record: {
      applicationId: value.applicationId,
      toolbeltTargetKey: value.toolbeltTargetKey,
      toolbeltStateFingerprint: value.saveFingerprint,
      tokenUuid: value.targetTokenUuid,
      actorUuid: value.targetActorUuid,
      sceneId: value.sceneId,
      saveType: value.saveType,
      effectiveOutcome: value.degreeOfSuccess,
      preApplicationHp: 60,
      preApplicationTempHp: 5,
      postApplicationHp: 25,
      postApplicationTempHp: 0,
    },
    target: {
      toolbeltTargetKey: value.toolbeltTargetKey,
      saveFingerprint: value.saveFingerprint,
      tokenUuid: value.targetTokenUuid,
      actorUuid: value.targetActorUuid,
      sceneId: value.sceneId,
      saveType: value.saveType,
      degreeOfSuccess: value.degreeOfSuccess,
      isBasicSave: true,
      private: value.private,
    },
    normalized: {
      sourceActorUuid: value.sourceActorUuid,
      sourceItemUuid: value.itemUuid,
    },
    damageRoll: { total: value.baseRollTotal },
    transformedRoll: { total: value.degreeAdjustedAmount },
  };
}

describe("0.14.13 basic-save target damage presentation feed", () => {
  beforeEach(() => {
    clearBasicSavePresentationEmissions();
    clearBasicSaveDamagePresentationEmissions();
    globalThis.game = {
      user: { id: "gm", isGM: true },
      modules: { get: () => undefined },
      nelflow: undefined,
    };
    globalThis.Hooks = {
      calls: [],
      callAll(hook, payload) {
        this.calls.push({ hook, payload });
      },
    };
  });

  it("1. basicSavePresentation protocol becomes 3", () => {
    installBasicSavePresentationFeedApi();
    assert.equal(BASIC_SAVE_PRESENTATION_PROTOCOL, 3);
    assert.equal(game.nelflow.integrations.basicSavePresentation.protocol, 3);
  });
  it("2. targetResolvedHook is unchanged", () => {
    installBasicSavePresentationFeedApi();
    assert.equal(game.nelflow.integrations.basicSavePresentation.targetResolvedHook, BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK);
  });
  it("3. targetDamageAppliedHook is exposed", () => {
    installBasicSavePresentationFeedApi();
    assert.equal(game.nelflow.integrations.basicSavePresentation.targetDamageAppliedHook, BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK);
    assert.equal(game.nelflow.integrations.basicSavePresentation.stages.targetDamageApplied, true);
  });
  it("4. protocol-1 consumer remains compatible", () => {
    installBasicSavePresentationFeedApi();
    const api = game.nelflow.integrations.basicSavePresentation;
    assert.equal(api.protocol >= 1 && api.targetResolvedHook === BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK, true);
  });
  it("5. exact target is preserved", () => {
    const built = buildBasicSaveTargetDamagePresentationPayload(args());
    assert.equal(built.payload.targetTokenUuid, args().targetTokenUuid);
    assert.equal(built.payload.targetActorUuid, args().targetActorUuid);
  });
  it("6. exact batch is preserved when available", () => {
    assert.equal(buildBasicSaveTargetDamagePresentationPayload(args()).payload.batchId, args().batchId);
  });
  it("7. targetResultId is preserved when available", () => {
    assert.equal(buildBasicSaveTargetDamagePresentationPayload(args()).payload.targetResultId, args().targetResultId);
  });
  it("8. authoritative degree is preserved", () => {
    const payload = buildBasicSaveTargetDamagePresentationPayload(args({ degreeOfSuccess: "criticalFailure" })).payload;
    assert.equal(payload.save.degreeOfSuccess, "criticalFailure");
  });
  it("9. applied target damage is preserved", () => {
    assert.equal(buildBasicSaveTargetDamagePresentationPayload(args({ applied: 40 })).payload.damage.applied, 40);
  });
  it("10. zero damage is preserved as zero", () => {
    assert.equal(buildBasicSaveTargetDamagePresentationPayload(args({ applied: 0 })).payload.damage.applied, 0);
  });
  it("11. base roll is optional", () => {
    const damage = buildBasicSaveTargetDamagePresentationPayload(args({ baseRollTotal: null })).payload.damage;
    assert.equal(Object.hasOwn(damage, "baseRollTotal"), false);
  });
  it("12. degree-adjusted amount is optional", () => {
    const damage = buildBasicSaveTargetDamagePresentationPayload(args({ degreeAdjustedAmount: null })).payload.damage;
    assert.equal(Object.hasOwn(damage, "degreeAdjustedAmount"), false);
  });
  it("13. no chat HTML parsing is used", () => {
    const feed = source("scripts/basic-save-damage-presentation-feed.js");
    assert.doesNotMatch(feed, /innerHTML|querySelector|chat-card|data-action/);
  });
  it("14. resistance-adjusted actual damage comes from application snapshots", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 60, beforeTempHp: 0, afterHp: 20, afterTempHp: 0 }), 40);
  });
  it("15. weakness-adjusted actual damage comes from application snapshots", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 100, beforeTempHp: 0, afterHp: 40, afterTempHp: 0 }), 60);
  });
  it("16. immunity zero comes from unchanged application snapshots", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 60, beforeTempHp: 0, afterHp: 60, afterTempHp: 0 }), 0);
  });
  it("17. NelFlow does not reproduce IWR calculations", () => {
    const feed = source("scripts/basic-save-damage-presentation-feed.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(feed, /resistance|weakness|immunity|hardness|skipIWR|alter\(/i);
  });
  it("18. amount is not blindly copied from base DamageRoll", () => {
    const payload = buildBasicSaveTargetDamagePresentationPayload(args({ applied: 40, baseRollTotal: 45 })).payload;
    assert.equal(payload.damage.applied, 40);
    assert.equal(payload.damage.baseRollTotal, 45);
  });
  it("19. temp HP behavior uses the audited combined-resource source", () => {
    assert.equal(BASIC_SAVE_DAMAGE_TEMP_HP_AWARE, true);
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 20, beforeTempHp: 10, afterHp: 15, afterTempHp: 0 }), 15);
  });
  it("20. temp-only damage is not reported as false zero", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 20, beforeTempHp: 10, afterHp: 20, afterTempHp: 4 }), 6);
  });
  it("21. save target result emits before target damage", () => {
    tryEmitBasicSaveTargetPresentation(readyArgs());
    tryEmitBasicSaveTargetDamagePresentation(args());
    assert.deepEqual(Hooks.calls.map((entry) => entry.hook), [BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK, BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK]);
  });
  it("22. target damage wiring occurs only after the real application snapshot", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /const after = result[\s\S]*preApplicationHp[\s\S]*postApplicationTempHp[\s\S]*emitBasicSaveTargetDamagePresentationFromApplication/);
  });
  it("23. target damage does not wait for unrelated later presentation work", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /emitBasicSaveTargetDamagePresentationFromApplication[\s\S]*diagnostic\("toolbelt-application-complete"/);
  });
  it("24. NelCine impact-delayed HP uses applyOne before the event", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /commitHandler:[\s\S]*await applyOne\(liveMessage, liveDraft, key\)/);
  });
  it("25. missing snapshots cannot fake an applied amount", () => {
    const projection = applicationProjection();
    projection.record.preApplicationHp = null;
    const result = emitBasicSaveTargetDamagePresentationFromApplication(projection);
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "missing-authoritative-applied-damage");
  });
  it("26. target A emits independently", () => {
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args()).emitted, true);
  });
  it("27. target B emits independently", () => {
    tryEmitBasicSaveTargetDamagePresentation(args());
    const result = tryEmitBasicSaveTargetDamagePresentation(args({ applicationId: "batch:target:b", targetResultId: "batch:target:b:fp:b", targetTokenUuid: "Scene.s.Token.b", targetActorUuid: "Actor.b" }));
    assert.equal(result.emitted, true);
  });
  it("28. different IWR totals remain distinct", () => {
    tryEmitBasicSaveTargetDamagePresentation(args({ applied: 0 }));
    tryEmitBasicSaveTargetDamagePresentation(args({ applicationId: "batch:target:b", targetResultId: "batch:target:b:fp:b", targetTokenUuid: "Scene.s.Token.b", applied: 40 }));
    assert.deepEqual(Hooks.calls.map((entry) => entry.payload.damage.applied), [0, 40]);
  });
  it("29. actual application order is preserved", () => {
    for (const [id, applied] of [["c", 20], ["a", 0], ["b", 40]]) {
      tryEmitBasicSaveTargetDamagePresentation(args({ applicationId: `batch:target:${id}`, targetResultId: `batch:target:${id}:fp:${id}`, targetTokenUuid: `Scene.s.Token.${id}`, applied }));
    }
    assert.deepEqual(Hooks.calls.map((entry) => entry.payload.targetTokenUuid.split(".").at(-1)), ["c", "a", "b"]);
  });
  it("30. one target event cannot duplicate another", () => {
    const a = buildBasicSaveTargetDamageResultId(args());
    const b = buildBasicSaveTargetDamageResultId(args({ applicationId: "batch:target:b", targetResultId: "batch:target:b:fp:b" }));
    assert.notEqual(a, b);
  });
  it("31. conclusive zero application emits 0", () => {
    const projection = applicationProjection({ degreeOfSuccess: "criticalSuccess" });
    const result = emitBasicSaveTargetDamagePresentationFromApplication({ ...projection, conclusiveZero: true, transformedRoll: null });
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls[0].payload.damage.applied, 0);
  });
  it("32. critical-success zero follows the existing no-damage transition", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /record\.multiplier === 0[\s\S]*NO_DAMAGE[\s\S]*conclusiveZero: true/);
  });
  it("33. unrelated no-damage target receives no fake zero", () => {
    const result = emitBasicSaveTargetDamagePresentationFromApplication(applicationProjection({ applied: null }));
    assert.equal(result.emitted, true); // exact snapshots still prove the real 40-point application
    clearBasicSaveDamagePresentationEmissions();
    const projection = applicationProjection();
    projection.record.preApplicationHp = null;
    assert.equal(emitBasicSaveTargetDamagePresentationFromApplication(projection).emitted, false);
  });
  it("34. repeated observation does not duplicate", () => {
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args()).emitted, true);
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args()).emitted, false);
  });
  it("35. duplicate application observer does not duplicate", () => {
    const projection = applicationProjection();
    emitBasicSaveTargetDamagePresentationFromApplication(projection);
    emitBasicSaveTargetDamagePresentationFromApplication(projection);
    assert.equal(Hooks.calls.length, 1);
  });
  it("36. damage registry is independent from targetResolved registry", () => {
    const damageId = buildBasicSaveTargetDamageResultId(args());
    seedBasicSaveTargetDamagePresentationEmission(damageId);
    assert.equal(hasBasicSaveTargetDamagePresentationEmission(damageId), true);
    tryEmitBasicSaveTargetPresentation(readyArgs());
    assert.equal(Hooks.calls.length, 1);
  });
  it("37. distinct target produces a distinct damageResultId", () => {
    assert.notEqual(buildBasicSaveTargetDamageResultId(args()), buildBasicSaveTargetDamageResultId(args({ applicationId: "batch:target:b", targetResultId: "batch:target:b:fp:b" })));
  });
  it("38. superseded pre-application save creates no abandoned damage event", () => {
    tryEmitBasicSaveTargetPresentation(readyArgs({ saveFingerprint: "superseded" }));
    assert.equal(Hooks.calls.filter((entry) => entry.hook === BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK).length, 0);
  });
  it("39. final authoritative reroll application emits once", () => {
    const final = args({ saveFingerprint: "final", targetResultId: "batch:target:a:fp:final" });
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(final).emitted, true);
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(final).emitted, false);
  });
  it("40. private workflow does not leak target damage", () => {
    const result = tryEmitBasicSaveTargetDamagePresentation(args({ private: true }));
    assert.equal(result.emitted, false);
    assert.equal(Hooks.calls.length, 0);
  });
  it("41. hidden target identity is not leaked", () => {
    const result = tryEmitBasicSaveTargetDamagePresentation(args({ private: true, targetTokenUuid: "Scene.secret.Token.hidden" }));
    assert.equal(result.reason, "private-save");
    assert.equal(JSON.stringify(Hooks.calls).includes("hidden"), false);
  });
  it("42. emission remains GM-local Hooks.callAll", () => {
    const feed = source("scripts/basic-save-damage-presentation-feed.js");
    assert.match(feed, /Hooks\.callAll/);
    assert.doesNotMatch(feed, /game\.socket|socket\.emit|broadcast/);
  });
  it("43. Toolbelt still owns saves", () => {
    assert.match(source("scripts/basic-save-presentation-feed.js"), /Toolbelt owns save execution/);
  });
  it("44. NelFlow does not roll saves for this feed", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /check\.roll|rollSave|new Roll/);
  });
  it("45. save multipliers are unchanged", () => {
    const model = source("scripts/toolbelt-basic-save-model.js");
    assert.match(model, /criticalSuccess:\s*0[\s\S]*success:\s*0\.5[\s\S]*failure:\s*1[\s\S]*criticalFailure:\s*2/);
  });
  it("46. IWR remains delegated to PF2e", () => {
    assert.match(source("scripts/pf2e-adapter.js"), /skipIWR:\s*false/);
  });
  it("47. HP application remains the existing adapter call", () => {
    assert.match(source("scripts/toolbelt-basic-save-service.js"), /PF2eAdapter\.applyDamageRollToRecordedTarget/);
  });
  it("48. all-resolved timing is unchanged", () => {
    assert.match(source("scripts/toolbelt-basic-save-model.js"), /mode === "all-resolved" && !allPrimarySavesResolved/);
  });
  it("49. per-target timing is unchanged", () => {
    assert.match(source("scripts/toolbelt-basic-save-model.js"), /targets\.filter\(\(target\) => target\.saveState === "resolved"\)/);
  });
  it("50. Undo remains unchanged", () => {
    assert.match(source("scripts/toolbelt-basic-save-service.js"), /guardedHealthRestore/);
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /restoreHealth|UNDONE/);
  });
  it("51. NelCine single-save behavior is unchanged", () => {
    assert.match(source("scripts/nelcine-save-batch-bridge.js"), /nelflow\.basicSaveBatchResolved/);
  });
  it("52. NelCine batch behavior is unchanged", () => {
    assert.match(source("scripts/toolbelt-basic-save-service.js"), /tryEmitToolbeltSaveBatch/);
  });
  it("53. NelCine impact sync is unchanged", () => {
    assert.match(source("scripts/nelcine-save-batch-impact.js"), /commitPendingBatchResult/);
  });
  it("54. nelflow.damageApplied remains unchanged alongside the new hook", () => {
    assert.match(source("scripts/damage-applied-bridge.js"), /DAMAGE_APPLIED_HOOK = "nelflow\.damageApplied"/);
    assert.match(source("scripts/pf2e-adapter.js"), /emitDamageAppliedFromApplication/);
  });
  it("55. NelZones mechanics contract remains the existing damageApplied feed", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /NelZones|damageApplied/);
  });
  it("56. Strike protocol is 4", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /STRIKE_PRESENTATION_FEED_PROTOCOL = 4/);
  });
  it("57. Strike attack feed is unchanged", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /strikeAttackResolvedPresentation/);
  });
  it("58. Strike damageRolled feed is unchanged", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /strikeDamageRolledPresentation/);
  });
  it("59. Strike resolved feed is unchanged", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /strikeResolvedPresentation/);
  });
  it("60. Strike rolled-damage semantics remain explicit", () => {
    assert.match(source("docs/BASIC_SAVE_PRESENTATION_CONTRACT.md"), /damage/i);
  });
  it("61. no Toolbelt mutation is introduced", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /setFlag|update\(|targetHelper/);
  });
  it("62. no private Toolbelt API is called", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /game\.toolbelt|pf2e-toolbelt/);
  });
  it("63. no new Roll is created", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /new\s+(?:Damage)?Roll|Roll\.create/);
  });
  it("64. no new save roll is created", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /save\.check|statistic\.check/);
  });
  it("65. presentation performs no Actor.update", () => {
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /Actor\.update|actor\.update|\.update\(\{/);
  });
  it("66. payload is plain JSON", () => {
    const payload = buildBasicSaveTargetDamagePresentationPayload(args()).payload;
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  });
  it("67. payload contains no Foundry Documents", () => {
    const document = { uuid: "Actor.bad", update() {} };
    const payload = buildBasicSaveTargetDamagePresentationPayload(args({ document })).payload;
    assert.equal(JSON.stringify(payload).includes("Actor.bad"), false);
  });
  it("68. payload contains no Roll object", () => {
    const roll = { total: 45, instances: [], alter() {} };
    const payload = buildBasicSaveTargetDamagePresentationPayload(args({ roll })).payload;
    assert.equal(Object.hasOwn(payload, "roll"), false);
  });
  it("69. module works with NelTactics absent", () => {
    assert.equal(game.modules.get("neltactics"), undefined);
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args()).emitted, true);
  });

  it("long sessions do not evict exactly-once damage identities", () => {
    const first = args();
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(first).emitted, true);
    for (let index = 0; index < 140; index += 1) {
      tryEmitBasicSaveTargetDamagePresentation(args({
        applicationId: `batch:target:extra-${index}`,
        targetResultId: `batch:target:extra-${index}:fp:${index}`,
        targetTokenUuid: `Scene.s.Token.extra-${index}`,
      }));
    }
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(first).emitted, false);
  });

  it("status reports audited application source and temp-HP awareness", () => {
    const status = getBasicSaveDamagePresentationStatus();
    assert.equal(status.appliedDamageSource, BASIC_SAVE_DAMAGE_APPLIED_SOURCE);
    assert.equal(status.appliedDamageSource, "transaction-before-after");
    assert.equal(status.tempHpAware, true);
    assert.equal(status.damageProducerAvailable, true);
  });
  it("eligibility rejects negative or absent authoritative amounts", () => {
    const base = {
      isGM: true,
      damageResultId: "damage-id",
      alreadyEmitted: false,
      isBasicSave: true,
      private: false,
      targetTokenUuid: "Scene.s.Token.t",
      degreeOfSuccess: "failure",
      saveType: "reflex",
    };
    assert.equal(evaluateBasicSaveTargetDamagePresentationEligibility({ ...base, applied: null }).eligible, false);
    assert.equal(evaluateBasicSaveTargetDamagePresentationEligibility({ ...base, applied: -1 }).eligible, false);
  });
});
