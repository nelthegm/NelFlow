/**
 * Toolbelt 3.54.0 compatibility + presentation API independence (0.14.8).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOOLBELT_MAX_VERSION,
  TOOLBELT_MIN_VERSION,
  evaluateToolbeltCompatibility,
  isSupportedToolbeltVersion,
  ToolbeltTargetHelperAdapter,
} from "../scripts/toolbelt-target-helper-adapter.js";
import {
  BASIC_SAVE_PRESENTATION_PROTOCOL,
  BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
  clearBasicSavePresentationEmissions,
  getBasicSavePresentationStatus,
  installBasicSavePresentationFeedApi,
  tryEmitBasicSaveTargetPresentation,
} from "../scripts/basic-save-presentation-feed.js";
import {
  STRIKE_ATTACK_PRESENTATION_FEED_HOOK,
  STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_HOOK,
  STRIKE_PRESENTATION_FEED_PROTOCOL,
  clearStrikePresentationFeedEmissions,
  installStrikePresentationFeedApi,
} from "../scripts/strike-presentation-feed.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

function mockToolbelt(version, { active = true, enabled = true } = {}) {
  globalThis.game = {
    user: { isGM: true },
    modules: {
      get: (id) =>
        id === "pf2e-toolbelt"
          ? { active, version, manifest: { version } }
          : undefined,
    },
    settings: {
      get: (scope, key) => {
        if (scope === "pf2e-toolbelt" && key === "targetHelper.enabled") return enabled;
        return null;
      },
    },
    nelflow: undefined,
    toolbelt: undefined,
  };
}

describe("0.14.8 Toolbelt 3.54.0 compatibility", () => {
  beforeEach(() => {
    clearBasicSavePresentationEmissions();
    clearStrikePresentationFeedEmissions();
    mockToolbelt("3.54.0");
    globalThis.Hooks = {
      calls: [],
      callAll(hook, payload) {
        this.calls.push({ hook, payload });
      },
    };
  });

  it("1-4. version gate includes 3.52–3.54.0; rejects 3.55", () => {
    assert.equal(TOOLBELT_MIN_VERSION, "3.52.0");
    assert.equal(TOOLBELT_MAX_VERSION, "3.54.0");
    assert.equal(isSupportedToolbeltVersion("3.52.0"), true);
    assert.equal(isSupportedToolbeltVersion("3.53.1"), true);
    assert.equal(isSupportedToolbeltVersion("3.54.0"), true);
    assert.equal(isSupportedToolbeltVersion("3.55.0"), false);
    assert.equal(evaluateToolbeltCompatibility({ version: "3.55.0" }).reason, "toolbelt-version-unverified");
    assert.match(source("lang/en.json"), /This PF2e Toolbelt version is not supported by Nelflow/);
  });

  it("5-16. 3.54 durable Target Helper fields remain recognized", () => {
    const originalStatus = ToolbeltTargetHelperAdapter.status;
    const originalFromUuid = globalThis.fromUuidSync;
    ToolbeltTargetHelperAdapter.status = () => ({
      active: true,
      enabled: true,
      supported: true,
      version: "3.54.0",
    });
    globalThis.fromUuidSync = (uuid) => {
      if (uuid === "Scene.s.Token.tokA") {
        return { id: "tokA", parent: { id: "s" }, actor: { uuid: "Actor.cyclops", type: "npc" } };
      }
      return null;
    };
    const spellItem = { uuid: "Item.fireball", type: "spell", slug: "fireball" };
    const message = {
      id: "msg354",
      isDamageRoll: true,
      author: { id: "gm1" },
      item: spellItem,
      actor: { uuid: "Actor.caster", type: "character" },
      rolls: [{ total: 24, instances: [{ type: "fire" }], alter() {}, kinds: { has: () => false } }],
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
                    rerolled: "hero",
                    roll: '{"class":"CheckRoll","total":36}',
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
        pf2e: { origin: { type: "spell", uuid: "Item.fireball", actor: "Actor.caster" } },
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
      const target = normalized.targets[0];
      assert.equal(target.tokenUuid, "Scene.s.Token.tokA");
      assert.equal(target.dieResult, 14);
      assert.equal(target.total, 36);
      assert.equal(target.degreeOfSuccess, "success");
      assert.equal(target.modifier, 22);
      assert.equal(target.private, false);
      assert.equal(target.rerolled, "hero");
      assert.ok(target.saveFingerprint);
      assert.equal(target.isBasicSave, true);
    } finally {
      ToolbeltTargetHelperAdapter.status = originalStatus;
      globalThis.fromUuidSync = originalFromUuid;
    }
  });

  it("17-25. save presentation feed works under 3.54 status", () => {
    mockToolbelt("3.54.0");
    installBasicSavePresentationFeedApi();
    const status = getBasicSavePresentationStatus();
    assert.equal(status.protocol, 3);
    assert.equal(status.toolbeltVersion, "3.54.0");
    assert.equal(status.toolbeltSupported, true);
    assert.equal(status.producerAvailable, true);
    assert.equal(status.targetResolvedHook, BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK);

    const emitted = tryEmitBasicSaveTargetPresentation({
      integrationId: "toolbelt-basic-save:m",
      applicationId: "toolbelt-basic-save:m:target:a",
      saveFingerprint: "fp1",
      targetTokenUuid: "Scene.s.Token.a",
      targetActorUuid: "Actor.a",
      saveType: "reflex",
      saveDC: 36,
      isBasicSave: true,
      degreeOfSuccess: "success",
      dieResult: 14,
      modifier: 22,
      total: 36,
    });
    assert.equal(emitted.emitted, true);
    assert.equal(Hooks.calls[0].payload.roll.dieResult, 14);
    assert.equal(Hooks.calls[0].payload.roll.modifier, 22);
    assert.equal(Hooks.calls[0].payload.roll.total, 36);
    assert.equal(Hooks.calls[0].payload.roll.degreeOfSuccess, "success");

    assert.equal(
      tryEmitBasicSaveTargetPresentation({
        integrationId: "toolbelt-basic-save:m",
        applicationId: "toolbelt-basic-save:m:target:a",
        saveFingerprint: "fp1",
        targetTokenUuid: "Scene.s.Token.a",
        saveType: "reflex",
        isBasicSave: true,
        degreeOfSuccess: "success",
        total: 36,
      }).emitted,
      false,
    );

    assert.equal(
      tryEmitBasicSaveTargetPresentation({
        integrationId: "toolbelt-basic-save:m",
        applicationId: "toolbelt-basic-save:m:target:a",
        saveFingerprint: "fp2",
        targetTokenUuid: "Scene.s.Token.a",
        saveType: "reflex",
        isBasicSave: true,
        degreeOfSuccess: "criticalSuccess",
        dieResult: 18,
        total: 40,
        rerolled: "hero",
      }).emitted,
      true,
    );

    assert.equal(
      tryEmitBasicSaveTargetPresentation({
        integrationId: "toolbelt-basic-save:m",
        applicationId: "toolbelt-basic-save:m:target:b",
        saveFingerprint: "fp-b",
        targetTokenUuid: "Scene.s.Token.b",
        saveType: "reflex",
        isBasicSave: true,
        private: true,
        degreeOfSuccess: "failure",
        total: 10,
      }).emitted,
      false,
    );
  });

  it("26-31. Toolbelt ownership / mechanics guards unchanged in source", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.doesNotMatch(service, /game\.toolbelt\.targetHelper\.roll|rollSaves\(/);
    assert.match(service, /emitBasicSaveTargetPresentationFromReady/);
    assert.match(source("scripts/toolbelt-target-helper-adapter.js"), /setMessageFlagTargets|getMessageTargets/);
    assert.doesNotMatch(source("scripts/basic-save-presentation-feed.js"), /setFlag\(|Actor\.update/);
  });

  it("32-39. Strike protocol 4 registers with supported and unsupported Toolbelt", () => {
    mockToolbelt("3.54.0");
    installStrikePresentationFeedApi();
    assert.equal(game.nelflow.integrations.strikePresentation.protocol, STRIKE_PRESENTATION_FEED_PROTOCOL);
    assert.equal(game.nelflow.integrations.strikePresentation.protocol, 4);
    assert.equal(game.nelflow.integrations.strikePresentation.getStatus().independentOfTargetHelper, true);
    assert.equal(game.nelflow.integrations.strikePresentation.attackHook, STRIKE_ATTACK_PRESENTATION_FEED_HOOK);
    assert.equal(
      game.nelflow.integrations.strikePresentation.damageRolledHook,
      STRIKE_DAMAGE_ROLLED_PRESENTATION_FEED_HOOK,
    );
    assert.equal(game.nelflow.integrations.strikePresentation.resolvedHook, STRIKE_PRESENTATION_FEED_HOOK);

    mockToolbelt("3.55.0");
    installStrikePresentationFeedApi();
    assert.equal(game.nelflow.integrations.strikePresentation.protocol, 4);
    assert.equal(game.nelflow.integrations.strikePresentation.available, true);
    assert.equal(ToolbeltTargetHelperAdapter.status().supported, false);
  });

  it("40-43. init installs presentation APIs before ready Toolbelt work", () => {
    const main = source("scripts/main.js");
    assert.match(main, /operation:\s*"init-install"/);
    assert.match(
      main,
      /Hooks\.once\("init"[\s\S]*installStrikePresentationFeedApi[\s\S]*installBasicSavePresentationFeedApi/,
    );
    assert.match(main, /Idempotent reinstall/);
    // Toolbelt initialize remains separate and cannot gate init install.
    assert.match(main, /ToolbeltBasicSaveService\.initialize/);
  });

  it("unsupported Toolbelt keeps basicSave contract but marks producer unavailable", () => {
    mockToolbelt("3.55.0");
    installBasicSavePresentationFeedApi();
    const status = getBasicSavePresentationStatus();
    assert.equal(status.available, true);
    assert.equal(status.protocol, BASIC_SAVE_PRESENTATION_PROTOCOL);
    assert.equal(status.toolbeltSupported, false);
    assert.equal(status.producerAvailable, false);
    assert.equal(status.toolbeltVersion, "3.55.0");
  });

  it("44-48. damageApplied / no Toolbelt private API / version 0.14.13", () => {
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
    assert.doesNotMatch(source("scripts/toolbelt-basic-save-service.js"), /rollSaveForTarget/);
    assert.equal(JSON.parse(source("module.json")).version, "0.14.13");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.13");
    assert.equal(TOOLBELT_MAX_VERSION, "3.54.0");
  });
});
