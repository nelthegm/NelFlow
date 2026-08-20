/** Focused PF2e Toolbelt 3.54.1 compatibility audit for Nelflow 0.14.14. */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TOOLBELT_MAX_VERSION,
  TOOLBELT_MIN_VERSION,
  TOOLBELT_SCHEMA_COMPATIBILITY,
  TOOLBELT_SUPPORTED_RANGE,
  ToolbeltTargetHelperAdapter,
  evaluateToolbeltCompatibility,
  isSupportedToolbeltVersion,
  toolbeltStateFingerprint,
} from "../scripts/toolbelt-target-helper-adapter.js";
import {
  TOOLBELT_TARGET_STATES,
  applicationId,
  createTargetRecord,
  isReplaySafe,
} from "../scripts/toolbelt-basic-save-model.js";
import {
  BASIC_SAVE_PRESENTATION_PROTOCOL,
  BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK,
  clearBasicSavePresentationEmissions,
  getBasicSavePresentationStatus,
  tryEmitBasicSaveTargetPresentation,
} from "../scripts/basic-save-presentation-feed.js";
import {
  BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK,
  BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK,
  clearBasicSaveDamagePresentationEmissions,
  deriveActualBasicSaveHpLoss,
} from "../scripts/basic-save-damage-presentation-feed.js";
import { STRIKE_PRESENTATION_FEED_PROTOCOL } from "../scripts/strike-presentation-feed.js";
import { SPELL_ATTACK_PRESENTATION_PROTOCOL } from "../scripts/spell-attack-presentation-feed.js";
import { HEALING_PRESENTATION_PROTOCOL } from "../scripts/healing-presentation-feed.js";
import {
  TOOLBELT_3541_AUDIT,
  createToolbelt3541DamageMessage,
  createToolbelt3541TargetHelperFlag,
  tokenFor3541Fixture,
} from "./fixtures/toolbelt-target-helper-3.54.1.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const source = (relative) => readFileSync(join(root, "..", relative), "utf8");

function installEnvironment(version = "3.54.1", enabled = true) {
  globalThis.game = {
    user: { id: "gm1", isGM: true },
    users: { get: (id) => ({ id, isGM: id === "gm1" }) },
    modules: {
      get: (id) =>
        id === "pf2e-toolbelt"
          ? { id, active: true, version, manifest: { version } }
          : undefined,
    },
    settings: {
      get: (scope, key) =>
        scope === "pf2e-toolbelt" && key === "targetHelper.enabled" ? enabled : null,
    },
    toolbelt: undefined,
    nelflow: undefined,
  };
  globalThis.Hooks = {
    calls: [],
    callAll(hook, payload) {
      this.calls.push({ hook, payload });
    },
  };
  globalThis.fromUuidSync = tokenFor3541Fixture;
}

function normalize3541() {
  return ToolbeltTargetHelperAdapter.normalizeDamageMessage(createToolbelt3541DamageMessage());
}

function resolvedArgs(target, suffix = "result") {
  return {
    integrationId: "toolbelt-basic-save:toolbelt-3541-damage",
    applicationId: `toolbelt-basic-save:toolbelt-3541-damage:target:${target.toolbeltTargetKey}`,
    saveFingerprint: target.saveFingerprint,
    targetTokenUuid: target.tokenUuid,
    targetActorUuid: target.actorUuid,
    saveType: target.saveType,
    saveDC: 36,
    isBasicSave: true,
    private: target.private,
    degreeOfSuccess: target.degreeOfSuccess,
    dieResult: target.dieResult,
    modifier: target.modifier,
    total: target.total,
    rerolled: target.rerolled,
    actionName: suffix,
  };
}

describe("Nelflow 0.14.14 — PF2e Toolbelt 3.54.1 compatibility", () => {
  beforeEach(() => {
    installEnvironment();
    clearBasicSavePresentationEmissions();
    clearBasicSaveDamagePresentationEmissions();
  });

  afterEach(() => {
    delete globalThis.game;
    delete globalThis.Hooks;
    delete globalThis.fromUuidSync;
  });

  it("1. Toolbelt 3.54.0 remains supported", () => {
    assert.equal(isSupportedToolbeltVersion("3.54.0"), true);
  });
  it("2. Toolbelt 3.54.1 is supported", () => {
    assert.equal(isSupportedToolbeltVersion("3.54.1"), true);
  });
  it("3. Toolbelt 3.54.2 remains unsupported", () => {
    assert.equal(isSupportedToolbeltVersion("3.54.2"), false);
  });
  it("4. Toolbelt 3.55.0 remains unsupported", () => {
    assert.equal(isSupportedToolbeltVersion("3.55.0"), false);
  });
  it("5. lower currently-supported versions remain unchanged", () => {
    assert.equal(TOOLBELT_MIN_VERSION, "3.52.0");
    assert.equal(isSupportedToolbeltVersion("3.52.0"), true);
    assert.equal(isSupportedToolbeltVersion("3.51.9"), false);
  });
  it("6. semantic comparison does not confuse 3.54.10 with 3.54.1", () => {
    assert.equal(TOOLBELT_MAX_VERSION, "3.54.1");
    assert.equal(isSupportedToolbeltVersion("3.54.10"), false);
  });

  it("7. 3.54.1 Target Helper namespace is recognized", () => {
    assert.ok(createToolbelt3541DamageMessage().flags["pf2e-toolbelt"].targetHelper);
    assert.equal(normalize3541().ok, true);
  });
  it("8. 3.54.1 saveVariants location is recognized", () => {
    assert.ok(createToolbelt3541TargetHelperFlag().saveVariants.null);
    assert.equal(normalize3541().variantId, "null");
  });
  it("9. 3.54.1 statistic is preserved", () => {
    assert.equal(normalize3541().saveType, "reflex");
  });
  it("10. 3.54.1 DC is preserved", () => {
    assert.equal(normalize3541().saveDC, 36);
  });
  it("11. 3.54.1 basic-save flag is preserved", () => {
    assert.equal(normalize3541().targets.every((target) => target.isBasicSave), true);
  });
  it("12. 3.54.1 target token keys are preserved", () => {
    assert.deepEqual(normalize3541().targets.map((target) => target.toolbeltTargetKey), ["tokA", "tokB", "tokC"]);
  });
  it("13. 3.54.1 natural die is preserved", () => {
    assert.deepEqual(normalize3541().targets.map((target) => target.dieResult), [14, 7, 20]);
  });
  it("14. 3.54.1 total/value is preserved", () => {
    assert.deepEqual(normalize3541().targets.map((target) => target.total), [36, 28, 41]);
  });
  it("15. 3.54.1 degree is preserved", () => {
    assert.deepEqual(normalize3541().targets.map((target) => target.degreeOfSuccess), ["success", "failure", "criticalSuccess"]);
  });
  it("16. 3.54.1 modifiers are preserved without reverse calculation", () => {
    const [target] = normalize3541().targets;
    assert.equal(target.modifier, 22);
    assert.deepEqual(target.modifiers.map(({ modifier }) => modifier), [7, 15]);
  });
  it("17. 3.54.1 private flag is preserved", () => {
    assert.equal(normalize3541().targets[2].private, true);
  });
  it("18. 3.54.1 rerolled field is handled", () => {
    assert.equal(normalize3541().targets[1].rerolled, "hero");
  });
  it("19. 3.54.1 serialized roll participates in the fingerprint", () => {
    const first = createToolbelt3541TargetHelperFlag();
    const second = structuredClone(first);
    second.saveVariants.null.saves.tokA.roll = '{"class":"CheckRoll","total":37,"die":15}';
    assert.notEqual(toolbeltStateFingerprint(first), toolbeltStateFingerprint(second));
  });

  it("20. resolved 3.54.1 target reaches READY", () => {
    const normalized = normalize3541();
    const record = createTargetRecord({ integrationId: "toolbelt-basic-save:m", rollIndex: 0 }, normalized.targets[0]);
    assert.equal(record.state, TOOLBELT_TARGET_STATES.READY);
  });
  it("21. targetResolved emits exactly once", () => {
    const args = resolvedArgs(normalize3541().targets[0]);
    assert.equal(tryEmitBasicSaveTargetPresentation(args).emitted, true);
    assert.equal(tryEmitBasicSaveTargetPresentation(args).emitted, false);
  });
  it("22. targetResolved preserves exact target", () => {
    const target = normalize3541().targets[1];
    tryEmitBasicSaveTargetPresentation(resolvedArgs(target));
    assert.equal(Hooks.calls[0].payload.targetTokenUuid, "Scene.encounter.Token.tokB");
  });
  it("23. multi-target save results remain independent", () => {
    const targets = normalize3541().targets.slice(0, 2);
    for (const target of targets) tryEmitBasicSaveTargetPresentation(resolvedArgs(target));
    assert.equal(Hooks.calls.length, 2);
    assert.notEqual(Hooks.calls[0].payload.targetResultId, Hooks.calls[1].payload.targetResultId);
  });
  it("24. private target presentation remains suppressed", () => {
    const privateTarget = normalize3541().targets[2];
    assert.equal(tryEmitBasicSaveTargetPresentation(resolvedArgs(privateTarget)).emitted, false);
    assert.equal(Hooks.calls.length, 0);
  });

  it("25. unchanged message update retains one fingerprint", () => {
    const flag = createToolbelt3541TargetHelperFlag();
    assert.equal(toolbeltStateFingerprint(flag), toolbeltStateFingerprint(structuredClone(flag)));
  });
  it("26. actual reroll produces a different fingerprint", () => {
    const before = createToolbelt3541TargetHelperFlag();
    const after = structuredClone(before);
    after.saveVariants.null.saves.tokA.rerolled = "hero";
    after.saveVariants.null.saves.tokA.roll = '{"class":"CheckRoll","total":40,"die":18}';
    assert.notEqual(toolbeltStateFingerprint(before), toolbeltStateFingerprint(after));
  });
  it("27. superseded fingerprint is revalidated before damage application", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.ok(service.indexOf("latest.saveFingerprint !== record.toolbeltStateFingerprint") < service.indexOf("PF2eAdapter.applyDamageRollToRecordedTarget"));
  });

  it("28. applying event remains immediately before PF2e apply", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(service, /beforeApplyDamage:\s*\(\)\s*=>[\s\S]*emitBasicSaveTargetDamageApplyingPresentationFromApplication/);
    assert.ok(adapter.indexOf("await beforeApplyDamage") < adapter.indexOf("contextClone.applyDamage"));
  });
  it("29. exact 3.54.1 target is used for application identity", () => {
    const target = normalize3541().targets[1];
    assert.equal(applicationId("toolbelt-basic-save:m", target.toolbeltTargetKey), "toolbelt-basic-save:m:target:tokB");
  });
  it("30. PF2e IWR remains authoritative", () => {
    assert.match(source("scripts/pf2e-adapter.js"), /skipIWR:\s*false/);
  });
  it("31. applied event remains after HP and temp-HP snapshots", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.ok(service.indexOf("record.postApplicationTempHp = after.tempHp") < service.lastIndexOf("emitBasicSaveTargetDamagePresentationFromApplication"));
  });
  it("32. actual normal-HP loss is preserved", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 80, beforeTempHp: 0, afterHp: 60, afterTempHp: 0 }), 20);
  });
  it("33. temporary-HP loss is included", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 80, beforeTempHp: 10, afterHp: 75, afterTempHp: 0 }), 15);
  });
  it("34. authoritative zero application is preserved", () => {
    assert.equal(deriveActualBasicSaveHpLoss({ beforeHp: 80, beforeTempHp: 0, afterHp: 80, afterTempHp: 0 }), 0);
  });
  it("35. terminal applied records remain replay-protected", () => {
    assert.equal(isReplaySafe({ state: TOOLBELT_TARGET_STATES.APPLIED }), false);
  });

  it("36. A/B/C independently normalize", () => {
    assert.deepEqual(normalize3541().targets.map(({ toolbeltTargetKey }) => toolbeltTargetKey), ["tokA", "tokB", "tokC"]);
  });
  it("37. A cannot overwrite B identity", () => {
    assert.notEqual(applicationId("batch", "tokA"), applicationId("batch", "tokB"));
  });
  it("38. all targets preserve one batch identity prefix", () => {
    const ids = normalize3541().targets.map((target) => applicationId("toolbelt-basic-save:batch", target.toolbeltTargetKey));
    assert.equal(ids.every((id) => id.startsWith("toolbelt-basic-save:batch:target:")), true);
  });
  it("39. per-target applied damage values remain distinct", () => {
    const amounts = [
      deriveActualBasicSaveHpLoss({ beforeHp: 50, beforeTempHp: 0, afterHp: 50, afterTempHp: 0 }),
      deriveActualBasicSaveHpLoss({ beforeHp: 50, beforeTempHp: 0, afterHp: 30, afterTempHp: 0 }),
      deriveActualBasicSaveHpLoss({ beforeHp: 50, beforeTempHp: 5, afterHp: 10, afterTempHp: 0 }),
    ];
    assert.deepEqual(amounts, [0, 20, 45]);
  });

  it("40. basicSavePresentation remains protocol 3", () => {
    assert.equal(BASIC_SAVE_PRESENTATION_PROTOCOL, 3);
  });
  it("41. basic-save hook names remain unchanged", () => {
    assert.equal(BASIC_SAVE_TARGET_RESOLVED_PRESENTATION_HOOK, "nelflow.basicSaveTargetResolvedPresentation");
    assert.equal(BASIC_SAVE_TARGET_DAMAGE_APPLYING_PRESENTATION_HOOK, "nelflow.basicSaveTargetDamageApplyingPresentation");
    assert.equal(BASIC_SAVE_TARGET_DAMAGE_APPLIED_PRESENTATION_HOOK, "nelflow.basicSaveTargetDamageAppliedPresentation");
  });
  it("42. basic-save payload schema remains version 1", () => {
    const target = normalize3541().targets[0];
    tryEmitBasicSaveTargetPresentation(resolvedArgs(target));
    assert.equal(Hooks.calls[0].payload.schemaVersion, 1);
    assert.equal(Hooks.calls[0].payload.stage, "targetResolved");
  });

  it("43. 3.54.2 produces unsupported state", () => {
    assert.equal(evaluateToolbeltCompatibility({ version: "3.54.2" }).reason, "toolbelt-version-unverified");
  });
  it("44. unsupported 3.54.2 does not normalize Target Helper automation", () => {
    installEnvironment("3.54.2");
    const result = ToolbeltTargetHelperAdapter.normalizeDamageMessage(createToolbelt3541DamageMessage());
    assert.equal(result.ok, false);
    assert.equal(result.reason, "toolbelt-version-unsupported");
  });
  it("45. unsupported version warning remains clear", () => {
    assert.match(source("lang/en.json"), /This PF2e Toolbelt version is not supported by Nelflow\. Target Helper controls remain manual\./);
  });

  it("46. Strike presentation protocol 4 is unchanged", () => {
    assert.equal(STRIKE_PRESENTATION_FEED_PROTOCOL, 4);
  });
  it("47. spellAttack presentation protocol 1 is unchanged", () => {
    assert.equal(SPELL_ATTACK_PRESENTATION_PROTOCOL, 1);
  });
  it("48. healing presentation protocol 1 is unchanged", () => {
    assert.equal(HEALING_PRESENTATION_PROTOCOL, 1);
  });
  it("49. nelflow.damageApplied contract is unchanged", () => {
    assert.match(source("scripts/damage-applied-bridge.js"), /DAMAGE_APPLIED_HOOK = "nelflow\.damageApplied"/);
  });
  it("50. NelZones remains on the existing damageApplied mechanics bridge", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /NelZones|nelzones/);
    assert.match(source("scripts/pf2e-adapter.js"), /emitDamageAppliedFromApplication/);
  });

  it("51. no Toolbelt patch is introduced", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /libWrapper|monkey.?patch|WRAPPER/i);
  });
  it("52. no Toolbelt fork is introduced", () => {
    const relationship = JSON.parse(source("module.json")).relationships.recommends.find(({ id }) => id === "pf2e-toolbelt");
    assert.equal(relationship?.manifest, "https://github.com/reonZ/pf2e-toolbelt/releases/latest/download/module.json");
  });
  it("53. no private Toolbelt API is called", () => {
    assert.doesNotMatch(source("scripts/toolbelt-basic-save-service.js"), /game\.toolbelt\.|rollSaveForTarget|rollSaves\(/);
  });
  it("54. rendered chat HTML is not parsed for durable mechanics", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /querySelector|innerHTML|textContent/);
  });
  it("55. no duplicate save application path is added", () => {
    const service = source("scripts/toolbelt-basic-save-service.js");
    assert.equal((service.match(/PF2eAdapter\.applyDamageRollToRecordedTarget\(/g) ?? []).length, 1);
  });
  it("56. no IWR recreation is added", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /weakness|resistance|immunity|hardness/i);
  });
  it("57. no Roll recreation is added", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /new\s+(?:Damage)?Roll|Roll\.fromJSON|Roll\.create/);
  });
  it("58. compatibility observation performs no Actor update", () => {
    assert.doesNotMatch(source("scripts/toolbelt-target-helper-adapter.js"), /Actor\.update|actor\.update|\.update\(\{/);
  });

  it("59. status reports the exact audited range", () => {
    assert.equal(TOOLBELT_SUPPORTED_RANGE, "3.52.0 - 3.54.1");
    assert.equal(ToolbeltTargetHelperAdapter.status().supportedRange, TOOLBELT_SUPPORTED_RANGE);
  });
  it("60. status reports audited schema compatibility", () => {
    assert.equal(TOOLBELT_SCHEMA_COMPATIBILITY, "3.54.1-audited");
    assert.equal(ToolbeltTargetHelperAdapter.status().schemaCompatibility, "3.54.1-audited");
  });
  it("61. status reports Target Helper availability", () => {
    assert.equal(ToolbeltTargetHelperAdapter.status().targetHelperAvailable, true);
    assert.equal(getBasicSavePresentationStatus().targetHelperAvailable, true);
  });
  it("62. fixture records the exact official source comparison", () => {
    assert.equal(TOOLBELT_3541_AUDIT.commit, "158d26ba7394b26f945c7807545e675822855eb4");
    assert.equal(TOOLBELT_3541_AUDIT.comparedCommit, "dbbfe2e30e8ac22388057e6edd8dfd95be9df440");
    assert.equal(Object.keys(TOOLBELT_3541_AUDIT.identicalContractBlobs).length, 5);
  });
  it("63. global dev status exposes audited Toolbelt diagnostics", () => {
    const main = source("scripts/main.js");
    assert.match(main, /root\.dev\.getStatus[\s\S]*toolbelt:[\s\S]*supportedRange[\s\S]*targetHelperAvailable[\s\S]*schemaCompatibility/);
  });
});
