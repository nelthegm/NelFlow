import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PLAYER_STRIKE_AUTO_APPLY_MODES, TRANSACTION_STATES } from "../scripts/constants.js";
import { guardedHealthRestore } from "../scripts/guarded-health-restore.js";
import { buildCharacterStrikeIntent } from "../scripts/player-strike-intent.js";
import {
  correlatePlayerStrikeDamage,
  correlatePlayerStrikeDamageWithIntent,
  PLAYER_STRIKE_FAILURES,
  playerStrikeModeAllows,
  reconcilePlayerStrikeReload,
  targetCountFailure,
  validateCharacterStrikeCorrelation,
  validatePlayerStrikeAttack,
} from "../scripts/player-strike-model.js";
import { electProcessingGm } from "../scripts/toolbelt-target-helper-adapter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

const snapshot = (changes = {}) => ({
  sourceActorUuid: "Actor.character",
  sourceTokenUuid: "Scene.scene.Token.character",
  sourceItemUuid: "Actor.character.Item.sword",
  strikeIdentifier: "sword.long-sword.melee",
  actionIndex: 0,
  altUsage: null,
  attackMessageId: "attack-a",
  attackRollId: "roll-a",
  targetActorUuid: "Actor.target",
  targetTokenUuid: "Scene.scene.Token.target",
  sceneId: "scene",
  targetCount: 1,
  targetDisposition: -1,
  outcome: "success",
  mapIncreases: 0,
  actorType: "character",
  authoringUserId: "player",
  ...changes,
});

const transaction = (changes = {}) => ({
  id: "nelflow-attack-a",
  transactionType: "player-strike",
  state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
  attackMessageId: "attack-a",
  sourceUserId: "player",
  snapshot: snapshot(),
  ...changes,
});

const attackEvidence = (changes = {}) => ({
  actorType: "character",
  actionType: "strike",
  itemType: "weapon",
  damaging: true,
  authorActive: true,
  authorOwnsSource: true,
  sourceActorUuid: "Actor.character",
  sourceTokenUuid: "Scene.scene.Token.character",
  sourceItemUuid: "Actor.character.Item.sword",
  strikeIdentifier: "sword.long-sword.melee",
  actionIndex: 0,
  altUsage: null,
  attackMessageId: "attack-a",
  attackRollId: "roll-a",
  targetActorUuid: "Actor.target",
  targetTokenUuid: "Scene.scene.Token.target",
  sceneId: "scene",
  targetCount: 1,
  targetDisposition: -1,
  outcome: "success",
  mapIncreases: 0,
  authorUserId: "player",
  ...changes,
});

const damageEvidence = (changes = {}) => ({
  isNativeDamageRoll: true,
  contextType: "damage-roll",
  sourceActorUuid: "Actor.character",
  sourceTokenUuid: "Scene.scene.Token.character",
  sourceItemUuid: "Actor.character.Item.sword",
  targetActorUuid: "Actor.target",
  targetTokenUuid: "Scene.scene.Token.target",
  authorUserId: "player",
  actionIndex: 0,
  altUsage: null,
  mapIncreases: 0,
  outcome: "success",
  ...changes,
});

const intent = (tx = transaction(), changes = {}) => buildCharacterStrikeIntent({
  transaction: tx,
  attackEvidence: { ...attackEvidence(), ...tx.snapshot },
  requestedVariant: "damage",
  clickingUserId: "player",
  createdAt: 1_000,
  intentNonce: "abcdefghijklmnopqrstuvwx",
  combat: { id: "combat", round: 2, turn: 1 },
  ...changes,
});

test("1. GM-authored character Damage uses direct intent", () => {
  const tx = transaction({ sourceUserId: "gm", snapshot: snapshot({ authoringUserId: "gm" }) });
  const direct = intent(tx, { clickingUserId: "gm" });
  assert.equal(correlatePlayerStrikeDamageWithIntent([tx], damageEvidence({ authorUserId: "gm" }), direct, { now: 1_001 }).method, "character-strike-click-intent");
});

test("2. GM critical success and Critical Damage direct-link", () => {
  const tx = transaction({ snapshot: snapshot({ outcome: "criticalSuccess", authoringUserId: "gm" }), sourceUserId: "gm" });
  const direct = intent(tx, { clickingUserId: "gm", requestedVariant: "critical" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence({ authorUserId: "gm", outcome: "criticalSuccess" }), direct, { now: 1_002 }).variant, "critical");
});

test("3. GM critical success and ordinary Damage preserves ordinary roll", () => {
  const tx = transaction({ snapshot: snapshot({ outcome: "criticalSuccess", authoringUserId: "gm" }), sourceUserId: "gm" });
  const direct = intent(tx, { clickingUserId: "gm" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence({ authorUserId: "gm", outcome: "success" }), direct, { now: 1_002 }).variant, "ordinary");
});

test("4. player-authored direct intent remains GM-applied", () => {
  assert.equal(correlatePlayerStrikeDamageWithIntent([transaction()], damageEvidence(), intent(), { now: 1_001 }).transaction.id, "nelflow-attack-a");
  assert.match(source("scripts/player-strike-service.js"), /currentUserIsAuthority/);
});

test("5. assistant GM resolves to one authority", () => assert.equal(electProcessingGm([
  { id: "assistant", active: true, isGM: true }, { id: "gm", active: true, isGM: true },
], "assistant"), "assistant"));

test("6. direct intent selects Attack B from identical waiting Strikes", () => {
  const a = transaction();
  const b = transaction({ id: "nelflow-attack-b", attackMessageId: "attack-b", snapshot: snapshot({ attackMessageId: "attack-b" }) });
  const direct = intent(b);
  assert.equal(correlatePlayerStrikeDamageWithIntent([a, b], damageEvidence(), direct, { now: 1_001 }).transaction.id, b.id);
});

test("7. rapid same-weapon attacks remain source-message distinct", () => {
  const a = intent();
  const bTx = transaction({ id: "nelflow-attack-b", attackMessageId: "attack-b", snapshot: snapshot({ attackMessageId: "attack-b" }) });
  const b = intent(bTx);
  assert.notEqual(a.sourceMessageId, b.sourceMessageId);
  assert.notEqual(a.transactionId, b.transactionId);
});

test("8. concurrent characters cannot cross direct correlation", () => {
  const other = transaction({ id: "other", attackMessageId: "attack-other", snapshot: snapshot({ sourceActorUuid: "Actor.other", attackMessageId: "attack-other" }) });
  const result = correlatePlayerStrikeDamageWithIntent([transaction(), other], damageEvidence(), intent(other), { now: 1_001 });
  assert.equal(result.ok, false);
});

test("9. intent records exact source ChatMessage", () => assert.equal(intent().sourceMessageId, "attack-a"));
test("10. Critical Damage records requested variant", () => assert.equal(intent(transaction(), { requestedVariant: "critical" }).requestedVariant, "critical"));
test("11. capture-phase listener leaves PF2e click execution intact", () => assert.match(source("scripts/player-strike-intent.js"), /addEventListener\("click"[\s\S]*capture: true/));
test("12. intent capture never invokes a native damage method", () => assert.doesNotMatch(source("scripts/player-strike-intent.js"), /attack\s*\[|\.damage\s*\(|\.critical\s*\(/));
test("13. outgoing native message receives namespaced correlation metadata", () => assert.match(source("scripts/player-strike-intent.js"), /flags\.\$\{MODULE_ID\}\.characterStrikeCorrelation/));

test("14. forged transaction metadata is rejected", () => {
  const forged = { ...intent(), transactionId: "forged" };
  assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), forged, { now: 1_001 }).reason, PLAYER_STRIKE_FAILURES.DIRECT_INTENT_INVALID);
});

test("15. wrong actor cannot consume intent", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence({ sourceActorUuid: "Actor.other" }), intent(), { now: 1_001 }).ok, false));
test("16. wrong item cannot consume intent", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence({ sourceItemUuid: "Actor.character.Item.other" }), intent(), { now: 1_001 }).ok, false));
test("17. expired intent cannot consume later damage", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), intent(), { now: 31_001 }).reason, PLAYER_STRIKE_FAILURES.DIRECT_INTENT_EXPIRED));
test("18. cancelled native roll has a bounded 30-second intent", () => assert.match(source("scripts/player-strike-model.js"), /CHARACTER_STRIKE_INTENT_MAX_AGE_MS = 30_000/));
test("19. no damage message leaves transaction waiting", () => assert.equal(reconcilePlayerStrikeReload(transaction(), "new-session"), "wait"));

test("20. actual one-message two-candidate fallback is ambiguous", () => {
  const result = correlatePlayerStrikeDamage([transaction(), transaction({ id: "two" })], damageEvidence());
  assert.equal(result.reason, PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS);
  assert.equal(result.candidates.length, 2);
});

test("21. direct intent overrides heuristic ambiguity", () => {
  const a = transaction();
  const b = transaction({ id: "two", attackMessageId: "attack-b", snapshot: snapshot({ attackMessageId: "attack-b" }) });
  assert.equal(correlatePlayerStrikeDamageWithIntent([a, b], damageEvidence(), intent(b), { now: 1_001 }).transaction.id, "two");
});

test("22. duplicate create hooks retain one observed-message guard", () => assert.match(source("scripts/player-strike-service.js"), /observedDamage\.has\(message\.id\)/));
test("23. duplicate socket requests converge on the persistent damage claim", () => assert.match(source("scripts/player-strike-service.js"), /persistDamageClaim\(damageMessage\.id, transaction\.id\)/));
test("24. multiple active GMs elect one stable authority", () => assert.equal(electProcessingGm([{ id: "b", active: true, isGM: true }, { id: "a", active: true, isGM: true }], "player"), "a"));
test("25. refresh after attack keeps waiting transaction eligible", () => assert.equal(reconcilePlayerStrikeReload(transaction(), "new"), "wait"));
test("26. direct linkage persists on transaction and damage message", () => assert.match(source("scripts/player-strike-service.js"), /TransactionStore\.linkMessage\(attackMessage, damageMessage, "damage"\)/));
test("27. refresh during application cannot replay", () => assert.equal(reconcilePlayerStrikeReload(transaction({ state: TRANSACTION_STATES.APPLYING }), "other"), "interrupt"));
test("28. current target selection is never correlation identity", () => assert.doesNotMatch(source("scripts/player-strike-service.js"), /game\.user\??\.targets/));
test("29. deleted recorded target fails through exact target validation", () => assert.match(source("scripts/player-strike-service.js"), /targetToken\?\.actor[\s\S]*PLAYER_STRIKE_FAILURES\.TARGET_CHANGED/));
test("30. zero-target Strike remains ineligible", () => assert.equal(targetCountFailure(0), PLAYER_STRIKE_FAILURES.TARGET_MISSING));
test("31. multi-target character Strike remains manual", () => assert.equal(targetCountFailure(2), PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS));
test("32. miss-generated damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attackEvidence({ outcome: "failure" })).terminal, true));
test("33. critical-failure damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attackEvidence({ outcome: "criticalFailure" })).terminal, true));
test("34. Hostile Targets still rejects neutral targets", () => assert.equal(playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE, snapshotDisposition: 0, currentDisposition: 0 }), false));
test("35. All Targets still accepts every valid disposition", () => assert.deepEqual([-1, 0, 1].map((value) => playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.ALL, snapshotDisposition: value, currentDisposition: value })), [true, true, true]));
test("36. Off mode never applies", () => assert.equal(playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.OFF, snapshotDisposition: -1, currentDisposition: -1 }), false));

test("37. guarded Undo still restores exact HP and temp HP", async () => {
  const actor = { uuid: "Actor.target" };
  let restored = null;
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }), healthSnapshot: () => ({ hp: 5, tempHp: 1 }),
    restoreHealth: async (_actor, value) => { restored = value; }, targetTokenUuid: "Token.target",
    targetActorUuid: actor.uuid, preApplication: { hp: 20, tempHp: 0 }, postApplication: { hp: 5, tempHp: 1 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(restored, { hp: 20, tempHp: 0 });
});

test("38. NPC Strike workflow classification is unchanged", () => assert.match(source("scripts/pf2e-adapter.js"), /actor\?\.isOfType\?\.\("npc"\)/));
test("39. Toolbelt basic-save workflow remains isolated", () => assert.match(source("scripts/toolbelt-basic-save-service.js"), /TOOLBELT_TARGET_STATES/));
test("40. diagnostics and recovery expose direct and fallback evidence", () => {
  const diagnostics = source("scripts/transaction-diagnostics-service.js");
  for (const field of ["directIntentPresent", "directIntentNonceShort", "observedDamageMessageIdShort", "structuredFallbackCandidateIdsShort", "ambiguityStage"]) assert.match(diagnostics, new RegExp(field));
  assert.match(source("scripts/transaction-diagnostics-ui.js"), /playerStrikeRecovery/);
});
