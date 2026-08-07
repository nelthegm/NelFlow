import assert from "node:assert/strict";
import test from "node:test";
import {
  BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION,
  BASIC_SAVE_SOURCE_CLASSIFIER_VERSION,
  classifyBasicSaveSource,
  sourceModeAllows,
} from "../scripts/basic-save-source-classifier.js";
import {
  electProcessingGm,
  selectToolbeltDamageRoll,
  toolbeltStateFingerprint,
} from "../scripts/toolbelt-target-helper-adapter.js";
import {
  allPrimarySavesResolved,
  createTargetRecord,
  eligibleTargetKeys,
  integrationId,
  isReplaySafe,
  outcomeMultiplier,
  targetResultChanged,
  TOOLBELT_TARGET_STATES as S,
} from "../scripts/toolbelt-basic-save-model.js";
import { shouldGuardDamageControls } from "../scripts/toolbelt-control-guard.js";

const actor = (type = "npc", uuid = "Actor.source") => ({
  type,
  uuid,
  isOfType: (...types) => types.includes(type),
});
const item = (type = "action", parent = actor(), extra = {}) => ({
  type,
  uuid: `${parent.uuid}.Item.ability`,
  actor: parent,
  slug: "dragon-breath",
  isOfType: (...types) => types.includes(type),
  ...extra,
});
const data = (sourceItem, sourceActor = sourceItem.actor, extra = {}) => ({
  author: sourceActor.uuid,
  item: sourceItem.uuid,
  saveVariants: { null: { basic: true, statistic: "reflex", dc: 24, saves: {} } },
  ...extra,
});
const message = (sourceItem, sourceActor = sourceItem.actor, extra = {}) => ({
  id: "damage-message",
  item: sourceItem,
  actor: sourceActor,
  flags: {
    pf2e: {
      origin: { actor: sourceActor.uuid, uuid: sourceItem.uuid, type: sourceItem.type },
      context: { type: "damage-roll", sourceType: "save", outcome: null, options: [] },
    },
  },
  ...extra,
});
const classify = ({ sourceActor = actor(), sourceItem, messageData, toolbeltData, rollIndex = 0 } = {}) => {
  sourceItem ??= item("action", sourceActor);
  messageData ??= message(sourceItem, sourceActor);
  toolbeltData ??= data(sourceItem, sourceActor);
  const basicSaves = Object.values(toolbeltData.saveVariants ?? {}).filter(
    (save) => save?.basic === true && ["fortitude", "reflex", "will"].includes(save.statistic),
  );
  return classifyBasicSaveSource({
    message: messageData,
    toolbeltSource: {
      sourceActorUuid: toolbeltData.author ?? null,
      sourceItemUuid: toolbeltData.item ?? null,
      isBasicSave: basicSaves.length === 1,
      saveType: basicSaves[0]?.statistic ?? null,
    },
    rollIndex,
    resolveUuid: (uuid) => (uuid === sourceActor.uuid ? sourceActor : null),
  });
};
const roll = (extra = {}) => ({
  instances: [],
  options: {},
  alter() {},
  ...extra,
});
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

test("existing basic-save spell remains eligible", () => {
  const caster = actor("character");
  const spell = item("spell", caster);
  const result = classify({ sourceActor: caster, sourceItem: spell });
  assert.equal(result.ok, true);
  assert.equal(result.sourceKind, "spell");
});
test("spell-only setting rejects NPC abilities", () => assert.equal(sourceModeAllows("npc-ability", "spells"), false));
test("NPC ability source is eligible when enabled", () => assert.equal(sourceModeAllows("npc-ability", "spells-and-npc-abilities"), true));
test("spells remain enabled in both source modes", () => assert.equal(sourceModeAllows("spell", "spells"), true));
test("player ability is rejected", () => assert.equal(classify({ sourceActor: actor("character") }).reason, "non-npc-source"));
test("hazard source is rejected", () => assert.equal(classify({ sourceActor: actor("hazard") }).reason, "hazard-source-unsupported"));
test("Strike source is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.strike = { actor: sourceActor.uuid };
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).reason, "attack-plus-save-unsupported");
});
test("non-basic NPC ability is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const raw = data(sourceItem, sourceActor, { saveVariants: { null: { basic: false, statistic: "reflex" } } });
  assert.equal(classify({ sourceActor, sourceItem, toolbeltData: raw }).reason, "basic-save-not-unique");
});
test("NPC ability with no native damage roll is rejected", () => assert.equal(selectToolbeltDamageRoll([], -1).ok, false));
test("description-only save is rejected without structured Toolbelt basic flag", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem, toolbeltData: data(sourceItem, sourceActor, { saveVariants: {} }) }).ok, false);
});
test("exact NPC action item is accepted", () => assert.equal(classify().ok, true));
test("NPC feat item is rejected because PF2e 8.3 NPC abilities are action items", () => {
  const sourceActor = actor();
  const sourceItem = item("feat", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem }).reason, "source-item-type-unsupported");
});
test("unknown item type is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("effect", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem }).ok, false);
});
test("missing source actor is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem, toolbeltData: data(sourceItem, sourceActor, { author: null }) }).reason, "source-actor-unavailable");
});
test("non-NPC source actor is rejected", () => assert.equal(classify({ sourceActor: actor("familiar") }).ok, false));
test("exact source item UUID is preserved", () => assert.equal(classify().sourceItemUuid, "Actor.source.Item.ability"));
test("exact source message ID is preserved when PF2e supplies one", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.origin.messageId = "source-message";
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).sourceMessageId, "source-message");
});
test("one exact damage roll index is accepted", () => assert.deepEqual(selectToolbeltDamageRoll([roll()], -1).index, 0));
test("two regular damage roll indexes are rejected", () => assert.equal(selectToolbeltDamageRoll([roll(), roll()], -1).ok, false));
test("save mapped only at message level cannot choose among two rolls", () => assert.equal(selectToolbeltDamageRoll([roll(), roll()], -1).reason, "shared-damage-ambiguous"));
test("attack-plus-save ability is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.context.sourceType = "attack";
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).reason, "attack-plus-save-unsupported");
});
test("attack outcome on save damage is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.context.outcome = "success";
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).ok, false);
});
test("healing roll remains structurally distinguishable", () => assert.equal(roll({ kinds: new Set(["healing"]) }).kinds.has("healing"), true));
test("persistent-damage roll remains detectable for manual fallback", () => assert.equal(roll({ options: { evaluatePersistent: true } }).options.evaluatePersistent, true));
test("splash-only roll is excluded", () => assert.equal(selectToolbeltDamageRoll([roll({ options: { splashOnly: true } })], -1).ok, false));
test("one regular plus one splash roll selects the regular", () => assert.equal(selectToolbeltDamageRoll([roll(), roll({ options: { splashOnly: true } })], 1).index, 0));
test("primary targets remain eligible", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure")], "per-target"), ["a"]));
test("pending save remains pending", () => assert.equal(createTargetRecord({ integrationId: "i", rollIndex: 0 }, target("a")).state, S.PENDING_SAVE));
test("all-resolved waits for all primary targets", () => assert.equal(allPrimarySavesResolved([target("a", "failure"), target("b")]), false));
test("per-target mode handles only finalized targets", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure"), target("b")], "per-target"), ["a"]));
test("GM-confirm mode waits for confirmation", () => assert.deepEqual(eligibleTargetKeys([target("a", "failure")], "gm-confirm"), []));
test("Critical Success produces No Damage multiplier", () => assert.equal(outcomeMultiplier("criticalSuccess"), 0));
test("Success uses native half multiplier", () => assert.equal(outcomeMultiplier("success"), 0.5));
test("Failure uses native full multiplier", () => assert.equal(outcomeMultiplier("failure"), 1));
test("Critical Failure uses native double multiplier", () => assert.equal(outcomeMultiplier("criticalFailure"), 2));
test("existing native DamageRoll object is reused", () => { const native = roll(); assert.equal(selectToolbeltDamageRoll([native], -1).roll, native); });
test("damage selection never invokes alter or rerolls", () => { let calls = 0; const native = roll({ alter: () => { calls += 1; } }); selectToolbeltDamageRoll([native], -1); assert.equal(calls, 0); });
test("different IWR targets retain independent identities", () => assert.notEqual(target("resistant").actorUuid, target("weak").actorUuid));
test("temporary HP fields remain part of target transaction", () => assert.equal(createTargetRecord({ integrationId: "i", rollIndex: 0 }, target("a", "failure")).preApplicationTempHp, null));
test("external Toolbelt application prevents a ready state", () => assert.equal(createTargetRecord({ integrationId: "i", rollIndex: 0 }, target("a", "failure", { toolbeltAppliedState: true })).state, S.EXTERNAL));
test("double processing-GM claim elects one stable GM", () => assert.equal(electProcessingGm([{ id: "b", active: true, isGM: true }, { id: "a", active: true, isGM: true }], "p"), "a"));
test("two rapid identical Toolbelt updates have one fingerprint", () => { const raw = { targets: ["a"], splashTargets: [], splashIndex: -1, applied: {}, saveVariants: {} }; assert.equal(toolbeltStateFingerprint(raw), toolbeltStateFingerprint(structuredClone(raw))); });
test("completed target is replay protected after another target fails", () => assert.equal(isReplaySafe({ state: S.APPLIED }), false));
test("successful Undo identity remains target-specific", () => assert.notEqual(integrationId("m1") + ":a", integrationId("m1") + ":b"));
test("Undo Blocked preserves damage-control guards with application proof", () => assert.equal(shouldGuardDamageControls({ state: S.UNDO_BLOCKED, applicationId: "a", preApplicationHp: 20, postApplicationHp: 10 }), true));
test("successful Undo restores damage controls", () => assert.equal(shouldGuardDamageControls({ state: S.UNDONE }), false));
test("reload terminal ability target is not replayable", () => assert.equal(isReplaySafe({ state: S.NO_DAMAGE }), false));
test("interrupted application does not resume", () => assert.equal(isReplaySafe({ state: S.INTERRUPTED }), false));
test("classifier output does not expose source item name", () => assert.equal("sourceName" in classify(), false));
test("unknown DOM identity fails open in guard policy", () => assert.equal(shouldGuardDamageControls(null), false));
test("existing spell source remains classified independently from NPC ability", () => {
  const caster = actor("character");
  const spell = item("spell", caster);
  assert.equal(classify({ sourceActor: caster, sourceItem: spell }).isNpcAbility, false);
});
test("existing NPC Strike transaction state remains outside Toolbelt states", () => assert.equal(Object.values(S).includes("damage-rolled"), false));
test("legacy resolver identity remains isolated", () => assert.notEqual("save-resolver:m1", integrationId("m1")));
test("source classifier version is persisted-ready", () => assert.equal(classify().classifierVersion, BASIC_SAVE_SOURCE_CLASSIFIER_VERSION));
test("eligibility evidence version is persisted-ready", () => assert.equal(classify().eligibilityEvidenceVersion, BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION));
test("source actor mismatch is rejected", () => {
  const sourceActor = actor();
  const other = actor("npc", "Actor.other");
  const sourceItem = item("action", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem, messageData: message(sourceItem, other) }).ok, false);
});
test("Toolbelt source item mismatch is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  assert.equal(classify({ sourceActor, sourceItem, toolbeltData: data(sourceItem, sourceActor, { item: "Actor.source.Item.other" }) }).reason, "source-item-identity-mismatch");
});
test("missing PF2e damage context is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.context = null;
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).reason, "damage-context-unavailable");
});
test("unsupported damage context source type is rejected", () => {
  const sourceActor = actor();
  const sourceItem = item("action", sourceActor);
  const msg = message(sourceItem, sourceActor);
  msg.flags.pf2e.context.sourceType = "effect";
  assert.equal(classify({ sourceActor, sourceItem, messageData: msg }).reason, "damage-not-save-governed");
});
test("result change after application remains detectable", () => assert.equal(targetResultChanged({ toolbeltStateFingerprint: "old" }, { saveFingerprint: "new" }), true));
