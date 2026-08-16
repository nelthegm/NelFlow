import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  batchState,
  canUndoBatchChild,
  deduplicateTargetSnapshots,
  degreeOfSuccess,
  groupTargetOutcomes,
  makeBatchTransaction,
  mergeDegreeAdjustments,
  multiTargetModeAllows,
  validCapture,
} from "../scripts/multi-target-strike-model.js";
import { MULTI_TARGET_STRIKE_MODES } from "../scripts/constants.js";
import { combatStackKey, currentCombatFor } from "../scripts/turn-stack-service.js";
import { guardedHealthRestore } from "../scripts/guarded-health-restore.js";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const target = (id, actor = id, order = 0) => ({
  document: { uuid: `Scene.s.Token.${id}`, id, parent: { id: "s" }, disposition: -1, name: id },
  actor: { uuid: `Actor.${actor}`, name: actor },
  name: id,
  order,
});
const child = (outcome, changes = {}) => ({ outcome, state: "resolving", flatCheckFailed: false, ...changes });

test("1. active NPC Strikes remain associated with the explicit attacker combatant", () => {
  const token = { uuid: "Scene.s.Token.a" };
  globalThis.game = { combat: { started: true, round: 1, turn: 0, combatant: { id: "a", token }, combatants: [{ id: "a", token }] } };
  assert.equal(currentCombatFor({ snapshot: { sourceTokenUuid: token.uuid } }).attackerCombatant.id, "a");
});

test("2. NPC Strike during a player turn resolves the NPC attacker", () => {
  const player = { id: "p", token: { uuid: "Scene.s.Token.p" } };
  const npc = { id: "n", token: { uuid: "Scene.s.Token.n" } };
  globalThis.game = { combat: { started: true, round: 1, turn: 0, combatant: player, combatants: [player, npc] } };
  assert.equal(currentCombatFor({ snapshot: { sourceTokenUuid: npc.token.uuid } }).attackerCombatant.id, "n");
});

test("3. active combatant is never substituted for an explicit attacker", () => {
  const active = { id: "active", token: { uuid: "Scene.s.Token.active" } };
  const attacker = { id: "attacker", token: { uuid: "Scene.s.Token.attacker" } };
  globalThis.game = { combat: { started: true, round: 2, turn: 1, combatant: active, combatants: [active, attacker] } };
  const result = currentCombatFor({ snapshot: { sourceTokenUuid: attacker.token.uuid } });
  assert.equal(result.combatant.id, "active");
  assert.equal(result.attackerCombatant.id, "attacker");
});

test("4. ambiguous attacker identity fails closed", () => {
  globalThis.game = { combat: { started: true, round: 1, turn: 0, combatant: null, combatants: [] } };
  assert.equal(currentCombatFor({ snapshot: { sourceTokenUuid: null } }), null);
});

test("5. a token not in the active combat cannot contaminate a stack", () => {
  globalThis.game = { combat: { started: true, round: 1, turn: 0, combatant: null, combatants: [] } };
  assert.equal(currentCombatFor({ snapshot: { sourceTokenUuid: "Scene.s.Token.foreign" } }), null);
});

const identity = (changes = {}) => ({
  combatId: "combat",
  round: 1,
  combatantId: "active",
  turnIndex: 0,
  turnMarkerId: "window",
  attackerTokenUuid: "Scene.s.Token.a",
  authorUserId: "gm",
  visibilityKey: "visible:public",
  ...changes,
});

test("6. two out-of-turn NPC tokens have separate stack keys", () => assert.notEqual(
  combatStackKey(identity()),
  combatStackKey(identity({ attackerTokenUuid: "Scene.s.Token.b" })),
));
test("7. duplicate actor tokens remain separate because token UUID is in the key", () => assert.match(combatStackKey(identity()), /Scene\.s\.Token\.a/));
test("8. same attacker in the same window has a stable stack key", () => assert.equal(combatStackKey(identity()), combatStackKey(identity())));
test("9. round changes prevent merging", () => assert.notEqual(combatStackKey(identity()), combatStackKey(identity({ round: 2 }))));
test("10. combat changes prevent merging", () => assert.notEqual(combatStackKey(identity()), combatStackKey(identity({ combatId: "other" }))));
test("11. turn-window changes prevent merging", () => assert.notEqual(combatStackKey(identity()), combatStackKey(identity({ turnMarkerId: "next" }))));

test("12. Off disables NPC shared-roll handling", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.OFF, "npc"), false));
test("13. Off disables player shared-roll handling", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.OFF, "character"), false));
test("14. NPC-only enables NPCs", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.NPC_STRIKES, "npc"), true));
test("15. NPC-only excludes players", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.NPC_STRIKES, "character"), false));
test("16. player-and-NPC mode enables NPCs", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES, "npc"), true));
test("17. player-and-NPC mode enables characters", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES, "character"), true));
test("18. unsupported actor types remain excluded", () => assert.equal(multiTargetModeAllows(MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES, "hazard"), false));

test("19. two selected targets produce an ordered target set", () => {
  assert.deepEqual(deduplicateTargetSnapshots([target("a"), target("b")]).map((entry) => entry.tokenUuid), ["Scene.s.Token.a", "Scene.s.Token.b"]);
});
test("20. five selected targets retain five entries", () => assert.equal(deduplicateTargetSnapshots(["a", "b", "c", "d", "e"].map((id) => target(id))).length, 5));
test("21. duplicate targeted tokens are deduplicated", () => assert.equal(deduplicateTargetSnapshots([target("a"), target("a")]).length, 1));
test("22. two tokens for the same actor are not deduplicated", () => assert.equal(deduplicateTargetSnapshots([target("a", "shared"), target("b", "shared")]).length, 2));
test("23. invalid target entries are omitted without aborting siblings", () => assert.equal(deduplicateTargetSnapshots([{}, target("valid")]).length, 1));
test("24. target order is assigned at capture", () => assert.deepEqual(deduplicateTargetSnapshots([target("z"), target("a")]).map((entry) => entry.order), [0, 1]));
test("25. a valid two-target capture is accepted", () => assert.equal(validCapture({ schemaVersion: 1, capturedAt: 100, targets: deduplicateTargetSnapshots([target("a"), target("b")]) }, { now: 101 }), true));
test("26. a one-target capture preserves singular behavior", () => assert.equal(validCapture({ schemaVersion: 1, capturedAt: 100, targets: deduplicateTargetSnapshots([target("a")]) }, { now: 101 }), false));
test("27. an expired click capture fails closed", () => assert.equal(validCapture({ schemaVersion: 1, capturedAt: 0, targets: deduplicateTargetSnapshots([target("a"), target("b")]) }, { now: 31_000 }), false));

const dos = (total, dc, dieValue, adjustments = null) => degreeOfSuccess({ total, dc, dieValue, adjustments })?.outcome;
test("28. ten over is a critical success", () => assert.equal(dos(30, 20, 10), "criticalSuccess"));
test("29. equal DC is a success", () => assert.equal(dos(20, 20, 10), "success"));
test("30. below DC is a failure", () => assert.equal(dos(19, 20, 10), "failure"));
test("31. ten under is a critical failure", () => assert.equal(dos(10, 20, 10), "criticalFailure"));
test("32. natural 20 raises failure to success", () => assert.equal(dos(15, 20, 20), "success"));
test("33. natural 20 raises success to critical success", () => assert.equal(dos(20, 20, 20), "criticalSuccess"));
test("34. natural 20 cannot exceed critical success", () => assert.equal(dos(30, 20, 20), "criticalSuccess"));
test("35. natural 1 lowers success to failure", () => assert.equal(dos(20, 20, 1), "failure"));
test("36. natural 1 lowers failure to critical failure", () => assert.equal(dos(19, 20, 1), "criticalFailure"));
test("37. natural 1 cannot go below critical failure", () => assert.equal(dos(5, 20, 1), "criticalFailure"));
test("38. all-outcome degree adjustment is applied after natural adjustment", () => assert.equal(dos(20, 20, 10, { all: { label: "better", amount: 1 } }), "criticalSuccess"));
test("39. outcome-specific degree adjustment is applied", () => assert.equal(dos(20, 20, 10, { success: { label: "worse", amount: -1 } }), "failure"));
test("40. fixed critical-failure adjustment is supported", () => assert.equal(dos(30, 20, 10, { criticalSuccess: { label: "fixed", amount: "criticalFailure" } }), "criticalFailure"));
test("41. different ACs produce different outcomes from one total", () => assert.deepEqual([22, 28, 34].map((dc) => dos(31, dc, 10)), ["success", "success", "failure"]));
test("42. missing structured roll values fail closed", () => assert.equal(degreeOfSuccess({ total: null, dc: 20, dieValue: 10 }), null));
test("43. false predicates exclude degree adjustments", () => assert.deepEqual(mergeDegreeAdjustments([{ predicate: { test: () => false }, adjustments: { all: { label: "x", amount: 1 } } }], new Set()), {}));
test("44. true predicates include degree adjustments", () => assert.equal(mergeDegreeAdjustments([{ predicate: { test: () => true }, adjustments: { all: { label: "x", amount: 1 } } }], new Set()).all.amount, 1));

test("45. no successful targets creates no damage groups", () => {
  const groups = groupTargetOutcomes([child("failure"), child("criticalFailure")]);
  assert.equal(groups.normal.length + groups.critical.length, 0);
});
test("46. all normal hits share one normal group", () => assert.equal(groupTargetOutcomes([child("success"), child("success")]).normal.length, 2));
test("47. all critical hits share one critical group", () => assert.equal(groupTargetOutcomes([child("criticalSuccess"), child("criticalSuccess")]).critical.length, 2));
test("48. mixed hits split into exactly two native groups", () => {
  const groups = groupTargetOutcomes([child("success"), child("criticalSuccess")]);
  assert.deepEqual([groups.normal.length, groups.critical.length], [1, 1]);
});
test("49. failures never enter a damage group", () => assert.equal(groupTargetOutcomes([child("failure")]).normal.length, 0));
test("50. failed concealment excludes only that target", () => {
  const groups = groupTargetOutcomes([child("success", { flatCheckFailed: true }), child("success")]);
  assert.equal(groups.normal.length, 1);
});
test("51. target-specific review does not exclude valid siblings", () => assert.equal(groupTargetOutcomes([child(null, { state: "review" }), child("success")]).normal.length, 1));

const targets = deduplicateTargetSnapshots([target("a"), target("b"), target("c")]);
const transaction = makeBatchTransaction({
  attackMessageId: "attack",
  snapshot: { sourceActorUuid: "Actor.source", sourceTokenUuid: "Scene.s.Token.source", processingUserId: "gm" },
  targets,
  createdAt: 10,
});
test("52. batch parent has deterministic attack identity", () => assert.equal(transaction.id, "nelflow-attack"));
test("53. batch parent contains one child per captured target", () => assert.equal(transaction.targets.length, 3));
test("54. child order matches capture order", () => assert.deepEqual(transaction.targets.map((entry) => entry.order), [0, 1, 2]));
test("55. child keys are independently identifiable", () => assert.equal(new Set(transaction.targets.map((entry) => entry.key)).size, 3));
test("56. batch stores source actor and token separately", () => assert.deepEqual([transaction.snapshot.sourceActorUuid, transaction.snapshot.sourceTokenUuid], ["Actor.source", "Scene.s.Token.source"]));
test("57. normal and critical groups start independently", () => assert.deepEqual(Object.keys(transaction.damageGroups), ["normal", "critical"]));
test("58. linked records begin with only the shared attack", () => assert.deepEqual(transaction.linkedMessageIds, ["attack"]));
test("59. processing child makes parent processing", () => assert.equal(batchState([child("success")]), "processing"));
test("60. applied and review children produce partial manual state", () => assert.equal(batchState([{ state: "applied" }, { state: "review" }]), "manual"));
test("61. terminal misses produce skipped parent", () => assert.equal(batchState([{ state: "miss" }, { state: "miss" }]), "skipped"));
test("62. reload-terminal applied children remain applied data", () => assert.equal(batchState([{ state: "applied" }]), "applied"));

const undoable = { state: "applied", undoBlocked: false, undoEligible: true, preApplication: { hp: 20, tempHp: 0 }, postApplication: { hp: 10, tempHp: 0 } };
test("63. applied child with exact snapshots is undoable", () => assert.equal(canUndoBatchChild(undoable), true));
test("64. non-applied child is not undoable", () => assert.equal(canUndoBatchChild({ ...undoable, state: "review" }), false));
test("65. blocked child is not undoable", () => assert.equal(canUndoBatchChild({ ...undoable, undoBlocked: true }), false));
test("66. guarded per-target Undo restores only exact current health", async () => {
  const actor = { uuid: "Actor.a", health: { hp: 10, tempHp: 0 } };
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }),
    healthSnapshot: (entry) => entry.health,
    restoreHealth: async (entry, health) => { entry.health = health; },
    targetTokenUuid: "Scene.s.Token.a",
    targetActorUuid: "Actor.a",
    preApplication: { hp: 20, tempHp: 0 },
    postApplication: { hp: 10, tempHp: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(actor.health.hp, 20);
});
test("67. stale HP blocks only the unsafe Undo child", async () => {
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor: { uuid: "Actor.a", health: { hp: 9, tempHp: 0 } } }),
    healthSnapshot: (actor) => actor.health,
    restoreHealth: async () => assert.fail("must not restore stale health"),
    targetTokenUuid: "Scene.s.Token.a",
    targetActorUuid: "Actor.a",
    preApplication: { hp: 20, tempHp: 0 },
    postApplication: { hp: 10, tempHp: 0 },
  });
  assert.equal(result.reason, "health-changed");
});

const service = source("scripts/multi-target-strike-service.js");
const resolution = source("scripts/multi-target-strike-resolution.js");
const undoSource = source("scripts/multi-target-strike-undo.js");
const mechanics = `${service}\n${resolution}\n${undoSource}`;
const capture = source("scripts/multi-target-strike-capture.js");
const stack = source("scripts/turn-stack-service.js");
const ui = `${source("scripts/multi-target-strike-ui.js")}\n${source("scripts/chat-ui.js")}`;
const adapter = source("scripts/pf2e-adapter.js");
test("68. one shared attack message drives the batch", () => assert.doesNotMatch(service, /attack\.roll\s*\(/));
test("69. MAP is reused from the one native attack context", () => assert.match(resolution, /mapIncreases: strike\.mapIncreases/));
test("70. normal damage invokes the native damage group once", () => assert.match(service, /processDamageGroup\(message, strike, transaction, "normal"/));
test("71. critical damage invokes the native critical group once", () => assert.match(service, /processDamageGroup\(message, strike, transaction, "critical"/));
test("72. native critical evaluation is selected by criticalSuccess", () => assert.match(adapter, /strike\.outcome === "criticalSuccess" \? "critical" : "damage"/));
test("73. every child application uses PF2e contextual damage", () => assert.match(service, /applyDamageRollToRecordedTarget/));
test("74. IWR remains enabled", () => assert.match(adapter, /skipIWR: false/));
test("75. each child gets its own application identity", () => assert.match(service, /target:\$\{child\.key\}/));
test("76. current target selection is captured once and copied", () => assert.match(capture, /Array\.from\(game\.user\?\.targets/));
test("77. later target changes cannot mutate persisted capture", () => assert.match(service, /capture\.targets/));
test("78. capture is deduplicated by token UUID", () => assert.match(source("scripts/multi-target-strike-model.js"), /seen\.has\(document\.uuid\)/));
test("79. target-specific concealment and hidden DCs are distinct", () => {
  assert.match(resolution, /condition:hidden[\s\S]*return 11/);
  assert.match(resolution, /condition:concealed[\s\S]*return 5/);
});
test("80. flat checks never reroll the shared Strike", () => assert.match(resolution, /type: "flat-check"/));
test("81. one child failure does not abort the application loop", () => assert.match(service, /for \(const original of groupChildren\)/));
test("82. reload reconciliation marks uncertain children Review without reroll", () => assert.match(service, /processing-interrupted/));
test("83. elected GM authority gates batch mutation", () => assert.match(service, /authorityFor\(message\) !== game\.user\.id/));
test("84. socket payloads cannot supply child targets", () => assert.doesNotMatch(service, /socket.*targets|targets.*socket/is));
test("85. NPC presentation is one parent stack row", () => assert.match(stack, /batch: true/));
test("86. player presentation has one canonical visible host", () => assert.match(source("scripts/multi-target-strike-ui.js"), /message\.id !== hostId\(transaction\)/));
test("87. per-target Undo delegates to the shared guarded restore", () => assert.match(undoSource, /undoMultiTarget[\s\S]*restoreChild/));
test("88. Undo All validates each child independently", () => assert.match(undoSource, /undoAllMultiTarget[\s\S]*for \(const child/));
test("89. ordinary UI never renders transaction identifiers", () => assert.doesNotMatch(ui, /textContent\s*=.*transaction\.id|textContent\s*=.*transactionId/));
test("90. exact linked message IDs back Results", () => assert.match(source("scripts/native-records-controller.js"), /linkedMessageIds|damageMessageIds/));
test("91. viewer visibility gates player Results", () => assert.match(source("scripts/multi-target-strike-ui.js"), /message\?\.visible && message\.isContentVisible/));
test("92. stack projection redacts target names for non-GMs", () => assert.match(source("scripts/chat-ui.js"), /!game\.user\.isGM[\s\S]*Nelflow\.Native\.Target/));
test("93. out-of-turn presentation uses a concise round-free label", () => assert.match(source("lang/en.json"), /Stack\.OutOfTurn.*Out of Turn/));
test("94. linked native cards are mutated only while rendering", () => assert.doesNotMatch(source("scripts/native-card-compactor.js"), /message\.update\(|message\.delete\(/));
test("95. no direct HP subtraction was introduced", () => assert.doesNotMatch(mechanics, /system\.attributes\.hp|\.hp\s*[-+]=/));
test("96. no native message deletion was introduced", () => assert.doesNotMatch(mechanics, /delete(ChatMessage|EmbeddedDocuments|Documents)|message\.delete\(|deleteDocuments/));
test("97. no PF2e card HTML is parsed for mechanics", () => assert.doesNotMatch(mechanics, /querySelector|innerHTML|textContent/));
test("98. shared-roll setting defaults to player and NPC Strikes", () => assert.match(source("scripts/settings.js"), /default: MULTI_TARGET_STRIKE_MODES\.PLAYER_AND_NPC_STRIKES/));
test("99. diagnostic presentation setting remains hidden", () => assert.match(source("scripts/settings.js"), /SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*config: false/));
test("100. release metadata targets the 0.14.12 release", () => {
  const manifest = JSON.parse(source("module.json"));
  assert.equal(manifest.version, "0.14.12");
  assert.equal(manifest.download, "https://github.com/nelthegm/NelFlow/releases/download/v0.14.12/nelflow.zip");
});
test("101. authority revalidates the complete captured target set", () => assert.match(service, /authorTargetSetMatches\(author, capture\)/));
test("102. character Undo requires a GM-owned exact application proof", () => {
  assert.match(service, /multiTargetApplicationProof/);
  assert.match(undoSource, /applicationMessage\?\.author\?\.isGM/);
});
test("103. forged duplicate child targets fail capture validation", () => {
  const repeated = deduplicateTargetSnapshots([target("a")])[0];
  assert.equal(validCapture({ schemaVersion: 1, capturedAt: 100, targets: [repeated, { ...repeated, order: 1 }] }, { now: 101 }), false);
});
