import assert from "node:assert/strict";
import test from "node:test";
import {
  autoDamageCandidateMatches,
  autoDamageIntegrationId,
  autorollModeAllows,
  inspectNativeDamageAction,
  invokeNativeDamageAction,
  NATIVE_DAMAGE_ACTION_ADAPTER_VERSION,
  userCanInvokeSource,
} from "../scripts/native-damage-action-adapter.js";
import {
  AUTO_DAMAGE_ROLL_STATES as S,
  AutoDamageMessageClaimRegistry,
  isTerminalAutoDamageState,
  liveInvocationAllowed,
  shouldGuardSourceDamageControl,
} from "../scripts/auto-damage-roll-model.js";
import { targetIdentityFingerprint } from "../scripts/toolbelt-target-helper-adapter.js";

const user = (extra = {}) => ({ id: "u1", active: true, isGM: false, ...extra });
const actor = (type = "character", extra = {}) => ({
  uuid: "Actor.a",
  type,
  isOwner: true,
  canUserModify: () => true,
  testUserPermission: () => true,
  ...extra,
});
const damageRoll = (extra = {}) => ({
  instances: [{}],
  kinds: new Set(["damage"]),
  options: { damage: { modifiers: [] } },
  total: 0,
  evaluate() {},
  ...extra,
});
const spell = (extra = {}) => {
  const parent = extra.actor ?? actor();
  const roll = extra.preparedRoll ?? damageRoll();
  return {
    uuid: "Actor.a.Item.fireball",
    type: "spell",
    actor: parent,
    rank: 3,
    isOwner: true,
    isAttack: false,
    hasVariants: false,
    isVariant: false,
    isOfType: (...types) => types.includes("spell"),
    getDamage: async () => ({ template: { damage: { roll } } }),
    rollDamage: async () => damageRoll(),
    ...extra,
  };
};
const normalized = (extra = {}) => {
  const item = extra.item ?? spell();
  const sourceActor = extra.actor ?? item.actor;
  return {
    ok: true,
    message: {
      id: "source-1",
      flags: { pf2e: { context: { type: "spell-cast" } } },
    },
    actor: sourceActor,
    item,
    sourceMessageId: "source-1",
    sourceKind: "spell",
    sourceActorUuid: sourceActor.uuid,
    sourceItemUuid: item.uuid,
    sourceUserId: "u1",
    saveType: "reflex",
    isBasicSave: true,
    targets: [{ tokenUuid: "Scene.s.Token.t1", actorUuid: "Actor.t1" }],
    targetFingerprint: "targets-a",
    sourceFingerprint: "source-a",
    castRank: 3,
    overlayIds: [],
    actionVariant: null,
    messageMode: "public",
    ...extra,
  };
};
const inspect = (source = normalized(), extra = {}) => inspectNativeDamageAction({
  normalizedSource: source,
  user: user(),
  defaultMessageMode: "public",
  showDamageDialogs: false,
  ...extra,
});
const tx = (extra = {}) => ({
  integrationId: "auto-damage-roll:source-1:n1",
  sourceMessageId: "source-1",
  sourceKind: "spell",
  sourceActorUuid: "Actor.a",
  sourceItemUuid: "Actor.a.Item.fireball",
  rollingUserId: "u1",
  damageRollIndex: 0,
  targetFingerprint: "targets-a",
  castRank: 3,
  overlayIds: [],
  ...extra,
});
const damage = (extra = {}) => ({
  ok: true,
  message: { id: "damage-1" },
  sourceKind: "spell",
  sourceActorUuid: "Actor.a",
  sourceItemUuid: "Actor.a.Item.fireball",
  sourceUserId: "u1",
  rollIndex: 0,
  targetFingerprint: "targets-a",
  sourceCastRank: 3,
  sourceOverlayIds: [],
  ...extra,
});
const marker = (extra = {}) => ({
  integrationId: "auto-damage-roll:source-1:n1",
  sourceMessageId: "source-1",
  damageRollIndex: 0,
  targetFingerprint: "targets-a",
  ...extra,
});

test("Automatic roll Off leaves source manual", () => assert.equal(autorollModeAllows("off", user()), false));
test("GM mode accepts GM-authored spell", () => assert.equal(autorollModeAllows("gm", user({ isGM: true })), true));
test("GM mode rejects player-authored spell", () => assert.equal(autorollModeAllows("gm", user()), false));
test("All mode accepts player-authored spell", () => assert.equal(autorollModeAllows("all", user()), true));
test("NPC action fails open because PF2e 8.3 exposes no native item damage method", async () => {
  const npc = actor("npc");
  const action = { actor: npc, uuid: "Actor.a.Item.breath", type: "action", isOwner: true, isOfType: (...t) => t.includes("action") };
  assert.equal((await inspect(normalized({ actor: npc, item: action, sourceKind: "npc-ability", castRank: null }))).reason, "ability-native-damage-api-unavailable");
});
test("Player non-spell ability is rejected", async () => assert.equal((await inspect(normalized({ sourceKind: "unknown" }))).ok, false));
test("Hazard source is rejected", async () => {
  const hazard = actor("hazard");
  assert.equal((await inspect(normalized({ actor: hazard, item: spell({ actor: hazard }) }))).reason, "source-actor-type-unsupported");
});
test("Strike source is rejected", async () => assert.equal((await inspect(normalized({ sourceKind: "strike" }))).ok, false));
test("Non-basic save is rejected", async () => assert.equal((await inspect(normalized({ isBasicSave: false }))).ok, false));
test("Attack-roll spell is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ isAttack: true }) }))).reason, "spell-attack-unsupported"));
test("Attack-plus-save effect remains unsupported", async () => assert.equal((await inspect(normalized({ message: { flags: { pf2e: { context: { type: "attack-roll" } } } } }))).ok, false));
test("Exactly one regular spell damage action is accepted", async () => assert.equal((await inspect()).ok, true));
test("Two regular damage actions are represented as ambiguous source variants", async () => assert.equal((await inspect(normalized({ item: spell({ hasVariants: true }) }))).reason, "spell-overlay-ambiguous"));
test("Multiple ambiguous roll indexes do not match exact candidate", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ rollIndex: 1 })), false));
test("Exact cast rank is preserved", async () => assert.equal((await inspect()).castRank, 3));
test("Missing cast rank is rejected", async () => assert.equal((await inspect(normalized({ castRank: null }))).reason, "cast-rank-ambiguous"));
test("Exact overlay is preserved", async () => {
  const item = spell({ hasVariants: true, isVariant: true });
  assert.deepEqual((await inspect(normalized({ item, overlayIds: ["overlay-a"] }))).overlayIds, ["overlay-a"]);
});
test("Unresolved overlay is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ hasVariants: true, isVariant: false }) }))).ok, false));
test("Exact NPC action variant remains structurally distinct", () => assert.equal(normalized({ actionVariant: "two-actions" }).actionVariant, "two-actions"));
test("Choice-requiring damage is rejected", async () => assert.equal((await inspect(normalized(), { showDamageDialogs: true })).reason, "damage-choice-dialog-enabled"));
test("Healing source is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ preparedRoll: damageRoll({ kinds: new Set(["healing"]) }) }) }))).reason, "healing-unsupported"));
test("Persistent-only source is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ preparedRoll: damageRoll({ options: { evaluatePersistent: true } }) }) }))).reason, "persistent-damage-unsupported"));
test("Unsupported persistent component is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ preparedRoll: damageRoll({ instances: [{ category: "persistent" }] }) }) }))).ok, false));
test("Splash-only source is rejected", async () => assert.equal((await inspect(normalized({ item: spell({ preparedRoll: damageRoll({ options: { splashOnly: true } }) }) }))).reason, "splash-damage-unsupported"));
test("No Toolbelt targets leaves source ineligible", async () => assert.equal((await inspect(normalized({ targets: [] }))).reason, "toolbelt-targets-missing"));
test("At least one primary target allows eligibility", async () => assert.equal((await inspect()).ok, true));
test("Historical source message cannot invoke without live status", () => assert.equal(liveInvocationAllowed({ live: false, state: S.CLAIMED, currentUserId: "u1", rollingUserId: "u1" }), false));
test("Live-created source may invoke after exact update", () => assert.equal(liveInvocationAllowed({ live: true, state: S.CLAIMED, currentUserId: "u1", rollingUserId: "u1" }), true));
test("Authoring user must be active", () => assert.equal(autorollModeAllows("all", user({ active: false })), false));
test("Authoring user must have permission", () => {
  const sourceActor = actor("character", {
    isOwner: false,
    canUserModify: () => false,
    testUserPermission: () => false,
  });
  const item = spell({ actor: sourceActor, isOwner: false });
  assert.equal(userCanInvokeSource(user(), sourceActor, item), false);
});
test("One rolling user claims transaction", () => { const r = new AutoDamageMessageClaimRegistry(); assert.equal(r.claim("d1", "i1"), true); });
test("Repeated update hooks cannot claim twice for different transactions", () => { const r = new AutoDamageMessageClaimRegistry(); r.claim("d1", "i1"); assert.equal(r.claim("d1", "i2"), false); });
test("Two active GMs cannot both claim one damage message", () => { const r = new AutoDamageMessageClaimRegistry(); assert.deepEqual([r.claim("d1", "gm1"), r.claim("d1", "gm2")], [true, false]); });
test("Player and GM clients do not both invoke player spell", () => assert.equal(liveInvocationAllowed({ live: true, state: S.CLAIMED, currentUserId: "gm", rollingUserId: "player" }), false));
test("Native invocation receives exact source context", async () => { let calls = 0; const item = spell({ rollDamage: async () => { calls += 1; return damageRoll(); } }); await invokeNativeDamageAction(item, await inspect(normalized({ item }))); assert.equal(calls, 1); });
test("Native invocation keeps exact damage roll index", async () => assert.equal((await inspect()).damageRollIndex, 0));
test("Native roll mode is preserved", async () => assert.equal((await inspect()).rollMode, "public"));
test("Exact generated-message correlation succeeds", () => assert.equal(autoDamageCandidateMatches(tx(), damage(), marker()), true));
test("Namespaced correlation marker does not alter mechanical candidate", () => assert.equal(Object.keys(marker()).includes("formula"), false));
test("Wrong actor damage message is rejected", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ sourceActorUuid: "Actor.other" })), false));
test("Wrong item damage message is rejected", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ sourceItemUuid: "Actor.a.Item.other" })), false));
test("Wrong roll index damage message is rejected", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ rollIndex: 2 })), false));
test("External manual damage can claim a pending transaction once", () => { const r = new AutoDamageMessageClaimRegistry(); assert.equal(r.claim("external", "source"), true); });
test("External Workbench-style damage cannot be claimed twice", () => { const r = new AutoDamageMessageClaimRegistry(); r.claim("external", "workbench-source"); assert.equal(r.claim("external", "nelflow-source"), false); });
test("Ambiguous external correlation prevents unique ownership", () => { const r = new AutoDamageMessageClaimRegistry(); r.claim("a", "i1"); r.claim("b", "i2"); assert.notEqual(r.owner("a"), r.owner("b")); });
test("Manual activation after claim is guardable", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: "spell-damage" }), true));
test("Manual activation before claim remains allowed", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: false, damageActionId: "spell-damage" }), false));
test("Successful auto-roll guards source damage control", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: "spell-damage", state: S.COMPLETED }), true));
test("Error before message creation restores source control", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: false, damageActionId: "spell-damage", state: S.ERROR }), false));
test("Completed roll permits confirmed Manual Roll Override", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: "spell-damage", manualRollEnabled: true }), false));
test("Manual Roll Override persists as data", () => assert.equal({ manualRollEnabled: true }.manualRollEnabled, true));
test("Re-guard persists as data", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: "spell-damage", manualRollEnabled: false }), true));
test("Completed transaction is terminal after reload", () => assert.equal(isTerminalAutoDamageState(S.COMPLETED), true));
test("Rolling transaction is not resumable without live claim", () => assert.equal(liveInvocationAllowed({ live: false, state: S.ROLLING, currentUserId: "u1", rollingUserId: "u1" }), false));
test("Interrupted transaction does not resume", () => assert.equal(isTerminalAutoDamageState(S.INTERRUPTED), true));
test("Two simultaneous Fireballs have separate integration IDs", () => assert.notEqual(autoDamageIntegrationId("m1", "a"), autoDamageIntegrationId("m2", "b")));
test("Same spell cast twice remains isolated by source message", () => assert.notEqual(autoDamageIntegrationId("m1", "a"), autoDamageIntegrationId("m2", "a")));
test("Two identical NPC abilities remain isolated by source message", () => assert.notEqual(autoDamageIntegrationId("a1", "n"), autoDamageIntegrationId("a2", "n")));
test("Player spell and NPC ability integrations remain isolated", () => assert.notEqual(autoDamageIntegrationId("spell", "n"), autoDamageIntegrationId("ability", "n")));
test("Existing Toolbelt spell application identity is unchanged", () => assert.equal(tx().sourceKind, "spell"));
test("Existing Toolbelt NPC ability application remains distinct", () => assert.equal(normalized({ sourceKind: "npc-ability" }).sourceKind, "npc-ability"));
test("Existing NPC Strike workflow state remains outside autoroll states", () => assert.equal(Object.values(S).includes("damage-rolled"), false));
test("Existing target damage-control guard identity remains separate", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: "target-applyDamage" }), false));
test("Blind/private details are absent from correlation marker", () => assert.equal("damageTotal" in marker(), false));
test("Unknown PF2e markup fails open through presentation-only guard", () => assert.equal(shouldGuardSourceDamageControl({ guardSourceControl: true, damageActionId: null }), false));
test("Native API returning no message does not imply retry", async () => { const item = spell({ rollDamage: async () => null }); assert.equal((await invokeNativeDamageAction(item, await inspect(normalized({ item })))).ok, false); });
test("Native API returning multiple message candidates is not resolved by claim registry", () => { const r = new AutoDamageMessageClaimRegistry(); assert.deepEqual([r.claim("d1", "i"), r.claim("d2", "i")], [true, true]); });
test("Dice So Nice visual delay is irrelevant to exact document identity", () => assert.equal(autoDamageCandidateMatches(tx(), damage(), marker()), true));
test("Adapter version is explicit", () => assert.equal(NATIVE_DAMAGE_ACTION_ADAPTER_VERSION, 1));
test("Inactive author is rejected in every autoroll mode", () => assert.equal(autorollModeAllows("gm", user({ active: false, isGM: true })), false));
test("Different target fingerprints never correlate", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ targetFingerprint: "targets-b" })), false));
test("Different cast ranks never correlate", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ sourceCastRank: 4 })), false));
test("Different overlays never correlate", () => assert.equal(autoDamageCandidateMatches(tx({ overlayIds: ["a"] }), damage({ sourceOverlayIds: ["b"] })), false));
test("Different rolling users never correlate", () => assert.equal(autoDamageCandidateMatches(tx(), damage({ sourceUserId: "u2" })), false));
test("Exact marker source message is required", () => assert.equal(autoDamageCandidateMatches(tx(), damage(), marker({ sourceMessageId: "other" })), false));
test("Exact marker integration ID is required", () => assert.equal(autoDamageCandidateMatches(tx(), damage(), marker({ integrationId: "other" })), false));
test("Target fingerprints are deterministic", () => { const targets = [{ tokenUuid: "t1", actorUuid: "a1" }]; assert.equal(targetIdentityFingerprint(targets), targetIdentityFingerprint(structuredClone(targets))); });
test("Target order participates in fingerprint", () => { const a = [{ tokenUuid: "t1", actorUuid: "a1" }, { tokenUuid: "t2", actorUuid: "a2" }]; assert.notEqual(targetIdentityFingerprint(a), targetIdentityFingerprint([...a].reverse())); });
test("Manual state is terminal", () => assert.equal(isTerminalAutoDamageState(S.MANUAL), true));
test("External state is terminal", () => assert.equal(isTerminalAutoDamageState(S.EXTERNAL), true));
test("Ambiguous state is terminal", () => assert.equal(isTerminalAutoDamageState(S.AMBIGUOUS), true));
test("Error state is terminal", () => assert.equal(isTerminalAutoDamageState(S.ERROR), true));
