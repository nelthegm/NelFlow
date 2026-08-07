import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PLAYER_STRIKE_AUTO_APPLY_MODES, TRANSACTION_STATES } from "../scripts/constants.js";
import { DamageMessageClaimRegistry } from "../scripts/damage-correlation.js";
import { guardedHealthRestore } from "../scripts/guarded-health-restore.js";
import {
  bindCharacterStrikeIntentMetadata,
  buildCharacterStrikeIntent,
} from "../scripts/player-strike-intent.js";
import {
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

const attackEvidence = (tx = transaction(), changes = {}) => ({
  actorType: "character",
  actionType: "strike",
  itemType: "weapon",
  damaging: true,
  authorActive: true,
  authorOwnsSource: true,
  attackRollId: "roll-a",
  targetDisposition: -1,
  ...tx.snapshot,
  authorUserId: tx.snapshot.authoringUserId,
  ...changes,
});

const damageEvidence = (changes = {}) => ({
  damageMessageId: "damage-a",
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

const pendingIntent = (tx = transaction(), changes = {}) => buildCharacterStrikeIntent({
  transaction: tx,
  attackEvidence: attackEvidence(tx),
  requestedVariant: "damage",
  clickingUserId: tx.snapshot.authoringUserId,
  createdAt: 1_000,
  intentNonce: "abcdefghijklmnopqrstuvwx",
  ...changes,
});

const boundIntent = (tx = transaction(), changes = {}) => bindCharacterStrikeIntentMetadata(
  pendingIntent(tx, changes),
  changes.boundDamageMessageId ?? "damage-a",
  { boundAt: changes.boundAt ?? 1_100 },
);

test("1. pending intent binds to one native damage message", () => assert.equal(boundIntent().boundDamageMessageId, "damage-a"));
test("2. binding does not finalize the local intent", () => {
  const pending = pendingIntent();
  const bound = bindCharacterStrikeIntentMetadata(pending, "damage-a", { boundAt: 1_100 });
  assert.equal(pending.localIntentState, "pending");
  assert.equal(bound.localIntentState, "bound");
  assert.equal("directIntentConsumedAt" in bound, false);
});
test("3. the same message remains valid after binding", () => assert.equal(
  validateCharacterStrikeCorrelation(transaction(), damageEvidence(), boundIntent(), { now: 2_000 }).ok,
  true,
));
test("4. legacy valid-but-consumed by the same message is accepted idempotently", () => {
  const tx = transaction({
    damageMessageId: "damage-a",
    observedDamageMessageId: "damage-a",
    directIntentNonce: "abcdefghijklmnopqrstuvwx",
    directIntentConsumedAt: 1_100,
  });
  const result = validateCharacterStrikeCorrelation(tx, damageEvidence(), pendingIntent(tx), { now: 145_000 });
  assert.equal(result.decision, "accepted-idempotent");
  assert.equal(result.persistedBindingState, "consumed-by-same-message");
});
test("5. the same nonce and damage message tuple is idempotent", () => {
  const tx = transaction({ damageMessageId: "damage-a", directIntentNonce: "abcdefghijklmnopqrstuvwx" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence(), boundIntent(tx), { now: 90_000 }).decision, "accepted-idempotent");
});
test("6. the same nonce cannot bind a different damage message", () => {
  const result = validateCharacterStrikeCorrelation(transaction(), damageEvidence({ damageMessageId: "damage-b" }), boundIntent(), { now: 2_000 });
  assert.equal(result.reason, PLAYER_STRIKE_FAILURES.DIRECT_INTENT_CONFLICT);
});
test("7. one damage message cannot be claimed by another transaction", () => {
  const claims = new DamageMessageClaimRegistry();
  assert.equal(claims.claim("damage-a", "transaction-a").ok, true);
  assert.equal(claims.claim("damage-a", "transaction-b").ok, false);
});
test("8. exact direct correlation short-circuits fallback", () => {
  const a = transaction();
  const b = transaction({ id: "nelflow-attack-b", attackMessageId: "attack-b", snapshot: snapshot({ attackMessageId: "attack-b" }) });
  const direct = boundIntent(b);
  assert.equal(correlatePlayerStrikeDamageWithIntent([a, b], damageEvidence(), direct, { now: 2_000 }).transaction.id, b.id);
});
test("9. exact direct correlation needs zero fallback candidates", () => {
  const result = correlatePlayerStrikeDamageWithIntent([transaction()], damageEvidence(), boundIntent(), { now: 2_000 });
  assert.equal(result.ok, true);
  assert.equal(result.method, "character-strike-click-intent");
});
test("10. exact direct correlation wins over multiple heuristic candidates", () => {
  const a = transaction();
  const b = transaction({ id: "b", attackMessageId: "attack-b", snapshot: snapshot({ attackMessageId: "attack-b" }) });
  assert.equal(correlatePlayerStrikeDamageWithIntent([a, b], damageEvidence(), boundIntent(b), { now: 2_000 }).transaction.id, "b");
});
test("11. duplicate pre-create binding preserves the same tuple and time", () => {
  const first = boundIntent();
  const second = bindCharacterStrikeIntentMetadata(first, "damage-a", { boundAt: 9_999 });
  assert.equal(second.boundAt, first.boundAt);
  assert.equal(second.intentNonce, first.intentNonce);
  assert.match(source("scripts/player-strike-intent.js"), /localIntentState === "bound"\) return null/);
});
test("12. duplicate create hooks are not classified as valid-but-consumed", () => {
  const service = source("scripts/player-strike-service.js");
  assert.doesNotMatch(service, /valid-but-consumed/);
  assert.match(service, /state !== TRANSACTION_STATES\.WAITING_FOR_DAMAGE/);
});
test("13. duplicate socket delivery retains one claim owner", () => {
  const claims = new DamageMessageClaimRegistry();
  assert.equal(claims.claim("damage-a", "transaction-a").ok, true);
  assert.equal(claims.claim("damage-a", "transaction-a").ok, true);
  assert.equal(claims.owner("damage-a"), "transaction-a");
});
test("14. multiple active GMs elect one processor", () => assert.equal(electProcessingGm([
  { id: "b", active: true, isGM: true }, { id: "a", active: true, isGM: true },
], "player"), "a"));
test("15. GM-authored character Strike direct binding validates", () => {
  const tx = transaction({ sourceUserId: "gm", snapshot: snapshot({ authoringUserId: "gm" }) });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence({ authorUserId: "gm" }), boundIntent(tx), { now: 2_000 }).ok, true);
});
test("16. player-authored character Strike direct binding validates", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), boundIntent(), { now: 2_000 }).ok, true));
test("17. assistant-GM author retains one elected authority", () => assert.equal(electProcessingGm([
  { id: "assistant", active: true, isGM: true }, { id: "gm", active: true, isGM: true },
], "assistant"), "assistant"));
test("18. critical success plus ordinary Damage preserves ordinary", () => {
  const tx = transaction({ snapshot: snapshot({ outcome: "criticalSuccess" }) });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence(), boundIntent(tx), { now: 2_000 }).variant, "ordinary");
});
test("19. critical success plus Critical Damage preserves critical", () => {
  const tx = transaction({ snapshot: snapshot({ outcome: "criticalSuccess" }) });
  const direct = boundIntent(tx, { requestedVariant: "critical" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence({ outcome: "criticalSuccess" }), direct, { now: 2_000 }).variant, "critical");
});
test("20. success plus Critical Damage preserves the selected native roll", () => {
  const direct = boundIntent(transaction(), { requestedVariant: "critical" });
  assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence({ outcome: "criticalSuccess" }), direct, { now: 2_000 }).variant, "critical");
});
test("21. long attack-to-click delay is irrelevant because creation time is the click", () => {
  const direct = boundIntent(transaction(), { createdAt: 120_000, boundAt: 120_100 });
  assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), direct, { now: 120_101 }).ok, true);
});
test("22. more than 30 seconds after binding still validates", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), boundIntent(), { now: 145_000 }).ok, true));
test("23. pending unbound intent expires after 30 seconds", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence(), pendingIntent(), { now: 31_001 }).reason, PLAYER_STRIKE_FAILURES.DIRECT_INTENT_EXPIRED));
test("24. expired unbound intent cannot consume an unrelated message", () => assert.equal(validateCharacterStrikeCorrelation(transaction(), damageEvidence({ damageMessageId: "unrelated" }), pendingIntent(), { now: 31_001 }).ok, false));
test("25. author-browser refresh does not lose a persisted same-message binding", () => {
  const tx = transaction({ damageMessageId: "damage-a", directIntentNonce: "abcdefghijklmnopqrstuvwx" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence(), pendingIntent(tx), { now: 145_000 }).ok, true);
});
test("26. author disconnect after binding is not an active-user rejection", () => {
  const service = source("scripts/player-strike-service.js");
  assert.doesNotMatch(service, /intentAuthor\?\.active/);
  assert.match(service, /a later disconnect must not invalidate/);
});
test("27. GM refresh while applying cannot replay automatically", () => assert.equal(reconcilePlayerStrikeReload(transaction({ state: TRANSACTION_STATES.APPLYING }), "new-session"), "interrupt"));
test("28. application attempts increment only in the applying transition", () => assert.match(source("scripts/player-strike-service.js"), /state: TRANSACTION_STATES\.APPLYING,[\s\S]*applicationAttemptCount:/));
test("29. native application failure is interrupted, not ambiguous", () => assert.match(source("scripts/player-strike-service.js"), /state: TRANSACTION_STATES\.INTERRUPTED,[\s\S]*applicationState: "failed"/));
test("30. an applied same-message transaction remains idempotently valid", () => {
  const tx = transaction({ state: TRANSACTION_STATES.APPLIED, damageMessageId: "damage-a", directIntentNonce: "abcdefghijklmnopqrstuvwx" });
  assert.equal(validateCharacterStrikeCorrelation(tx, damageEvidence(), boundIntent(), { now: 145_000 }).decision, "accepted-idempotent");
});
test("31. guarded Undo still restores only exact recorded health", async () => {
  let restored = null;
  const actor = { uuid: "Actor.target" };
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }), healthSnapshot: () => ({ hp: 4, tempHp: 0 }),
    restoreHealth: async (_actor, value) => { restored = value; }, targetTokenUuid: "Token.target",
    targetActorUuid: actor.uuid, preApplication: { hp: 20, tempHp: 2 }, postApplication: { hp: 4, tempHp: 0 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(restored, { hp: 20, tempHp: 2 });
});
test("32. current target selection is not correlation identity", () => assert.doesNotMatch(source("scripts/player-strike-service.js"), /game\.user\??\.targets/));
test("33. deleted recorded target fails safely", () => assert.match(source("scripts/player-strike-service.js"), /targetToken\?\.actor[\s\S]*PLAYER_STRIKE_FAILURES\.TARGET_CHANGED/));
test("34. zero-target Strike remains ineligible", () => assert.equal(targetCountFailure(0), PLAYER_STRIKE_FAILURES.TARGET_MISSING));
test("35. multi-target character Strike remains manual", () => assert.equal(targetCountFailure(2), PLAYER_STRIKE_FAILURES.MULTIPLE_TARGETS));
test("36. miss-generated damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attackEvidence(transaction(), { outcome: "failure" })).terminal, true));
test("37. critical-failure-generated damage remains ineligible", () => assert.equal(validatePlayerStrikeAttack(attackEvidence(transaction(), { outcome: "criticalFailure" })).terminal, true));
test("38. Off setting does not auto-apply", () => assert.equal(playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.OFF, snapshotDisposition: -1, currentDisposition: -1 }), false));
test("39. Hostile setting continues enforcing disposition", () => assert.equal(playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE, snapshotDisposition: 0, currentDisposition: 0 }), false));
test("40. All setting accepts valid dispositions", () => assert.deepEqual([-1, 0, 1].map((disposition) => playerStrikeModeAllows({ mode: PLAYER_STRIKE_AUTO_APPLY_MODES.ALL, snapshotDisposition: disposition, currentDisposition: disposition })), [true, true, true]));
test("41. NPC Strike workflow remains actor-type isolated", () => assert.match(source("scripts/pf2e-adapter.js"), /actor\?\.isOfType\?\.\("npc"\)/));
test("42. Toolbelt basic-save workflow remains isolated", () => assert.match(source("scripts/toolbelt-basic-save-service.js"), /TOOLBELT_TARGET_STATES/));
test("43. supplied consumed-same-message regression reaches one application gate", () => {
  const tx = transaction({
    damageMessageId: "damage-a",
    observedDamageMessageId: "damage-a",
    directIntentPresent: true,
    directIntentNonce: "abcdefghijklmnopqrstuvwx",
    directIntentConsumedAt: 1_100,
    structuredFallbackCandidateCount: 0,
    applicationAttemptCount: 0,
  });
  const validation = validateCharacterStrikeCorrelation(tx, damageEvidence(), pendingIntent(tx), { now: 145_000 });
  const claims = new DamageMessageClaimRegistry({ persistedOwner: () => tx.id });
  let applicationAttempts = 0;
  if (validation.ok && claims.claim("damage-a", tx.id).ok && claims.markPersisted("damage-a", tx.id)) {
    applicationAttempts += 1;
  }
  assert.equal(validation.decision, "accepted-idempotent");
  assert.equal(applicationAttempts, 1);
  assert.notEqual(validation.reason, PLAYER_STRIKE_FAILURES.DAMAGE_AMBIGUOUS);
});
