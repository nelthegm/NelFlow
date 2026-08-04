import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPlayerStrikeSnapshot,
  correlatePlayerStrikeDamage,
  expectedDamageVariant,
  PLAYER_STRIKE_FAILURES,
  PLAYER_STRIKE_SOCKET_ACTION,
  PLAYER_STRIKE_TRANSACTION_TYPE,
  playerStrikeFingerprint,
  playerStrikeModeAllows,
  reconcilePlayerStrikeReload,
  targetCountFailure,
  validatePlayerStrikeAttack,
  validatePlayerStrikeDamage,
  validatePlayerStrikeSocketPayload,
  validatePlayerStrikeSnapshot,
} from "../scripts/player-strike-model.js";
import { PLAYER_STRIKE_AUTO_APPLY_MODES, TRANSACTION_STATES } from "../scripts/constants.js";
import { guardedHealthRestore } from "../scripts/guarded-health-restore.js";
import { shouldDisablePlayerStrikeForMigration } from "../scripts/settings.js";
import { electProcessingGm } from "../scripts/toolbelt-target-helper-adapter.js";

const cases = [];
const add = (name, run) => cases.push({ name, run });
const rootFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const attack = (changes = {}) => ({
  actorType: "character",
  actionType: "strike",
  itemType: "weapon",
  damaging: true,
  authorIsGm: false,
  authorRole: "player",
  authorActive: true,
  authorOwnsSource: true,
  sourceActorUuid: "Actor.source",
  sourceTokenUuid: "Scene.s.Token.source",
  sourceItemUuid: "Actor.source.Item.weapon",
  strikeIdentifier: "weapon.sword.melee",
  actionIndex: 0,
  altUsage: null,
  attackMessageId: "attack1",
  attackRollId: "roll1",
  targetActorUuid: "Actor.target",
  targetTokenUuid: "Scene.s.Token.target",
  sceneId: "s",
  targetCount: 1,
  targetDisposition: -1,
  sourceDisposition: 1,
  outcome: "success",
  mapIncreases: 0,
  authorUserId: "player1",
  ...changes,
});
const snapshot = (changes = {}) => ({
  ...buildPlayerStrikeSnapshot(attack(), {
    processingUserId: "gm1",
    settingMode: "hostile",
    sessionId: "session1",
  }),
  ...changes,
});
const damage = (changes = {}) => ({
  isNativeDamageRoll: true,
  contextType: "damage-roll",
  sourceActorUuid: "Actor.source",
  sourceTokenUuid: "Scene.s.Token.source",
  sourceItemUuid: "Actor.source.Item.weapon",
  targetActorUuid: "Actor.target",
  targetTokenUuid: "Scene.s.Token.target",
  authorUserId: "player1",
  actionIndex: 0,
  altUsage: null,
  mapIncreases: 0,
  outcome: "success",
  isHealing: false,
  hasPersistentDamage: false,
  ...changes,
});
const transaction = (changes = {}) => ({
  id: "nelflow-attack1",
  transactionType: PLAYER_STRIKE_TRANSACTION_TYPE,
  state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  snapshot: snapshot(),
  ...changes,
});

add("module version is 0.6.5", () => assert.equal(JSON.parse(rootFile("module.json")).version, "0.6.5"));
add("package version is 0.6.5", () => assert.equal(JSON.parse(rootFile("package.json")).version, "0.6.5"));
add("module id remains nelflow", () => assert.equal(JSON.parse(rootFile("module.json")).id, "nelflow"));
add("player Strike setting registers", () => assert.match(rootFile("scripts/settings.js"), /SETTINGS\.PLAYER_STRIKE_AUTO_APPLY/));
add("new-world default is hostile", () => assert.match(rootFile("scripts/settings.js"), /default: PLAYER_STRIKE_AUTO_APPLY_MODES\.HOSTILE/));
add("existing-world migration is off", () => assert.match(rootFile("scripts/settings.js"), /shouldDisablePlayerStrikeForMigration[\s\S]*PLAYER_STRIKE_AUTO_APPLY_MODES\.OFF/));
add("migration version is four", () => assert.match(rootFile("scripts/constants.js"), /SETTINGS_MIGRATION_VERSION = 4/));
add("existing version-three world migrates player Strike off", () => assert.equal(shouldDisablePlayerStrikeForMigration({ version: 3, hasStoredMigration: true }), true));
add("fresh world keeps hostile default", () => assert.equal(shouldDisablePlayerStrikeForMigration({ version: 0, hasStoredMigration: false }), false));
add("version-four migration is idempotent", () => assert.equal(shouldDisablePlayerStrikeForMigration({ version: 4, hasStoredMigration: true }), false));
add("future migration is idempotent", () => assert.equal(shouldDisablePlayerStrikeForMigration({ version: 5, hasStoredMigration: true }), false));

for (const [name, input, expected] of [
  ["off rejects hostile", { mode: "off", snapshotDisposition: -1, currentDisposition: -1 }, false],
  ["hostile accepts hostile", { mode: "hostile", snapshotDisposition: -1, currentDisposition: -1 }, true],
  ["hostile rejects friendly snapshot", { mode: "hostile", snapshotDisposition: 1, currentDisposition: -1 }, false],
  ["hostile rejects friendly current", { mode: "hostile", snapshotDisposition: -1, currentDisposition: 1 }, false],
  ["hostile rejects neutral snapshot", { mode: "hostile", snapshotDisposition: 0, currentDisposition: -1 }, false],
  ["hostile rejects neutral current", { mode: "hostile", snapshotDisposition: -1, currentDisposition: 0 }, false],
  ["hostile rejects missing snapshot", { mode: "hostile", snapshotDisposition: null, currentDisposition: -1 }, false],
  ["hostile rejects missing current", { mode: "hostile", snapshotDisposition: -1, currentDisposition: null }, false],
  ["all accepts hostile", { mode: "all", snapshotDisposition: -1, currentDisposition: -1 }, true],
  ["all accepts friendly", { mode: "all", snapshotDisposition: 1, currentDisposition: 1 }, true],
  ["all accepts neutral", { mode: "all", snapshotDisposition: 0, currentDisposition: 0 }, true],
  ["all disposition transition accepted", { mode: "all", snapshotDisposition: -1, currentDisposition: 1 }, true],
  ["unknown mode rejects", { mode: "future", snapshotDisposition: -1, currentDisposition: -1 }, false],
]) add(name, () => assert.equal(playerStrikeModeAllows(input), expected));

for (const [count, reason] of [
  [0, PLAYER_STRIKE_FAILURES.TARGET_MISSING],
  [1, null],
  [2, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
  [3, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
  [99, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
  [null, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
  [-1, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
]) add(`target count ${String(count)} classification`, () => assert.equal(targetCountFailure(count), reason));

add("character Strike is eligible", () => assert.equal(validatePlayerStrikeAttack(attack()).ok, true));
add("GM-authored character Strike is eligible", () => assert.equal(validatePlayerStrikeAttack(attack({ authorIsGm: true, authorRole: "gm", authorUserId: "gm1" })).ok, true));
for (const [field, value, reason] of [
  ["actorType", "npc", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actorType", "hazard", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actorType", "familiar", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actorType", "army", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actionType", "spell-attack", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actionType", "impulse", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["itemType", "spell", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["itemType", "action", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["damaging", false, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["authorActive", false, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["authorOwnsSource", false, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["sourceActorUuid", null, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["sourceItemUuid", null, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["attackMessageId", null, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["targetCount", 0, PLAYER_STRIKE_FAILURES.TARGET_MISSING],
  ["targetCount", 2, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS],
  ["targetActorUuid", null, PLAYER_STRIKE_FAILURES.TARGET_MISSING],
  ["targetTokenUuid", null, PLAYER_STRIKE_FAILURES.TARGET_MISSING],
  ["outcome", null, PLAYER_STRIKE_FAILURES.OUTCOME_MISSING],
  ["outcome", "unknown", PLAYER_STRIKE_FAILURES.OUTCOME_MISSING],
]) add(`attack rejects ${field}=${String(value)}`, () => {
  const result = validatePlayerStrikeAttack(attack({ [field]: value }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
});

for (const outcome of ["failure", "criticalFailure"]) add(`${outcome} is terminal non-hit`, () => {
  const result = validatePlayerStrikeAttack(attack({ outcome }));
  assert.equal(result.reason, PLAYER_STRIKE_FAILURES.NOT_A_HIT);
  assert.equal(result.terminal, true);
});
for (const [outcome, variant] of [
  ["success", "ordinary"], ["criticalSuccess", "critical"], ["failure", null],
  ["criticalFailure", null], [null, null], ["Success", null],
]) add(`${String(outcome)} expected damage variant`, () => assert.equal(expectedDamageVariant(outcome), variant));

add("snapshot stores exact source", () => assert.equal(snapshot().sourceActorUuid, "Actor.source"));
add("snapshot stores exact target", () => assert.equal(snapshot().targetTokenUuid, "Scene.s.Token.target"));
add("snapshot stores attack message", () => assert.equal(snapshot().attackMessageId, "attack1"));
add("snapshot stores attack roll", () => assert.equal(snapshot().attackRollId, "roll1"));
add("snapshot stores action index", () => assert.equal(snapshot().actionIndex, 0));
add("snapshot stores MAP", () => assert.equal(snapshot().mapIncreases, 0));
add("snapshot stores disposition", () => assert.equal(snapshot().targetDisposition, -1));
add("snapshot stores author", () => assert.equal(snapshot().authoringUserId, "player1"));
add("snapshot stores actor type", () => assert.equal(snapshot().actorType, "character"));
add("snapshot stores author role", () => assert.equal(snapshot().authorRole, "player"));
add("snapshot stores processing GM", () => assert.equal(snapshot().processingUserId, "gm1"));
add("snapshot stores fingerprints", () => assert.match(snapshot().targetFingerprint, /^[0-9a-f]{8}$/));
add("snapshot contains no names", () => assert.equal(Object.keys(snapshot()).some((key) => /name/i.test(key)), false));
add("unchanged attack snapshot revalidates", () => assert.equal(validatePlayerStrikeSnapshot(snapshot(), attack()).ok, true));
for (const [field, value, reason] of [
  ["attackMessageId", "attack2", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["attackRollId", "roll2", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["sourceActorUuid", "Actor.other", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["sourceTokenUuid", "Token.other", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["sourceItemUuid", "Item.other", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["strikeIdentifier", "weapon.other.melee", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["actionIndex", 2, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["altUsage", "thrown", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["authorUserId", "player2", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["mapIncreases", 2, PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["outcome", "criticalSuccess", PLAYER_STRIKE_FAILURES.SOURCE_UNSUPPORTED],
  ["targetCount", 2, PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["targetActorUuid", "Actor.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["targetTokenUuid", "Token.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
]) add(`attack snapshot rejects changed ${field}`, () => assert.equal(
  validatePlayerStrikeSnapshot(snapshot(), attack({ [field]: value })).reason,
  reason,
));

add("exact ordinary damage validates", () => assert.equal(validatePlayerStrikeDamage(snapshot(), damage()).ok, true));
add("exact critical damage validates", () => assert.equal(validatePlayerStrikeDamage(
  snapshot({ outcome: "criticalSuccess", damageVariant: "critical" }),
  damage({ outcome: "criticalSuccess" }),
).ok, true));
add("critical hit accepts ordinary native damage", () => assert.deepEqual(
  validatePlayerStrikeDamage(snapshot({ outcome: "criticalSuccess", damageVariant: "critical" }), damage({ outcome: "success" })),
  { ok: true, reason: null, variant: "ordinary" },
));
add("ordinary hit accepts native critical damage", () => assert.deepEqual(
  validatePlayerStrikeDamage(snapshot(), damage({ outcome: "criticalSuccess" })),
  { ok: true, reason: null, variant: "critical" },
));
add("native healing damage roll remains eligible", () => assert.equal(validatePlayerStrikeDamage(snapshot(), damage({ isHealing: true })).ok, true));
add("native persistent damage component remains eligible", () => assert.equal(validatePlayerStrikeDamage(snapshot(), damage({ hasPersistentDamage: true })).ok, true));
for (const [field, value, reason] of [
  ["isNativeDamageRoll", false, PLAYER_STRIKE_FAILURES.DAMAGE_MISSING],
  ["contextType", "check", PLAYER_STRIKE_FAILURES.DAMAGE_MISSING],
  ["sourceActorUuid", "Actor.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["sourceTokenUuid", "Scene.s.Token.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["sourceItemUuid", "Actor.source.Item.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["targetActorUuid", "Actor.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["targetTokenUuid", "Scene.s.Token.other", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["authorUserId", "player2", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["actionIndex", 1, PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["altUsage", "thrown", PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["mapIncreases", 1, PLAYER_STRIKE_FAILURES.TARGET_CHANGED],
  ["outcome", "failure", PLAYER_STRIKE_FAILURES.VARIANT_MISMATCH],
  ["outcome", null, PLAYER_STRIKE_FAILURES.VARIANT_MISMATCH],
]) add(`damage rejects changed ${field}`, () => {
  const result = validatePlayerStrikeDamage(snapshot(), damage({ [field]: value }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
});

add("one exact transaction correlates", () => assert.equal(correlatePlayerStrikeDamage([transaction()], damage()).ok, true));
add("zero transaction does not correlate", () => assert.equal(correlatePlayerStrikeDamage([], damage()).reason, PLAYER_STRIKE_FAILURES.DAMAGE_MISSING));
add("wrong state does not correlate", () => assert.equal(correlatePlayerStrikeDamage([transaction({ state: "manual" })], damage()).candidates.length, 0));
add("wrong transaction type does not correlate", () => assert.equal(correlatePlayerStrikeDamage([transaction({ transactionType: "strike" })], damage()).candidates.length, 0));
add("two identical transactions are ambiguous", () => {
  const result = correlatePlayerStrikeDamage([transaction({ id: "one" }), transaction({ id: "two" })], damage());
  assert.equal(result.reason, PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS);
  assert.equal(result.candidates.length, 2);
});
add("MAP isolates concurrent attacks", () => {
  const second = transaction({ id: "two", snapshot: snapshot({ mapIncreases: 1 }) });
  assert.equal(correlatePlayerStrikeDamage([transaction(), second], damage()).transaction.id, "nelflow-attack1");
});
add("target isolates concurrent attacks", () => {
  const second = transaction({ id: "two", snapshot: snapshot({ targetActorUuid: "Actor.two" }) });
  assert.equal(correlatePlayerStrikeDamage([transaction(), second], damage()).transaction.id, "nelflow-attack1");
});
add("item isolates concurrent attacks", () => {
  const second = transaction({ id: "two", snapshot: snapshot({ sourceItemUuid: "Item.two" }) });
  assert.equal(correlatePlayerStrikeDamage([transaction(), second], damage()).transaction.id, "nelflow-attack1");
});

const validSocket = { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: "abc_123-XYZ" };
add("identifier-only socket payload validates", () => assert.deepEqual(validatePlayerStrikeSocketPayload(validSocket), validSocket));
for (const payload of [
  null, {}, { action: "other", damageMessageId: "abc" },
  { action: PLAYER_STRIKE_SOCKET_ACTION },
  { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: 7 },
  { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: "" },
  { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: "bad id" },
  { action: PLAYER_STRIKE_SOCKET_ACTION, damageMessageId: "a".repeat(65) },
  { ...validSocket, targetActorUuid: "Actor.evil" },
  { ...validSocket, damage: 99 },
  { ...validSocket, outcome: "criticalSuccess" },
  { ...validSocket, formula: "99d99" },
  { ...validSocket, hpDelta: -99 },
  { ...validSocket, sourceMessageId: "attack2" },
]) add(`socket rejects unsafe payload ${cases.length}`, () => assert.equal(validatePlayerStrikeSocketPayload(payload), null));

for (const [state, activeOperation, expected] of [
  [TRANSACTION_STATES.WAITING_FOR_DAMAGE, null, "wait"],
  [TRANSACTION_STATES.VALIDATING, { sessionId: "old" }, "interrupt"],
  [TRANSACTION_STATES.CLAIMED, { sessionId: "old" }, "interrupt"],
  [TRANSACTION_STATES.APPLYING, { sessionId: "old" }, "interrupt"],
  [TRANSACTION_STATES.VALIDATING, { sessionId: "session1" }, "owned"],
  [TRANSACTION_STATES.CLAIMED, { sessionId: "session1" }, "owned"],
  [TRANSACTION_STATES.APPLYING, { sessionId: "session1" }, "owned"],
  [TRANSACTION_STATES.APPLIED, null, "terminal"],
  [TRANSACTION_STATES.MANUAL, null, "terminal"],
  [TRANSACTION_STATES.ABANDONED, null, "terminal"],
  [TRANSACTION_STATES.AMBIGUOUS, null, "terminal"],
  [TRANSACTION_STATES.UNDONE, null, "terminal"],
]) add(`reload ${state} becomes ${expected}`, () => assert.equal(reconcilePlayerStrikeReload(
  transaction({ state, activeOperation }),
  "session1",
), expected));
add("reload ignores other transaction types", () => assert.equal(reconcilePlayerStrikeReload({ transactionType: "strike" }, "session1"), "ignore"));

for (const [label, left, right] of [
  ["actor", { actor: "a" }, { actor: "b" }],
  ["token", { token: "a" }, { token: "b" }],
  ["item", { item: "a" }, { item: "b" }],
  ["scene", { scene: "a" }, { scene: "b" }],
  ["index", { index: 0 }, { index: 1 }],
  ["MAP", { map: 0 }, { map: 1 }],
  ["variant", { variant: "ordinary" }, { variant: "critical" }],
  ["author", { author: "a" }, { author: "b" }],
  ["target order", ["a", "b"], ["b", "a"]],
  ["null field", { token: null }, { token: "a" }],
  ["empty field", { token: "" }, { token: "a" }],
  ["nested target", { target: { actor: "a" } }, { target: { actor: "b" } }],
]) add(`fingerprint distinguishes ${label}`, () => assert.notEqual(playerStrikeFingerprint(left), playerStrikeFingerprint(right)));
for (const value of ["one", "two", "Actor.abc", "Scene.s.Token.t", {}, [], null, 0]) add(`fingerprint is stable for ${JSON.stringify(value)}`, () => {
  assert.equal(playerStrikeFingerprint(value), playerStrikeFingerprint(value));
  assert.match(playerStrikeFingerprint(value), /^[0-9a-f]{8}$/);
});

const serviceSource = rootFile("scripts/player-strike-service.js");
const modelSource = rootFile("scripts/player-strike-model.js");
const adapterSource = rootFile("scripts/player-strike-adapter.js");
const storeSource = rootFile("scripts/transaction-store.js");
const diagnosticsSource = rootFile("scripts/transaction-diagnostics-service.js");
const diagnosticsUiSource = rootFile("scripts/transaction-diagnostics-ui.js");
for (const [name, pattern, expected] of [
  ["service does not auto-roll Strike damage", /rollStrikeDamage/, false],
  ["service does not call critical method", /\.critical\s*\(/, false],
  ["service does not call damage method", /\.damage\s*\(/, false],
  ["service does not parse innerHTML", /innerHTML/, false],
  ["service does not query card DOM", /querySelector/, false],
  ["service does not parse formulas", /\.formula\b/, false],
  ["service does not delete messages", /(?:message|game\.messages)\s*\.\s*delete\s*\(/, false],
  ["service does not subtract HP", /attributes\.hp[^\n]*-=/, false],
  ["service uses native adapter", /applyDamageRollToRecordedTarget/, true],
  ["service persists claim before application", /persistDamageClaim/, true],
  ["service elects stable GM", /electProcessingGm/, true],
  ["service captures pre-create target count", /preCreateChatMessage/, true],
  ["service uses exact target UUID", /targetTokenUuid/, true],
  ["service has identifier-only socket", /damageMessageId/, true],
  ["model contains no actor-name identity", /actorName/, false],
  ["model contains no token-name identity", /tokenName/, false],
  ["model contains no title correlation", /attackTitle/, false],
  ["model contains no timestamp correlation", /createdTime/, false],
]) add(name, () => assert.equal(pattern.test(name.startsWith("model") ? modelSource : serviceSource), expected));

// Nelflow 0.6.1 focused character-Strike correction matrix.
add("0.6.1 non-GM character success plus Damage auto-validates", () => {
  assert.equal(validatePlayerStrikeAttack(attack()).ok, true);
  assert.equal(validatePlayerStrikeDamage(snapshot(), damage()).ok, true);
});
add("0.6.1 non-GM character critical success plus Critical Damage auto-validates", () => {
  const critical = snapshot({ outcome: "criticalSuccess", damageVariant: "critical" });
  assert.equal(validatePlayerStrikeDamage(critical, damage({ outcome: "criticalSuccess" })).variant, "critical");
});
add("0.6.1 non-GM critical success plus ordinary Damage applies exact variant", () => {
  const critical = snapshot({ outcome: "criticalSuccess", damageVariant: "critical" });
  assert.equal(validatePlayerStrikeDamage(critical, damage({ outcome: "success" })).variant, "ordinary");
});
add("0.6.1 GM-authored character success plus Damage auto-validates", () => {
  assert.equal(validatePlayerStrikeAttack(attack({ authorIsGm: true, authorRole: "gm", authorUserId: "gm1" })).ok, true);
  assert.equal(validatePlayerStrikeDamage(snapshot({ authoringUserId: "gm1", authorIsGm: true, authorRole: "gm" }), damage({ authorUserId: "gm1" })).ok, true);
});
add("0.6.1 GM-authored character critical plus Critical Damage auto-validates", () => {
  const gmCritical = snapshot({ outcome: "criticalSuccess", damageVariant: "critical", authoringUserId: "gm1", authorIsGm: true, authorRole: "gm" });
  assert.equal(validatePlayerStrikeDamage(gmCritical, damage({ outcome: "criticalSuccess", authorUserId: "gm1" })).variant, "critical");
});
add("0.6.1 GM-authored character critical plus ordinary Damage applies exact variant", () => {
  const gmCritical = snapshot({ outcome: "criticalSuccess", damageVariant: "critical", authoringUserId: "gm1", authorIsGm: true, authorRole: "gm" });
  assert.equal(validatePlayerStrikeDamage(gmCritical, damage({ outcome: "success", authorUserId: "gm1" })).variant, "ordinary");
});
add("0.6.1 assistant-GM character author elects one authority", () => assert.equal(electProcessingGm([
  { id: "assistant", active: true, isGM: true },
  { id: "gm", active: true, isGM: true },
], "assistant"), "assistant"));
add("0.6.1 changed current targeting cannot replace recorded target", () => {
  const recorded = snapshot();
  assert.equal(recorded.targetTokenUuid, "Scene.s.Token.target");
  assert.equal(validatePlayerStrikeDamage(recorded, damage()).ok, true);
  assert.doesNotMatch(serviceSource, /game\.user\??\.targets/);
});
add("0.6.1 deleted recorded target enters explicit manual failure", () => {
  assert.match(serviceSource, /targetToken\?\.actor[\s\S]*PLAYER_STRIKE_FAILURES\.TARGET_CHANGED/);
  assert.match(serviceSource, /manualReason: reason/);
});
add("0.6.1 zero recorded targets never auto-apply", () => assert.equal(validatePlayerStrikeAttack(attack({ targetCount: 0 })).reason, PLAYER_STRIKE_FAILURES.TARGET_MISSING));
add("0.6.1 multiple recorded targets never auto-apply", () => assert.equal(validatePlayerStrikeAttack(attack({ targetCount: 2 })).reason, PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS));
add("0.6.1 miss plus manual damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attack({ outcome: "failure" })).terminal, true));
add("0.6.1 critical failure plus manual damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attack({ outcome: "criticalFailure" })).terminal, true));
add("0.6.1 duplicate damage observation has one durable application path", () => {
  assert.match(serviceSource, /observedDamage\.has\(message\.id\)/);
  assert.match(serviceSource, /persistDamageClaim\(damageMessage\.id, transaction\.id\)/);
});
add("0.6.1 two rapid same-character attacks correlate by MAP", () => {
  const first = transaction({ id: "first", snapshot: snapshot({ mapIncreases: 0 }) });
  const second = transaction({ id: "second", snapshot: snapshot({ mapIncreases: 1 }) });
  assert.equal(correlatePlayerStrikeDamage([first, second], damage({ mapIncreases: 0 })).transaction.id, "first");
  assert.equal(correlatePlayerStrikeDamage([first, second], damage({ mapIncreases: 1 })).transaction.id, "second");
});
add("0.6.1 two characters cannot cross-correlate", () => {
  const first = transaction({ id: "first" });
  const second = transaction({ id: "second", snapshot: snapshot({ sourceActorUuid: "Actor.second" }) });
  assert.equal(correlatePlayerStrikeDamage([first, second], damage()).transaction.id, "first");
  assert.equal(correlatePlayerStrikeDamage([first, second], damage({ sourceActorUuid: "Actor.second" })).transaction.id, "second");
});
add("0.6.1 reload between attack and damage continues waiting", () => assert.equal(reconcilePlayerStrikeReload(transaction(), "new-session"), "wait"));
add("0.6.1 GM and player render one durable canonical transaction", () => {
  assert.match(storeSource, /updateLinkedMarker/);
  assert.match(storeSource, /resolveCanonical/);
  assert.match(storeSource, /finalState: nextState/);
});
add("0.6.1 hostile mode rejects neutral and friendly targets", () => {
  assert.equal(playerStrikeModeAllows({ mode: "hostile", snapshotDisposition: 0, currentDisposition: 0 }), false);
  assert.equal(playerStrikeModeAllows({ mode: "hostile", snapshotDisposition: 1, currentDisposition: 1 }), false);
});
add("0.6.1 all-target mode accepts hostile neutral and friendly", () => {
  for (const disposition of [-1, 0, 1]) assert.equal(playerStrikeModeAllows({ mode: "all", snapshotDisposition: disposition, currentDisposition: disposition }), true);
});
add("0.6.1 Off mode never auto-applies", () => assert.equal(playerStrikeModeAllows({ mode: "off", snapshotDisposition: -1, currentDisposition: -1 }), false));
add("0.6.1 guarded Undo restores exact HP and temporary HP", async () => {
  const actor = { uuid: "Actor.target" };
  let restored = null;
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }), healthSnapshot: () => ({ hp: 8, tempHp: 2 }),
    restoreHealth: async (_actor, value) => { restored = value; }, targetTokenUuid: "Token.target",
    targetActorUuid: actor.uuid, preApplication: { hp: 20, tempHp: 0 }, postApplication: { hp: 8, tempHp: 2 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(restored, { hp: 20, tempHp: 0 });
});
add("0.6.1 later HP mutation safely blocks Undo", async () => {
  const actor = { uuid: "Actor.target" };
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }), healthSnapshot: () => ({ hp: 9, tempHp: 2 }),
    restoreHealth: async () => assert.fail("restore must not run"), targetTokenUuid: "Token.target",
    targetActorUuid: actor.uuid, preApplication: { hp: 20, tempHp: 0 }, postApplication: { hp: 8, tempHp: 2 },
  });
  assert.deepEqual(result, { ok: false, reason: "health-changed" });
});
add("0.6.1 existing NPC Strike classification remains actor-based", () => {
  assert.match(rootFile("scripts/pf2e-adapter.js"), /actor\?\.isOfType\?\.\("npc"\)/);
  assert.match(serviceSource, /evidence\.actorType !== "character"/);
});
add("0.6.1 existing Toolbelt basic-save workflow remains isolated", () => {
  assert.match(rootFile("scripts/toolbelt-basic-save-service.js"), /TOOLBELT_TARGET_STATES/);
  assert.equal(PLAYER_STRIKE_TRANSACTION_TYPE, "player-strike");
});
add("0.6.1 Manual diagnostics always carry a reason", () => {
  assert.match(diagnosticsSource, /state === "manual" \? "manual-review-required"/);
  assert.match(storeSource, /TRANSACTION_STATES\.MANUAL, TRANSACTION_STATES\.AMBIGUOUS/);
  assert.match(storeSource, /changes\.failureCode/);
});
add("0.6.1 recovery controls are hidden for valid applied transactions", () => {
  assert.match(diagnosticsUiSource, /playerStrikeRecovery/);
  assert.match(diagnosticsUiSource, /descriptor\.type !== "player-strike" \|\| playerStrikeRecovery/);
});
add("0.6.1 GM pre-create capture is not author-role gated", () => {
  assert.doesNotMatch(adapterSource, /userId !== game\.user\?\.id \|\| game\.user\?\.isGM/);
  assert.match(adapterSource, /userId !== game\.user\?\.id/);
});

add("test matrix contains at least 127 mocked/static scenarios", () => assert.ok(cases.length >= 127));

for (const [index, entry] of cases.entries()) {
  test(`${index + 1}. ${entry.name}`, entry.run);
}
