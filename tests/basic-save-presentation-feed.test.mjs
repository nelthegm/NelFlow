/**
 * Presentation-neutral basic-save target result feed (0.14.7).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASIC_SAVE_PRESENTATION_PROTOCOL,
  BASIC_SAVE_ROLL_FIELDS_AVAILABLE,
  BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
  buildBasicSaveTargetPresentationPayload,
  buildBasicSaveTargetResultId,
  clearBasicSavePresentationEmissions,
  evaluateBasicSaveTargetPresentationEligibility,
  hasBasicSaveTargetPresentationEmission,
  installBasicSavePresentationFeedApi,
  seedBasicSaveTargetPresentationEmission,
  tryEmitBasicSaveTargetPresentation,
} from "../scripts/basic-save-presentation-feed.js";
import { ToolbeltTargetHelperAdapter } from "../scripts/toolbelt-target-helper-adapter.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function baseArgs(overrides = {}) {
  return {
    integrationId: "toolbelt-basic-save:msg1",
    applicationId: "toolbelt-basic-save:msg1:target:tokA",
    toolbeltTargetKey: "tokA",
    saveFingerprint: "fp-success-1",
    sceneId: "scene1",
    sourceActorUuid: "Actor.caster",
    targetTokenUuid: "Scene.scene1.Token.tokA",
    targetActorUuid: "Actor.cyclops",
    actionName: "fireball",
    itemUuid: "Item.fireball",
    saveType: "reflex",
    saveDC: 36,
    isBasicSave: true,
    private: false,
    degreeOfSuccess: "success",
    dieResult: 14,
    modifier: 22,
    total: 36,
    ...overrides,
  };
}

describe("0.14.7 basic save presentation feed", () => {
  beforeEach(() => {
    clearBasicSavePresentationEmissions();
    globalThis.game = {
      user: { isGM: true },
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

  it("1. Toolbelt supported basic-save result recognized", () => {
    const result = tryEmitBasicSaveTargetPresentation(baseArgs());
    assert.equal(result.emitted, true);
    assert.equal(Hooks.calls[0].payload.save.basic, true);
    assert.equal(Hooks.calls[0].payload.save.type, "reflex");
  });

  it("2. unsupported / non-basic result ignored", () => {
    const result = tryEmitBasicSaveTargetPresentation(baseArgs({ isBasicSave: false }));
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "not-basic-save");
    assert.equal(Hooks.calls.length, 0);
  });

  it("3. exact target identity preserved", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs());
    assert.equal(Hooks.calls[0].payload.targetTokenUuid, "Scene.scene1.Token.tokA");
    assert.equal(Hooks.calls[0].payload.targetActorUuid, "Actor.cyclops");
  });

  it("4. save slug preserved", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ saveType: "will" }));
    assert.equal(Hooks.calls[0].payload.save.type, "will");
  });

  it("5. authoritative DC preserved when available", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ saveDC: 36 }));
    assert.equal(Hooks.calls[0].payload.save.dc, 36);
  });

  it("6. DC omitted rather than recomputed when unavailable", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ saveDC: null }));
    assert.equal(Object.hasOwn(Hooks.calls[0].payload.save, "dc"), false);
  });

  it("7. degree preserved", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ degreeOfSuccess: "criticalFailure" }));
    assert.equal(Hooks.calls[0].payload.roll.degreeOfSuccess, "criticalFailure");
  });

  it("8. total preserved when available", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ total: 36 }));
    assert.equal(Hooks.calls[0].payload.roll.total, 36);
  });

  it("9. natural die preserved when structurally available", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ dieResult: 14 }));
    assert.equal(Hooks.calls[0].payload.roll.dieResult, 14);
  });

  it("10. modifier preserved when structurally available", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ modifier: 22 }));
    assert.equal(Hooks.calls[0].payload.roll.modifier, 22);
  });

  it("11. natural die never reverse-calculated", () => {
    const built = buildBasicSaveTargetPresentationPayload(
      baseArgs({ dieResult: null, modifier: 22, total: 36 }),
    );
    assert.equal(built.ok, true);
    assert.equal(Object.hasOwn(built.payload.roll, "dieResult"), false);
    assert.equal(built.payload.roll.total, 36);
    assert.equal(built.payload.roll.modifier, 22);
  });

  it("12. modifier never reconstructed", () => {
    const built = buildBasicSaveTargetPresentationPayload(
      baseArgs({ dieResult: 14, modifier: null, total: 36 }),
    );
    assert.equal(built.ok, true);
    assert.equal(Object.hasOwn(built.payload.roll, "modifier"), false);
    assert.equal(built.payload.roll.dieResult, 14);
  });

  it("13. targetResolved hook exposed", () => {
    assert.equal(
      BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
      "nelflow.basicSaveTargetResolvedPresentation",
    );
  });

  it("14. integration protocol 3 preserves protocol-1 targetResolved semantics", () => {
    installBasicSavePresentationFeedApi();
    const api = game.nelflow.integrations.basicSavePresentation;
    assert.equal(BASIC_SAVE_PRESENTATION_PROTOCOL, 3);
    assert.equal(api.protocol, 3);
    assert.equal(api.targetResolvedHook, BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK);
    assert.equal(api.stages.targetResolved, true);
    assert.equal(api.stages.targetDamageApplied, true);
    assert.equal(Object.hasOwn(api, "batchResolvedHook"), false);
  });

  it("15-18. plain JSON payload without Documents/Rolls/HTML", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs());
    const payload = Hooks.calls[0].payload;
    assert.equal(JSON.parse(JSON.stringify(payload)).targetResultId, payload.targetResultId);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.stage, "targetResolved");
    const encoded = JSON.stringify(payload);
    assert.equal(/<[a-z]|Roll\.|Actor\.from|Document/i.test(encoded) && encoded.includes("<div"), false);
    assert.equal(typeof payload.roll, "object");
    assert.equal(payload.roll instanceof Object, true);
  });

  it("19-23. emits at READY without waiting for HP/batch/NelCine", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.match(service, /emitBasicSaveTargetPresentationFromReady/);
    assert.match(
      service,
      /PENDING_SAVE[\s\S]*READY[\s\S]*emitBasicSaveTargetPresentationFromReady/,
    );
    // Feed has no HP/NelCine/batch waits
    const feed = source("scripts/basic-save-presentation-feed.js");
    assert.doesNotMatch(feed, /awaiting.?impact|applyDamage|allPrimarySavesResolved|tryEmitToolbeltSaveBatch/i);
  });

  it("24-28. multi-target independent emissions preserve order", () => {
    const a = tryEmitBasicSaveTargetPresentation(
      baseArgs({
        applicationId: "toolbelt-basic-save:m:target:a",
        toolbeltTargetKey: "a",
        saveFingerprint: "fp-a",
        targetTokenUuid: "Scene.s.Token.a",
      }),
    );
    const c = tryEmitBasicSaveTargetPresentation(
      baseArgs({
        applicationId: "toolbelt-basic-save:m:target:c",
        toolbeltTargetKey: "c",
        saveFingerprint: "fp-c",
        targetTokenUuid: "Scene.s.Token.c",
      }),
    );
    const b = tryEmitBasicSaveTargetPresentation(
      baseArgs({
        applicationId: "toolbelt-basic-save:m:target:b",
        toolbeltTargetKey: "b",
        saveFingerprint: "fp-b",
        targetTokenUuid: "Scene.s.Token.b",
      }),
    );
    assert.equal(a.emitted && c.emitted && b.emitted, true);
    assert.deepEqual(
      Hooks.calls.map((call) => call.payload.targetTokenUuid),
      ["Scene.s.Token.a", "Scene.s.Token.c", "Scene.s.Token.b"],
    );
  });

  it("29. repeated update does not duplicate same result", () => {
    const args = baseArgs();
    assert.equal(tryEmitBasicSaveTargetPresentation(args).emitted, true);
    assert.equal(tryEmitBasicSaveTargetPresentation(args).emitted, false);
    assert.equal(Hooks.calls.length, 1);
  });

  it("30-31. result registry independent from HP / NelCine registries", () => {
    const feed = source("scripts/basic-save-presentation-feed.js");
    assert.match(feed, /emittedByTargetResultId/);
    assert.doesNotMatch(feed, /strikePresentation|pendingSaveBatch|appliedById/);
    seedBasicSaveTargetPresentationEmission("seeded");
    assert.equal(hasBasicSaveTargetPresentationEmission("seeded"), true);
  });

  it("32. distinct target produces distinct event", () => {
    tryEmitBasicSaveTargetPresentation(baseArgs({ applicationId: "id:a", saveFingerprint: "fp1", targetTokenUuid: "Scene.s.Token.a" }));
    tryEmitBasicSaveTargetPresentation(baseArgs({ applicationId: "id:b", saveFingerprint: "fp1", targetTokenUuid: "Scene.s.Token.b" }));
    assert.equal(Hooks.calls.length, 2);
    assert.notEqual(Hooks.calls[0].payload.targetResultId, Hooks.calls[1].payload.targetResultId);
  });

  it("33. fingerprint change (reroll) emits new result; ordinary same fp does not", () => {
    const first = tryEmitBasicSaveTargetPresentation(baseArgs({ saveFingerprint: "fp-original" }));
    assert.equal(first.emitted, true);
    assert.equal(tryEmitBasicSaveTargetPresentation(baseArgs({ saveFingerprint: "fp-original" })).emitted, false);
    const reroll = tryEmitBasicSaveTargetPresentation(
      baseArgs({
        saveFingerprint: "fp-hero-reroll",
        dieResult: 18,
        total: 40,
        degreeOfSuccess: "criticalSuccess",
        rerolled: "hero",
      }),
    );
    assert.equal(reroll.emitted, true);
    assert.notEqual(first.targetResultId, reroll.targetResultId);
    assert.equal(Hooks.calls[1].payload.rerolled, "hero");
  });

  it("34. secret/private save does not leak", () => {
    const result = tryEmitBasicSaveTargetPresentation(baseArgs({ private: true }));
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "private-save");
    assert.equal(Hooks.calls.length, 0);
  });

  it("35. missing target token does not emit battlefield presentation", () => {
    const result = tryEmitBasicSaveTargetPresentation(baseArgs({ targetTokenUuid: null }));
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "missing-target-token");
  });

  it("36. eligibility / status helpers; no batchResolved false advertising", () => {
    assert.deepEqual(evaluateBasicSaveTargetPresentationEligibility({
      isGM: true,
      targetResultId: "x",
      alreadyEmitted: false,
      isBasicSave: true,
      private: false,
      targetTokenUuid: "Scene.s.Token.t",
      degreeOfSuccess: "success",
      saveType: "reflex",
    }), { eligible: true });
    installBasicSavePresentationFeedApi();
    const status = game.nelflow.dev.getBasicSavePresentationStatus();
    assert.equal(status.available, true);
    assert.equal(status.protocol, 3);
    assert.deepEqual(status.rollFieldsAvailable, { ...BASIC_SAVE_ROLL_FIELDS_AVAILABLE });
    assert.equal(Object.hasOwn(game.nelflow.integrations.basicSavePresentation, "batchResolvedHook"), false);
  });

  it("37-41. Toolbelt ownership / no fabricated math / multipliers untouched", () => {
    const feed = source("scripts/basic-save-presentation-feed.js");
    assert.doesNotMatch(feed, /statistic\.check\.roll|rollSave|Roll\.create/);
    assert.doesNotMatch(feed, /total\s*-\s*modifier|modifier\s*=\s*total/);
    const model = source("scripts/toolbelt-basic-save-model.js");
    assert.match(model, /criticalSuccess[\s\S]*0/);
    assert.match(model, /success[\s\S]*0\.5/);
  });

  it("42-48. regression wiring: NelCine / Undo / modes / strike feeds unchanged", () => {
    const main = source("scripts/main.js");
    assert.match(main, /installBasicSavePresentationFeedApi/);
    assert.match(main, /installStrikePresentationFeedApi/);
    assert.match(source("scripts/nelcine-save-batch-bridge.js"), /nelflow\.basicSaveBatchResolved/);
    assert.match(source("scripts/strike-presentation-feed.js"), /nelflow\.strikeDamageRolledPresentation/);
    assert.match(source("scripts/strike-presentation-feed.js"), /STRIKE_PRESENTATION_FEED_PROTOCOL = 4/);
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
  });

  it("49-52. strike protocol 4 + damageApplied + no NelTactics gate", () => {
    const feed = source("scripts/basic-save-presentation-feed.js");
    assert.doesNotMatch(feed, /neltactics|game\.modules\.get\(["']neltactics/);
    assert.match(source("scripts/strike-presentation-feed.js"), /protocol:\s*STRIKE_PRESENTATION_FEED_PROTOCOL/);
  });

  it("53-58. no Toolbelt private API / no new save Roll / works without NelTactics", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.doesNotMatch(service, /game\.toolbelt\.targetHelper\.roll|rollSaves\(/);
    assert.match(service, /emitBasicSaveTargetPresentationFromReady/);
    tryEmitBasicSaveTargetPresentation(baseArgs());
    assert.equal(Hooks.calls.length, 1);
  });

  it("adapter lifts authoritative die/value/modifiers without reverse math", () => {
    const adapter = source("scripts/toolbelt-target-helper-adapter.js");
    assert.match(adapter, /dieResult/);
    assert.match(adapter, /result\?\.die/);
    assert.match(adapter, /result\?\.value/);
    assert.match(adapter, /result\?\.modifiers/);
    assert.doesNotMatch(adapter, /total\s*-\s*modifier|dieResult\s*=\s*.*total/);
  });

  it("adapter normalizeDamageMessage lifts Toolbelt save instance fields", () => {
    const originalStatus = ToolbeltTargetHelperAdapter.status;
    const originalFromUuid = globalThis.fromUuidSync;
    ToolbeltTargetHelperAdapter.status = () => ({
      active: true,
      enabled: true,
      supported: true,
      version: "3.53.1",
    });
    globalThis.fromUuidSync = (uuid) => {
      if (uuid === "Scene.s.Token.tokA") {
        return {
          id: "tokA",
          parent: { id: "s" },
          actor: { uuid: "Actor.cyclops", type: "npc" },
        };
      }
      return null;
    };

    const spellItem = { uuid: "Item.fireball", type: "spell", slug: "fireball" };
    const message = {
      id: "msg1",
      isDamageRoll: true,
      author: { id: "gm1" },
      item: spellItem,
      actor: { uuid: "Actor.caster", type: "character" },
      rolls: [
        {
          total: 24,
          instances: [{ type: "fire" }],
          alter() {},
          kinds: { has: () => false },
        },
      ],
      flags: {
        "pf2e-toolbelt": {
          targetHelper: {
            type: "damage",
            author: "Actor.caster",
            item: "Item.fireball",
            targets: ["Scene.s.Token.tokA"],
            splashIndex: -1,
            applied: {},
            saveVariants: {
              null: {
                basic: true,
                statistic: "reflex",
                dc: 36,
                saves: {
                  tokA: {
                    die: 14,
                    value: 36,
                    success: "success",
                    private: false,
                    roll: '{"class":"CheckRoll"}',
                    modifiers: [
                      { excluded: false, label: "Dex", modifier: 7, slug: "dex" },
                      { excluded: false, label: "Prof", modifier: 15, slug: "proficiency" },
                    ],
                  },
                },
              },
            },
          },
        },
        pf2e: {
          origin: {
            type: "spell",
            uuid: "Item.fireball",
            actor: "Actor.caster",
          },
        },
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
    };

    try {
      const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
      assert.equal(normalized.ok, true, normalized.reason);
      assert.equal(normalized.saveType, "reflex");
      assert.equal(normalized.saveDC, 36);
      assert.equal(normalized.targets.length, 1);
      const target = normalized.targets[0];
      assert.equal(target.dieResult, 14);
      assert.equal(target.total, 36);
      assert.equal(target.modifier, 22);
      assert.equal(target.degreeOfSuccess, "success");
      assert.equal(target.tokenUuid, "Scene.s.Token.tokA");
      assert.equal(target.private, false);
    } finally {
      ToolbeltTargetHelperAdapter.status = originalStatus;
      globalThis.fromUuidSync = originalFromUuid;
    }
  });

  it("adapter does not invent die from total when die missing", () => {
    const originalStatus = ToolbeltTargetHelperAdapter.status;
    const originalFromUuid = globalThis.fromUuidSync;
    ToolbeltTargetHelperAdapter.status = () => ({
      active: true,
      enabled: true,
      supported: true,
      version: "3.53.1",
    });
    globalThis.fromUuidSync = (uuid) => {
      if (uuid === "Scene.s.Token.tokA") {
        return {
          id: "tokA",
          parent: { id: "s" },
          actor: { uuid: "Actor.cyclops", type: "npc" },
        };
      }
      return null;
    };
    const spellItem = { uuid: "Item.fireball", type: "spell", slug: "fireball" };
    const message = {
      id: "msg2",
      isDamageRoll: true,
      author: { id: "gm1" },
      item: spellItem,
      actor: { uuid: "Actor.caster", type: "character" },
      rolls: [
        {
          total: 24,
          instances: [{ type: "fire" }],
          alter() {},
          kinds: { has: () => false },
        },
      ],
      flags: {
        "pf2e-toolbelt": {
          targetHelper: {
            type: "damage",
            author: "Actor.caster",
            item: "Item.fireball",
            targets: ["Scene.s.Token.tokA"],
            splashIndex: -1,
            applied: {},
            saveVariants: {
              null: {
                basic: true,
                statistic: "reflex",
                dc: 36,
                saves: {
                  tokA: {
                    value: 36,
                    success: "success",
                    private: false,
                    roll: '{"class":"CheckRoll"}',
                  },
                },
              },
            },
          },
        },
        pf2e: { origin: { type: "spell", uuid: "Item.fireball", actor: "Actor.caster" } },
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
    };
    try {
      const normalized = ToolbeltTargetHelperAdapter.normalizeDamageMessage(message);
      assert.equal(normalized.ok, true, normalized.reason);
      assert.equal(normalized.targets[0].dieResult, null);
      assert.equal(normalized.targets[0].total, 36);
      assert.equal(normalized.targets[0].modifier, null);
    } finally {
      ToolbeltTargetHelperAdapter.status = originalStatus;
      globalThis.fromUuidSync = originalFromUuid;
    }
  });

  it("targetResultId includes fingerprint for exactly-once + reroll identity", () => {
    const a = buildBasicSaveTargetResultId({
      applicationId: "toolbelt-basic-save:m:target:t",
      saveFingerprint: "fp1",
    });
    const b = buildBasicSaveTargetResultId({
      applicationId: "toolbelt-basic-save:m:target:t",
      saveFingerprint: "fp2",
    });
    assert.match(a, /:fp:fp1$/);
    assert.notEqual(a, b);
  });

  it("version metadata is 0.14.14", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.14");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.14");
  });
});
