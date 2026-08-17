/**
 * Basic-save damage ownership reservation (0.14.13 / protocol 3).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASIC_SAVE_PRESENTATION_PROTOCOL,
  BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
  clearBasicSavePresentationEmissions,
  installBasicSavePresentationFeedApi,
  tryEmitBasicSaveTargetPresentation,
} from "../scripts/basic-save-presentation-feed.js";
import {
  BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
  BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
  buildBasicSaveTargetDamageApplyingPresentationPayload,
  buildBasicSaveTargetDamageResultId,
  clearBasicSaveDamagePresentationEmissions,
  emitBasicSaveTargetDamageApplyingPresentationFromApplication,
  emitBasicSaveTargetDamagePresentationFromApplication,
  evaluateBasicSaveTargetDamageApplyingPresentationEligibility,
  getBasicSaveDamagePresentationStatus,
  hasBasicSaveTargetDamageApplyingPresentationEmission,
  tryEmitBasicSaveTargetDamageApplyingPresentation,
  tryEmitBasicSaveTargetDamagePresentation,
} from "../scripts/basic-save-damage-presentation-feed.js";
import { STRIKE_PRESENTATION_FEED_PROTOCOL } from "../scripts/strike-presentation-feed.js";

const root = dirname(fileURLToPath(import.meta.url));
const source = (rel) => readFileSync(join(root, "..", rel), "utf8");

function args(overrides = {}) {
  return {
    integrationId: "toolbelt-basic-save:damage-message",
    batchId: "toolbelt-basic-save:damage-message",
    applicationId: "toolbelt-basic-save:damage-message:target:token-a",
    toolbeltTargetKey: "token-a",
    saveFingerprint: "save-fp-a",
    targetResultId: "toolbelt-basic-save:damage-message:target:token-a:fp:save-fp-a",
    sceneId: "scene-a",
    sourceActorUuid: "Actor.caster",
    targetTokenUuid: "Scene.scene-a.Token.token-a",
    targetActorUuid: "Actor.target-a",
    actionName: "fireball",
    itemUuid: "Actor.caster.Item.fireball",
    saveType: "reflex",
    degreeOfSuccess: "failure",
    isBasicSave: true,
    private: false,
    applied: 40,
    ...overrides,
  };
}

describe("0.14.13 basic-save damage applying ownership reservation", () => {
  beforeEach(() => {
    clearBasicSavePresentationEmissions();
    clearBasicSaveDamagePresentationEmissions();
    globalThis.game = { user: { isGM: true }, nelflow: undefined, modules: { get: () => undefined } };
    globalThis.Hooks = {
      calls: [],
      callAll(hook, payload) {
        this.calls.push({ hook, payload });
      },
    };
  });

  it("1-6. protocol 3 advertises applying + preserves prior hooks", () => {
    assert.equal(BASIC_SAVE_PRESENTATION_PROTOCOL, 3);
    installBasicSavePresentationFeedApi();
    const api = game.nelflow.integrations.basicSavePresentation;
    assert.equal(api.protocol, 3);
    assert.equal(api.targetResolvedHook, BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK);
    assert.equal(api.targetDamageApplyingHook, BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK);
    assert.equal(api.targetDamageAppliedHook, BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK);
    assert.equal(api.stages.targetResolved, true);
    assert.equal(api.stages.targetDamageApplying, true);
    assert.equal(api.stages.targetDamageApplied, true);
    assert.ok(api.protocol >= 1);
    assert.ok(api.protocol >= 2);
  });

  it("7-13. resolved → applying → applied share identity", () => {
    tryEmitBasicSaveTargetPresentation({
      integrationId: args().integrationId,
      applicationId: args().applicationId,
      toolbeltTargetKey: args().toolbeltTargetKey,
      saveFingerprint: args().saveFingerprint,
      targetTokenUuid: args().targetTokenUuid,
      saveType: "reflex",
      degreeOfSuccess: "failure",
      isBasicSave: true,
      total: 25,
    });
    const applying = tryEmitBasicSaveTargetDamageApplyingPresentation(args());
    const applied = tryEmitBasicSaveTargetDamagePresentation(args({ applied: 40 }));
    assert.equal(applying.emitted, true);
    assert.equal(applied.emitted, true);
    assert.equal(Hooks.calls[0].hook, BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK);
    assert.equal(Hooks.calls[1].hook, BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK);
    assert.equal(Hooks.calls[2].hook, BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK);
    assert.equal(Hooks.calls[1].payload.damageResultId, Hooks.calls[2].payload.damageResultId);
    assert.equal(Hooks.calls[1].payload.targetTokenUuid, Hooks.calls[2].payload.targetTokenUuid);
    assert.equal(Hooks.calls[1].payload.batchId, Hooks.calls[2].payload.batchId);
    assert.equal(Hooks.calls[1].payload.targetResultId, Hooks.calls[2].payload.targetResultId);
    assert.equal(Object.hasOwn(Hooks.calls[1].payload, "damage"), false);
  });

  it("14-17. eligibility gates suppress applying", () => {
    assert.equal(
      tryEmitBasicSaveTargetDamageApplyingPresentation(args({ isBasicSave: false })).reason,
      "not-basic-save",
    );
    assert.equal(
      tryEmitBasicSaveTargetDamageApplyingPresentation(args({ private: true })).reason,
      "private-save",
    );
    assert.equal(
      tryEmitBasicSaveTargetDamageApplyingPresentation(args({ targetTokenUuid: null })).reason,
      "missing-target-token",
    );
    globalThis.game.user.isGM = false;
    assert.equal(tryEmitBasicSaveTargetDamageApplyingPresentation(args()).reason, "not-gm");
  });

  it("18-21. exactly-once applying and applied", () => {
    assert.equal(tryEmitBasicSaveTargetDamageApplyingPresentation(args()).emitted, true);
    assert.equal(tryEmitBasicSaveTargetDamageApplyingPresentation(args()).emitted, false);
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args({ applied: 12 })).emitted, true);
    assert.equal(tryEmitBasicSaveTargetDamagePresentation(args({ applied: 12 })).emitted, false);
    assert.equal(hasBasicSaveTargetDamageApplyingPresentationEmission(args().targetResultId + ":damage:" + args().applicationId), true);
  });

  it("22-25. IWR-zero can apply; critical-success no-apply skips applying", () => {
    const zeroApply = tryEmitBasicSaveTargetDamageApplyingPresentation(args({ degreeOfSuccess: "success" }));
    const zeroApplied = tryEmitBasicSaveTargetDamagePresentation(args({ applied: 0, degreeOfSuccess: "success" }));
    assert.equal(zeroApply.emitted, true);
    assert.equal(zeroApplied.emitted, true);
    assert.equal(Hooks.calls[1].payload.damage.applied, 0);

    clearBasicSaveDamagePresentationEmissions();
    Hooks.calls.length = 0;
    // Conclusive zero path emits applied without applying reservation.
    const conclusive = emitBasicSaveTargetDamagePresentationFromApplication({
      draft: { integrationId: args().integrationId, sourceActionSlug: "fireball", saveType: "reflex" },
      record: {
        applicationId: args().applicationId,
        toolbeltTargetKey: "token-a",
        toolbeltStateFingerprint: "save-fp-a",
        tokenUuid: args().targetTokenUuid,
        actorUuid: args().targetActorUuid,
        effectiveOutcome: "criticalSuccess",
      },
      target: {
        toolbeltTargetKey: "token-a",
        tokenUuid: args().targetTokenUuid,
        actorUuid: args().targetActorUuid,
        saveFingerprint: "save-fp-a",
        saveType: "reflex",
        degreeOfSuccess: "criticalSuccess",
        isBasicSave: true,
        private: false,
      },
      normalized: {},
      conclusiveZero: true,
    });
    assert.equal(conclusive.emitted, true);
    assert.equal(Hooks.calls.length, 1);
    assert.equal(Hooks.calls[0].hook, BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK);
    assert.equal(Hooks.calls[0].payload.damage.applied, 0);
    const service = source("scripts/toolbelt-basic-save-service.js");
    const noDamageBlock = service.match(
      /if \(record\.multiplier === 0\) \{[\s\S]*?return;\r?\n  \}/,
    )?.[0] ?? "";
    assert.match(noDamageBlock, /emitBasicSaveTargetDamagePresentationFromApplication/);
    assert.doesNotMatch(noDamageBlock, /emitBasicSaveTargetDamageApplyingPresentationFromApplication/);
  });

  it("26-27. failure after reservation does not invent applied", () => {
    tryEmitBasicSaveTargetDamageApplyingPresentation(args());
    // No applied emit — consumer sees reservation without amount.
    assert.equal(Hooks.calls.length, 1);
    assert.equal(Hooks.calls[0].payload.stage, "targetDamageApplying");
  });

  it("28-30. NelCine delayed path still uses applyOne beforeApplyDamage", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /beforeApplyDamage:\s*\(\)\s*=>/);
    assert.match(service, /emitBasicSaveTargetDamageApplyingPresentationFromApplication/);
    assert.match(service, /AWAITING_IMPACT[\s\S]*applyOne/);
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(
      adapter,
      /beforeApplyDamage[\s\S]*applyDamage\(\{[\s\S]*skipIWR:\s*false/,
    );
  });

  it("31-33. privacy / plain JSON applying payload", () => {
    const built = buildBasicSaveTargetDamageApplyingPresentationPayload(args());
    assert.equal(built.ok, true);
    assert.equal(built.payload.stage, "targetDamageApplying");
    assert.equal(Object.hasOwn(built.payload, "damage"), false);
    JSON.parse(JSON.stringify(built.payload));
    assert.equal(
      evaluateBasicSaveTargetDamageApplyingPresentationEligibility({
        isGM: true,
        damageResultId: "x",
        alreadyEmitted: false,
        isBasicSave: true,
        private: true,
        targetTokenUuid: "Scene.s.Token.t",
        degreeOfSuccess: "failure",
        saveType: "reflex",
      }).reason,
      "private-save",
    );
  });

  it("34-43. mechanical / integration regression guards", () => {
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(adapter, /skipIWR:\s*false/);
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /Actor\.update|setFlag\(/);
    assert.doesNotMatch(source("scripts/toolbelt-basic-save-service.js"), /rollSaveForTarget|rollSaves\(/);
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 4);
    assert.equal(getBasicSaveDamagePresentationStatus().damageProducerAvailable, true);
    assert.equal(
      getBasicSaveDamagePresentationStatus().targetDamageApplyingHook,
      BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
    );
  });

  it("44-55. Strike protocol 4; safety + version 0.14.13", () => {
    assert.match(source("scripts/strike-presentation-feed.js"), /STRIKE_PRESENTATION_FEED_PROTOCOL = 4/);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeAttackResolvedPresentation/);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeDamageRolledPresentation/);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeResolvedPresentation/);
    assert.doesNotMatch(source("scripts/basic-save-damage-presentation-feed.js"), /floating|suppressNative|cssText/);
    assert.equal(JSON.parse(source("module.json")).version, "0.14.13");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.13");
    const id = buildBasicSaveTargetDamageResultId(args());
    assert.match(id, /:damage:/);
    emitBasicSaveTargetDamageApplyingPresentationFromApplication({
      draft: { integrationId: args().integrationId },
      record: {
        applicationId: args().applicationId,
        toolbeltTargetKey: "token-a",
        toolbeltStateFingerprint: "save-fp-a",
        tokenUuid: args().targetTokenUuid,
        effectiveOutcome: "failure",
      },
      target: {
        toolbeltTargetKey: "token-a",
        tokenUuid: args().targetTokenUuid,
        saveFingerprint: "save-fp-a",
        saveType: "reflex",
        degreeOfSuccess: "failure",
        isBasicSave: true,
        private: false,
      },
      normalized: {},
    });
    assert.equal(Hooks.calls.at(-1).hook, BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK);
  });
});
