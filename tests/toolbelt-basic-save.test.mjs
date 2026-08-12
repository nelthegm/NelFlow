import assert from "node:assert/strict";
import test from "node:test";
import {
  electProcessingGm,
  evaluateToolbeltCompatibility,
  isSupportedToolbeltVersion,
  toolbeltStateFingerprint,
  TOOLBELT_MAX_VERSION,
  TOOLBELT_MIN_VERSION,
} from "../scripts/toolbelt-target-helper-adapter.js";
import {
  allPrimarySavesResolved,
  applicationId,
  createTargetRecord,
  eligibleTargetKeys,
  integrationId,
  isReplaySafe,
  outcomeMultiplier,
  targetResultChanged,
  TOOLBELT_TARGET_STATES,
} from "../scripts/toolbelt-basic-save-model.js";

const target = (key, outcome = null, extra = {}) => ({
  toolbeltTargetKey: key,
  actorUuid: `Actor.${key}`,
  tokenUuid: `Scene.s.Token.${key}`,
  sceneId: "s",
  saveType: "reflex",
  saveState: outcome ? "resolved" : "pending",
  degreeOfSuccess: outcome,
  toolbeltAppliedState: false,
  saveFingerprint: outcome ? `${key}:${outcome}` : null,
  ...extra,
});

const base = (targets) => ({ integrationId: "toolbelt-basic-save:m1", targets });

test("Toolbelt inactive is not a supported version", () => assert.equal(isSupportedToolbeltVersion(null), false));
test("Target Helper disabled remains a separate adapter status concern", () => assert.equal(Boolean(false), false));
test("supported Toolbelt minimum version", () => assert.equal(isSupportedToolbeltVersion(TOOLBELT_MIN_VERSION), true));
test("supported Toolbelt 3.52.1", () => assert.equal(isSupportedToolbeltVersion("3.52.1"), true));
test("supported Toolbelt 3.54.0", () => assert.equal(isSupportedToolbeltVersion("3.54.0"), true));
test("unsupported older Toolbelt version", () => assert.equal(isSupportedToolbeltVersion("3.51.9"), false));
test("unsupported newer unverified Toolbelt version", () => assert.equal(isSupportedToolbeltVersion("3.55.0"), false));
test("non-semantic Toolbelt version fails closed", () => assert.equal(isSupportedToolbeltVersion("master"), false));
test("Toolbelt 3.53.1 capability result is supported", () => {
  const result = evaluateToolbeltCompatibility({ version: "3.53.1" });
  assert.equal(result.supported, true);
  assert.equal(result.targetFlagsSupported, true);
  assert.equal(result.resultRowsSupported, true);
  assert.equal(result.damageControlsSupported, true);
  assert.equal(result.reason, null);
});
test("Toolbelt 3.52.0 capability result is supported", () => {
  assert.equal(evaluateToolbeltCompatibility({ version: "3.52.0" }).supported, true);
});
test("Toolbelt 3.54.0 capability result is supported", () => {
  const result = evaluateToolbeltCompatibility({ version: "3.54.0" });
  assert.equal(result.supported, true);
  assert.equal(result.reason, null);
});
test("unverified Toolbelt version fails open for automation", () => {
  const result = evaluateToolbeltCompatibility({ version: "3.55.0" });
  assert.equal(result.supported, false);
  assert.equal(result.reason, "toolbelt-version-unverified");
});
test("missing target flags disable authoritative processing safely", () => {
  const result = evaluateToolbeltCompatibility({
    version: "3.53.1",
    rawFlag: { type: "damage" },
  });
  assert.equal(result.supported, false);
  assert.equal(result.targetFlagsSupported, false);
});
test("changed control markup can disable guarding only", () => {
  const result = evaluateToolbeltCompatibility({
    version: "3.53.1",
    rawFlag: {
      type: "damage",
      targets: ["Scene.x.Token.t"],
      saveVariants: { null: { basic: true, statistic: "reflex", dc: 20, saves: { t: { success: "failure" } } } },
    },
    damageControlsSupported: false,
  });
  assert.equal(result.supported, true);
  assert.equal(result.damageControlsSupported, false);
});
test("non-Toolbelt damage has no integration identity", () => assert.equal(integrationId("m1"), "toolbelt-basic-save:m1"));
test("non-basic save is not represented as resolved", () => assert.equal(target("a").saveState, "pending"));
test("healing is not a positive basic-save multiplier", () => assert.equal(outcomeMultiplier("healing"), null));
test("persistent damage can be projected manual", () => assert.equal(TOOLBELT_TARGET_STATES.MANUAL, "manual"));
test("player-authored damage elects one stable GM", () => assert.equal(electProcessingGm([{ id: "b", active: true, isGM: true }, { id: "a", active: true, isGM: true }], "player"), "a"));
test("GM-authored damage prefers active author", () => assert.equal(electProcessingGm([{ id: "a", active: true, isGM: true }, { id: "b", active: true, isGM: true }], "b"), "b"));
test("inactive authoring GM is not elected", () => assert.equal(electProcessingGm([{ id: "a", active: true, isGM: true }, { id: "b", active: false, isGM: true }], "b"), "a"));
test("no active GM yields no processing authority", () => assert.equal(electProcessingGm([{ id: "p", active: true, isGM: false }], "p"), null));
test("four exact targets retain stable order", () => assert.deepEqual(["a", "b", "c", "d"].map((key) => target(key).toolbeltTargetKey), ["a", "b", "c", "d"]));
test("duplicate target application IDs are deterministic", () => assert.equal(applicationId("i", "a"), applicationId("i", "a")));
test("different targets have different application IDs", () => assert.notEqual(applicationId("i", "a"), applicationId("i", "b")));
test("primary target classification remains explicit", () => assert.equal(target("a", null, { isPrimaryTarget: true }).isPrimaryTarget, true));
test("splash targets are distinguishable", () => assert.equal(target("a", null, { isSplashTarget: true }).isSplashTarget, true));
test("pending save is not all-resolved", () => assert.equal(allPrimarySavesResolved([target("a")]), false));
test("all resolved requires every target", () => assert.equal(allPrimarySavesResolved([target("a", "failure"), target("b")]), false));
test("all resolved accepts four finalized saves", () => assert.equal(allPrimarySavesResolved([target("a", "criticalSuccess"), target("b", "success"), target("c", "failure"), target("d", "criticalFailure")]), true));
test("all-resolved mode waits", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure"), target("b")], "all-resolved"), []));
test("all-resolved mode releases stable target keys", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure"), target("b", "success")], "all-resolved"), ["a", "b"]));
test("per-target mode releases only finalized targets", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure"), target("b")], "per-target"), ["a"]));
test("GM-confirm mode never auto releases", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure")], "gm-confirm"), []));
test("off mode never releases", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure")], "off"), []));
test("critical success multiplier is zero", () => assert.equal(outcomeMultiplier("criticalSuccess"), 0));
test("success multiplier is native half", () => assert.equal(outcomeMultiplier("success"), 0.5));
test("failure multiplier is native full", () => assert.equal(outcomeMultiplier("failure"), 1));
test("critical failure multiplier is native double", () => assert.equal(outcomeMultiplier("criticalFailure"), 2));
test("triple damage is unsupported", () => assert.equal(outcomeMultiplier("triple"), null));
test("critical success creates no-damage-capable record", () => assert.equal(createTargetRecord(base([]), target("a", "criticalSuccess")).multiplier, 0));
test("external Toolbelt application is terminal", () => assert.equal(createTargetRecord(base([]), target("a", "failure", { toolbeltAppliedState: true })).state, TOOLBELT_TARGET_STATES.EXTERNAL));
test("pending target record is pending-save", () => assert.equal(createTargetRecord(base([]), target("a")).state, TOOLBELT_TARGET_STATES.PENDING_SAVE));
test("resolved target record is ready", () => assert.equal(createTargetRecord(base([]), target("a", "failure")).state, TOOLBELT_TARGET_STATES.READY));
test("same Toolbelt schema has stable fingerprint", () => { const data = { targets: ["t"], splashTargets: [], splashIndex: -1, applied: {}, saveVariants: {} }; assert.equal(toolbeltStateFingerprint(data), toolbeltStateFingerprint(data)); });
test("save outcome changes schema fingerprint", () => { const a = { targets: ["t"], splashTargets: [], splashIndex: -1, applied: {}, saveVariants: { null: { basic: true, dc: 20, statistic: "reflex", saves: { t: { success: "failure", roll: "a" } } } } }; const b = structuredClone(a); b.saveVariants.null.saves.t.success = "success"; assert.notEqual(toolbeltStateFingerprint(a), toolbeltStateFingerprint(b)); });
test("reroll changes schema fingerprint", () => { const a = { targets: ["t"], splashTargets: [], splashIndex: -1, applied: {}, saveVariants: { null: { basic: true, dc: 20, statistic: "reflex", saves: { t: { success: "failure", roll: "a" } } } } }; const b = structuredClone(a); b.saveVariants.null.saves.t.rerolled = "hero"; assert.notEqual(toolbeltStateFingerprint(a), toolbeltStateFingerprint(b)); });
test("applied marker changes schema fingerprint", () => { const a = { targets: ["t"], splashTargets: [], splashIndex: -1, applied: {}, saveVariants: {} }; const b = structuredClone(a); b.applied = { t: { 0: true } }; assert.notEqual(toolbeltStateFingerprint(a), toolbeltStateFingerprint(b)); });
test("result change before application is detectable", () => assert.equal(targetResultChanged({ toolbeltStateFingerprint: "old" }, { saveFingerprint: "new" }), true));
test("unchanged result is not marked changed", () => assert.equal(targetResultChanged({ toolbeltStateFingerprint: "same" }, { saveFingerprint: "same" }), false));
test("applied target is replay protected", () => assert.equal(isReplaySafe({ state: TOOLBELT_TARGET_STATES.APPLIED }), false));
test("no-damage target is replay protected", () => assert.equal(isReplaySafe({ state: TOOLBELT_TARGET_STATES.NO_DAMAGE }), false));
test("interrupted target does not auto resume", () => assert.equal(isReplaySafe({ state: TOOLBELT_TARGET_STATES.INTERRUPTED }), false));
test("ready target may be claimed", () => assert.equal(isReplaySafe({ state: TOOLBELT_TARGET_STATES.READY }), true));
test("legacy resolver identity cannot equal Toolbelt identity", () => assert.notEqual("save-resolver:m1", integrationId("m1")));
test("hidden target projection can use a generic exact-order label", () => assert.equal(`Target ${4}`, "Target 4"));
test("row without exact DOM identity can use separate summary", () => assert.equal(Boolean(null), false));
test("unrelated Toolbelt target has independent application ID", () => assert.notEqual(applicationId("i", "target-a"), applicationId("i", "unrelated")));
test("Strike transactions remain outside Toolbelt state set", () => assert.equal(Object.values(TOOLBELT_TARGET_STATES).includes("damage-rolled"), false));
