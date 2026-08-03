import assert from "node:assert/strict";
import test from "node:test";

import {
  DAMAGE_CORRELATION_REASONS,
  DamageCaptureRegistry,
  DamageMessageClaimRegistry,
} from "../scripts/damage-correlation.js";

function scope(transactionId, overrides = {}) {
  return {
    transactionId,
    attackMessageId: `attack-${transactionId}`,
    sourceActorUuid: "Actor.source",
    sourceTokenUuid: "Scene.scene.Token.source",
    itemUuid: "Actor.source.Item.claw",
    strikeIdentifier: "claw.claw.melee",
    targetActorUuid: "Actor.target",
    targetTokenUuid: "Scene.scene.Token.target",
    expectedOutcome: "success",
    processingUserId: "gm",
    startState: "processing",
    ...overrides,
  };
}

function candidate(capture, messageId, overrides = {}) {
  return {
    document: { id: messageId },
    messageId,
    isChatMessage: true,
    isDamageRoll: true,
    hasNativeDamageRoll: true,
    authorUserId: capture.processingUserId,
    visible: true,
    contextType: "damage-roll",
    correlationOption: capture.correlationOption,
    sourceActorUuid: capture.sourceActorUuid,
    sourceTokenUuid: capture.sourceTokenUuid,
    itemUuid: capture.itemUuid,
    targetActorUuid: capture.targetActorUuid,
    targetTokenUuid: capture.targetTokenUuid,
    outcome: capture.expectedOutcome,
    degreeOfSuccess: capture.expectedOutcome === "criticalSuccess" ? 3 : 2,
    existingTransactionId: null,
    ...overrides,
  };
}

test("two concurrent transactions resolve in creation order", () => {
  const registry = new DamageCaptureRegistry();
  const first = registry.begin(scope("one"));
  const second = registry.begin(scope("two"));
  registry.observe(candidate(first, "damage-one"));
  registry.observe(candidate(second, "damage-two"));
  assert.equal(registry.finish("one").candidateMessageId, "damage-one");
  assert.equal(registry.finish("two").candidateMessageId, "damage-two");
});

test("two concurrent transactions resolve in reverse order", () => {
  const registry = new DamageCaptureRegistry();
  const first = registry.begin(scope("one"));
  const second = registry.begin(scope("two"));
  registry.observe(candidate(second, "damage-two"));
  registry.observe(candidate(first, "damage-one"));
  assert.equal(registry.finish("two").candidateMessageId, "damage-two");
  assert.equal(registry.finish("one").candidateMessageId, "damage-one");
});

test("three identical Strikes retain isolated options", () => {
  const registry = new DamageCaptureRegistry();
  const captures = ["one", "two", "three"].map((id) => registry.begin(scope(id)));
  assert.equal(new Set(captures.map((capture) => capture.correlationOption)).size, 3);
  for (const capture of captures) registry.observe(candidate(capture, `damage-${capture.transactionId}`));
  for (const capture of captures) {
    assert.equal(registry.finish(capture.transactionId).ok, true);
  }
});

test("same Strike against different targets remains isolated", () => {
  const registry = new DamageCaptureRegistry();
  const first = registry.begin(scope("one"));
  const second = registry.begin(
    scope("two", {
      targetActorUuid: "Actor.other",
      targetTokenUuid: "Scene.scene.Token.other",
    }),
  );
  registry.observe(candidate(first, "damage-one"));
  registry.observe(candidate(second, "damage-two"));
  assert.equal(registry.finish("one").ok, true);
  assert.equal(registry.finish("two").ok, true);
});

test("different Strikes against the same target remain isolated", () => {
  const registry = new DamageCaptureRegistry();
  const first = registry.begin(scope("one"));
  const second = registry.begin(
    scope("two", {
      itemUuid: "Actor.source.Item.fist",
      strikeIdentifier: "fist.fist.melee",
    }),
  );
  registry.observe(candidate(first, "damage-one"));
  registry.observe(candidate(second, "damage-two"));
  assert.equal(registry.finish("one").ok, true);
  assert.equal(registry.finish("two").ok, true);
});

test("a rejected native call cleans its capture", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  registry.fail("one", DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED);
  assert.equal(registry.getByOption(capture.correlationOption), null);
  assert.equal(registry.finish("one").reason, DAMAGE_CORRELATION_REASONS.MISSING);
});

test("zero candidates fails missing", () => {
  const registry = new DamageCaptureRegistry();
  registry.begin(scope("one"));
  const result = registry.finish("one");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DAMAGE_CORRELATION_REASONS.MISSING);
});

test("two valid candidates fail ambiguous", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  registry.observe(candidate(capture, "damage-a"));
  registry.observe(candidate(capture, "damage-b"));
  const result = registry.finish("one");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DAMAGE_CORRELATION_REASONS.AMBIGUOUS);
});

test("two transactions cannot claim one message", () => {
  const claims = new DamageMessageClaimRegistry();
  const registry = new DamageCaptureRegistry({ claims });
  const first = registry.begin(scope("one"));
  registry.observe(candidate(first, "shared"));
  assert.equal(registry.finish("one").ok, true);
  const second = registry.begin(scope("two"));
  registry.observe(candidate(second, "shared"));
  const result = registry.finish("two");
  assert.equal(result.reason, DAMAGE_CORRELATION_REASONS.ALREADY_CLAIMED);
});

test("a claimed message cannot be reused", () => {
  const claims = new DamageMessageClaimRegistry();
  assert.equal(claims.claim("damage", "one").ok, true);
  assert.equal(claims.claim("damage", "two").ok, false);
  assert.equal(claims.owner("damage"), "one");
});

test("a failed unpersisted claim can be released safely", () => {
  const claims = new DamageMessageClaimRegistry();
  claims.claim("damage", "one");
  assert.equal(claims.release("damage", "one"), true);
  assert.equal(claims.owner("damage"), null);
});

test("a persisted terminal claim prevents replay", () => {
  const persisted = new Map([["damage", "one"]]);
  const claims = new DamageMessageClaimRegistry({
    persistedOwner: (messageId) => persisted.get(messageId) ?? null,
  });
  assert.equal(claims.claim("damage", "two").reason, DAMAGE_CORRELATION_REASONS.ALREADY_CLAIMED);
  claims.restore("damage", "one");
  assert.equal(claims.release("damage", "one"), false);
});

test("a durable same-owner binding can be marked persisted after session claim loss", () => {
  const claims = new DamageMessageClaimRegistry({
    persistedOwner: (messageId) => messageId === "damage" ? "one" : null,
  });
  assert.equal(claims.markPersisted("damage", "one"), true);
  assert.equal(claims.owner("damage"), "one");
  assert.equal(claims.release("damage", "one"), false);
});

test("critical transaction rejects distinguishable normal damage", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("critical", { expectedOutcome: "criticalSuccess" }));
  const observation = registry.observe(
    candidate(capture, "damage", { outcome: "success", degreeOfSuccess: 2 }),
  );
  assert.equal(observation.reason, DAMAGE_CORRELATION_REASONS.CONTEXT_MISMATCH);
  assert.equal(registry.finish("critical").ok, false);
});

test("manual damage outside the active correlation scope is ignored", () => {
  const registry = new DamageCaptureRegistry();
  registry.begin(scope("one"));
  const observation = registry.observe({
    correlationOption: "manual:unrelated",
    messageId: "manual",
  });
  assert.equal(observation.ignored, true);
});

test("an application ChatMessage is rejected", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  const observation = registry.observe(
    candidate(capture, "application", {
      contextType: "damage-taken",
      isDamageRoll: false,
      hasNativeDamageRoll: false,
    }),
  );
  assert.equal(observation.accepted, false);
  assert.equal(registry.finish("one").ok, false);
});

test("rerender-like duplicate observation does not duplicate a candidate", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  const message = candidate(capture, "damage");
  registry.observe(message);
  registry.observe(message);
  const result = registry.finish("one");
  assert.equal(result.ok, true);
  assert.equal(result.candidateCount, 1);
});

test("a Workbench-like indistinguishable extra message fails ambiguous", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  registry.observe(candidate(capture, "nelflow-damage"));
  registry.observe(candidate(capture, "extra-damage"));
  assert.equal(registry.finish("one").reason, DAMAGE_CORRELATION_REASONS.AMBIGUOUS);
});

test("application cannot occur before an exact claim", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("one"));
  let applications = 0;
  if (registry.finish("one").ok) applications += 1;
  assert.equal(applications, 0);

  const second = registry.begin(scope("two"));
  registry.observe(candidate(second, "damage"));
  if (registry.finish("two").ok) applications += 1;
  assert.equal(applications, 1);
  assert.notEqual(capture.correlationOption, second.correlationOption);
});

test("correlation failure supports a manual-fallback projection", () => {
  const registry = new DamageCaptureRegistry();
  registry.begin(scope("one"));
  const correlation = registry.finish("one");
  const transactionProjection = {
    manualApplicationRequired: !correlation.ok,
    reason: correlation.reason,
  };
  assert.deepEqual(transactionProjection, {
    manualApplicationRequired: true,
    reason: DAMAGE_CORRELATION_REASONS.MISSING,
  });
});

test("legacy optional source-token metadata may be absent", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("legacy", { sourceTokenUuid: null }));
  registry.observe(candidate(capture, "damage", { sourceTokenUuid: null }));
  assert.equal(registry.finish("legacy").ok, true);
});

test("a valid direct return takes priority over captured fallback candidates", () => {
  const registry = new DamageCaptureRegistry();
  const capture = registry.begin(scope("direct"));
  registry.observe(candidate(capture, "captured-a"));
  registry.observe(candidate(capture, "captured-b"));
  const direct = candidate(capture, "direct-message", { correlationOption: null });
  const result = registry.finish("direct", { directCandidate: direct });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, "direct-return");
  assert.equal(result.candidateMessageId, "direct-message");
});

test("deleted-message cleanup drops the local entry but retains persistent authority", () => {
  const persisted = new Map([["damage", "one"]]);
  const claims = new DamageMessageClaimRegistry({
    persistedOwner: (messageId) => persisted.get(messageId) ?? null,
  });
  claims.restore("damage", "one");
  assert.equal(claims.forgetDeletedMessage("damage"), true);
  assert.equal(claims.owner("damage"), "one");
});
