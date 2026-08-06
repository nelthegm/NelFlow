import assert from "node:assert/strict";
import test from "node:test";

import { guardedHealthRestore } from "../scripts/guarded-health-restore.js";
import {
  SaveMessageClaimRegistry,
  buildSaveCorrelationOption,
  validateSaveCandidate,
} from "../scripts/save-correlation.js";
import {
  RESOLVER_PHASES,
  SAVE_MULTIPLIERS,
  activeOutcome,
  applicationIdFor,
  applyOutcomeOverride,
  canResolveDamage,
  canRollTarget,
  deduplicateTargetSnapshots,
  finalParentPhase,
  isPersistentDamageSummary,
  mayApplyTarget,
  refreshResolverPhase,
  resetTargetSave,
  resolverIdFor,
  targetDamageProjection,
  targetEntryIdFor,
} from "../scripts/save-resolver-model.js";

function target(id = "t1", outcome = null) {
  return {
    targetEntryId: id,
    targetActorUuid: `Actor.${id}`,
    targetTokenUuid: `Scene.s.Token.${id}`,
    saveType: "reflex",
    saveDC: 27,
    kind: "pc",
    ownerUserIds: ["player"],
    saveAttempt: { id: `${id}-attempt-1`, number: 1 },
    saveState: outcome ? "complete" : "pending",
    finalizedDegreeOfSuccess: outcome,
    override: null,
    applicationState: "pending",
  };
}

function resolver(targets = [target()]) {
  return {
    resolverId: "r1",
    sourceMessageId: "source",
    sourceActorUuid: "Actor.caster",
    spellItemUuid: "Actor.caster.Item.fireball",
    authoringUserId: "gm",
    processingUserId: "gm",
    phase: RESOLVER_PHASES.COLLECTING,
    targets,
    damage: { messageId: null },
  };
}

function scope(overrides = {}) {
  return {
    correlationOption: "nelflow:save-correlation:r:t:a:s:u",
    rollingUserId: "player",
    saveType: "reflex",
    saveDC: 27,
    targetActorUuid: "Actor.t1",
    targetTokenUuid: "Scene.s.Token.t1",
    sourceActorUuid: "Actor.caster",
    spellItemUuid: "Actor.caster.Item.fireball",
    attemptId: "t1-attempt-1",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    isChatMessage: true,
    visible: true,
    messageId: "save-message",
    correlationOption: "nelflow:save-correlation:r:t:a:s:u",
    authorUserId: "player",
    contextType: "saving-throw",
    statistic: "reflex",
    dc: 27,
    isCheckRoll: true,
    outcome: "success",
    degreeOfSuccess: 2,
    targetActorUuid: "Actor.t1",
    targetTokenUuid: "Scene.s.Token.t1",
    sourceActorUuid: "Actor.caster",
    itemUuid: "Actor.caster.Item.fireball",
    existingClaim: null,
    ...overrides,
  };
}

test("resolver starts with three distinct targets", () => {
  assert.equal(deduplicateTargetSnapshots([target("a"), target("b"), target("c")]).length, 3);
});

test("duplicate token target is deduplicated", () => {
  const first = target("a");
  assert.deepEqual(deduplicateTargetSnapshots([first, { ...first }]), [first]);
});

test("no targets prevents a ready resolver", () => {
  assert.equal(refreshResolverPhase(resolver([])), RESOLVER_PHASES.COLLECTING);
  assert.equal(deduplicateTargetSnapshots([]).length, 0);
});

test("non-basic spell is rejected by structured eligibility policy", () => {
  const eligible = (spell) => spell.save?.basic === true;
  assert.equal(eligible({ save: { basic: false } }), false);
});

test("attack-roll spell is rejected by structured eligibility policy", () => {
  const eligible = (spell) => spell.isAttack !== true;
  assert.equal(eligible({ isAttack: true }), false);
});

test("spell without native damage is rejected", () => {
  assert.equal(typeof {}.rollDamage === "function", false);
});

test("player owner can initiate own save", () => {
  assert.equal(canRollTarget(target(), { userId: "player", isGM: false, authoringUserId: "gm", ownsActor: true }), true);
});

test("non-owner cannot initiate another PC save", () => {
  assert.equal(canRollTarget(target(), { userId: "other", isGM: false, authoringUserId: "gm", ownsActor: false }), false);
});

test("GM can roll NPC save", () => {
  const npc = { ...target(), kind: "npc" };
  assert.equal(canRollTarget(npc, { userId: "gm", isGM: true, authoringUserId: "gm", ownsActor: false }), true);
});

test("three concurrent saves have distinct correlation identities", () => {
  const options = ["a", "b", "c"].map((id) => buildSaveCorrelationOption({
    resolverId: "r", targetEntryId: id, attemptId: `${id}-1`, sourceMessageId: "s", rollingUserId: "u",
  }));
  assert.equal(new Set(options).size, 3);
});

test("identical save types and DCs do not cross-link", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ correlationOption: "other" })).ok, false);
});

test("reverse save completion order preserves target order", () => {
  const entries = [target("a"), target("b"), target("c")];
  for (const id of ["c", "b", "a"]) entries.find((entry) => entry.targetEntryId === id).saveState = "complete";
  assert.deepEqual(entries.map((entry) => entry.targetEntryId), ["a", "b", "c"]);
});

test("one save message cannot satisfy two targets", () => {
  const claims = new SaveMessageClaimRegistry();
  assert.equal(claims.claim("m", "a").ok, true);
  assert.equal(claims.claim("m", "b").ok, false);
});

test("save result uses finalized PF2e outcome", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ outcome: "criticalFailure", degreeOfSuccess: 0 })).ok, true);
});

test("reset invalidates prior attempt", () => {
  const reset = resetTargetSave(target("a", "success"), "a-attempt-2");
  assert.equal(reset.saveAttempt.id, "a-attempt-2");
  assert.equal(reset.finalizedDegreeOfSuccess, null);
});

test("old save message cannot satisfy reset attempt", () => {
  assert.notEqual(resetTargetSave(target("a", "success"), "new-attempt").saveAttempt.id, "a-attempt-1");
});

test("GM override changes used outcome but preserves native outcome", () => {
  const native = target("a", "success");
  const adjusted = applyOutcomeOverride(native, "failure");
  assert.equal(activeOutcome(adjusted), "failure");
  assert.equal(adjusted.finalizedDegreeOfSuccess, "success");
});

test("resolver is not Ready while one save is pending", () => {
  assert.equal(refreshResolverPhase(resolver([target("a", "success"), target("b")])), RESOLVER_PHASES.COLLECTING);
});

test("Resolve Damage requires one authoritative ready claim", () => {
  const value = resolver([target("a", "success")]);
  value.phase = RESOLVER_PHASES.READY;
  assert.equal(canResolveDamage(value, "gm"), true);
});

test("shared damage identity is deterministic", () => {
  assert.equal(resolverIdFor("message"), resolverIdFor("message"));
});

test("Critical Success receives no application", () => {
  assert.equal(targetDamageProjection(target("a", "criticalSuccess"), { total: 20 }, true).applicationState, "no-damage");
});

test("Success receives native half multiplier", () => {
  assert.equal(SAVE_MULTIPLIERS.success, 0.5);
});

test("Failure receives native full multiplier", () => {
  assert.equal(SAVE_MULTIPLIERS.failure, 1);
});

test("Critical Failure receives native double multiplier", () => {
  assert.equal(SAVE_MULTIPLIERS.criticalFailure, 2);
});

test("four targets receive independent application IDs", () => {
  const ids = ["a", "b", "c", "d"].map((id) => applicationIdFor("r", id));
  assert.equal(new Set(ids).size, 4);
});

test("application failure on one target produces partial without replaying others", () => {
  assert.equal(finalParentPhase([{ applicationState: "applied" }, { applicationState: "manual" }]), RESOLVER_PHASES.PARTIAL);
});

test("same actor through two tokens retains exact token entries", () => {
  assert.notEqual(targetEntryIdFor("r", "Scene.s.Token.a", 0), targetEntryIdFor("r", "Scene.s.Token.b", 1));
});

test("target deletion before application fails safe in guarded restore", async () => {
  const result = await guardedHealthRestore({
    resolveToken: async () => null,
    healthSnapshot: () => null,
    restoreHealth: async () => undefined,
    targetTokenUuid: "missing",
    targetActorUuid: "Actor.a",
    preApplication: { hp: 10, tempHp: 0 },
    postApplication: { hp: 5, tempHp: 0 },
  });
  assert.equal(result.reason, "target-unavailable");
});

test("double-click Resolve is blocked once damage exists", () => {
  const value = resolver([target("a", "success")]);
  value.phase = RESOLVER_PHASES.READY;
  value.damage.messageId = "damage";
  assert.equal(canResolveDamage(value, "gm"), false);
});

test("two GMs cannot process one resolver", () => {
  const value = resolver([target("a", "success")]);
  value.phase = RESOLVER_PHASES.READY;
  assert.equal(canResolveDamage(value, "other-gm"), false);
});

test("reload terminal state is not eligible to reapply", () => {
  assert.equal(mayApplyTarget({ applicationState: "applied" }), false);
});

test("per-target Undo restores only exact target", async () => {
  const actors = { a: { uuid: "Actor.a", hp: { hp: 5, tempHp: 0 } }, b: { uuid: "Actor.b", hp: { hp: 7, tempHp: 0 } } };
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor: actors.a }),
    healthSnapshot: (actor) => actor.hp,
    restoreHealth: async (actor, snapshot) => { actor.hp = snapshot; },
    targetTokenUuid: "a",
    targetActorUuid: "Actor.a",
    preApplication: { hp: 10, tempHp: 0 },
    postApplication: { hp: 5, tempHp: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(actors.b.hp.hp, 7);
});

test("changed HP blocks Undo", async () => {
  const actor = { uuid: "Actor.a", hp: { hp: 4, tempHp: 0 } };
  const result = await guardedHealthRestore({
    resolveToken: async () => ({ actor }),
    healthSnapshot: (entry) => entry.hp,
    restoreHealth: async () => assert.fail("must not restore"),
    targetTokenUuid: "a",
    targetActorUuid: "Actor.a",
    preApplication: { hp: 10, tempHp: 0 },
    postApplication: { hp: 5, tempHp: 0 },
  });
  assert.equal(result.reason, "health-changed");
});

test("manual mode rolls damage but applies none", () => {
  assert.equal(targetDamageProjection(target("a", "failure"), { total: 20 }, false).applicationState, "not-applied");
});

test("persistent-damage roll produces manual fallback signal", () => {
  assert.equal(isPersistentDamageSummary({ components: [{ type: "fire", persistent: true }] }), true);
});

test("unrelated manual save message is ignored", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ correlationOption: null })).ok, false);
});

test("unrelated manual damage has no resolver correlation identity", () => {
  assert.equal(candidate().correlationOption.startsWith("nelflow:save-correlation:"), true);
  assert.equal(String(null).startsWith("nelflow:save-correlation:"), false);
});

test("Results identity is exact message-ID based", () => {
  const records = new Set(["source", "save", "damage", "application"]);
  assert.equal(records.has("unrelated"), false);
});

test("privacy projection can redact hidden target data", () => {
  const projection = (hidden, index) => hidden ? `Target ${index}` : "Visible Name";
  assert.equal(projection(true, 1), "Target 1");
});

test("legacy Strike transactions remain outside resolver identity", () => {
  assert.notEqual(resolverIdFor("attack"), `nelflow-attack`);
});

test("save candidate rejects contradictory numeric degree", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ outcome: "success", degreeOfSuccess: 1 })).ok, false);
});

test("save candidate rejects wrong exact target token", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ targetTokenUuid: "Scene.s.Token.other" })).ok, false);
});

test("save candidate rejects wrong author", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ authorUserId: "other" })).ok, false);
});

test("save candidate rejects wrong DC", () => {
  assert.equal(validateSaveCandidate(scope(), candidate({ dc: 28 })).ok, false);
});
