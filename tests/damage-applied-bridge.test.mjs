import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const {
  DAMAGE_APPLIED_HOOK,
  DAMAGE_APPLIED_PROTOCOL,
  extractImmediateDamageTypesFromRoll,
  buildDamageAppliedPayload,
  projectAppliedDamageFlag,
  emitDamageApplied,
} = await import("../scripts/damage-applied-bridge.js");

test("version is 0.14.2", () => {
  assert.match(source("module.json"), /"version": "0.14.2"/);
  assert.match(source("package.json"), /"version": "0.14.2"/);
});

test("protocol and hook naming", () => {
  assert.equal(DAMAGE_APPLIED_PROTOCOL, 1);
  assert.equal(DAMAGE_APPLIED_HOOK, "nelflow.damageApplied");
});

test("pure fire immediate types", () => {
  const types = extractImmediateDamageTypesFromRoll({
    instances: [
      { type: "fire", total: 10, persistent: false },
      { type: "fire", total: 2, persistent: false },
    ],
  });
  assert.deepEqual(types.immediateDamageTypes, ["fire"]);
  assert.equal(types.hasUntypedImmediate, false);
});

test("deferred persistent excluded from immediate types", () => {
  const types = extractImmediateDamageTypesFromRoll({
    instances: [
      { type: "fire", total: 10, persistent: false },
      { type: "bleed", total: 3, persistent: true, evaluatePersistent: false },
    ],
  });
  assert.deepEqual(types.immediateDamageTypes, ["fire"]);
});

test("splash same type collapses", () => {
  const types = extractImmediateDamageTypesFromRoll({
    instances: [
      { type: "fire", total: 5 },
      { type: "fire", total: 2 }, // splash still type fire
    ],
  });
  assert.deepEqual(types.immediateDamageTypes, ["fire"]);
});

test("mixed fire + slashing reports both pre-IWR types", () => {
  const types = extractImmediateDamageTypesFromRoll({
    instances: [
      { type: "slashing", total: 10 },
      { type: "fire", total: 5 },
    ],
  });
  assert.deepEqual(types.immediateDamageTypes, ["fire", "slashing"]);
});

test("payload has no post-IWR typed amounts", () => {
  const payload = buildDamageAppliedPayload({
    transactionId: "tx-fire-1",
    targetActorUuid: "Actor.t",
    targetTokenUuid: "Token.t",
    transformedRoll: { instances: [{ type: "fire", total: 12 }] },
    damageMessage: { id: "m1", uuid: "ChatMessage.m1" },
    appliedDamage: {
      uuid: "Actor.t",
      isHealing: false,
      updates: [{ path: "system.attributes.hp.value", value: 8 }],
    },
    originActorUuid: "Actor.s",
    originItemUuid: "Item.s",
    sourceItem: { system: { level: { value: 3 } } },
  });
  assert.ok(payload);
  assert.equal(payload.protocol, 1);
  assert.deepEqual(payload.source.immediateDamageTypes, ["fire"]);
  assert.equal(payload.source.kind, "damage-roll");
  assert.equal(payload.source.sourceLevel, 3);
  assert.equal(payload.appliedDamage.updates[0].value, 8);
  assert.equal("damageByType" in payload, false);
  assert.equal(payload.isUndo, false);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /postIwr|damageByType/);
});

test("mixed payload still reports both types without residuals", () => {
  const payload = buildDamageAppliedPayload({
    transactionId: "tx-mixed",
    targetActorUuid: "Actor.t",
    targetTokenUuid: "Token.t",
    transformedRoll: {
      instances: [
        { type: "slashing", total: 10 },
        { type: "fire", total: 5 },
      ],
    },
    damageMessage: { id: "m2", uuid: "ChatMessage.m2" },
    appliedDamage: {
      uuid: "Actor.t",
      isHealing: false,
      updates: [{ path: "system.attributes.hp.value", value: 12 }],
    },
  });
  assert.deepEqual(payload.source.immediateDamageTypes, ["fire", "slashing"]);
});

test("healing appliedDamage rejects payload", () => {
  const payload = buildDamageAppliedPayload({
    transactionId: "tx-heal",
    targetActorUuid: "Actor.t",
    transformedRoll: { instances: [{ type: "fire", total: 5 }] },
    appliedDamage: { uuid: "Actor.t", isHealing: true, updates: [] },
  });
  assert.equal(payload, null);
});

test("multi-target distinct transaction ids", () => {
  const a = buildDamageAppliedPayload({
    transactionId: "batch:target:A",
    targetActorUuid: "Actor.A",
    transformedRoll: { instances: [{ type: "fire", total: 10 }] },
    appliedDamage: {
      uuid: "Actor.A",
      isHealing: false,
      updates: [{ path: "system.attributes.hp.value", value: 4 }],
    },
  });
  const b = buildDamageAppliedPayload({
    transactionId: "batch:target:B",
    targetActorUuid: "Actor.B",
    transformedRoll: { instances: [{ type: "fire", total: 10 }] },
    appliedDamage: {
      uuid: "Actor.B",
      isHealing: false,
      updates: [{ path: "system.attributes.hp.value", value: 4 }],
    },
  });
  assert.notEqual(a.transactionId, b.transactionId);
  assert.notEqual(a.target.actorUuid, b.target.actorUuid);
});

test("emit uses Hooks.callAll and does not throw on listener failure", () => {
  const calls = [];
  globalThis.Hooks = {
    callAll: (name, payload) => {
      calls.push({ name, payload });
      throw new Error("listener boom");
    },
  };
  const payload = buildDamageAppliedPayload({
    transactionId: "tx-emit",
    targetActorUuid: "Actor.t",
    transformedRoll: { instances: [{ type: "cold", total: 6 }] },
    appliedDamage: {
      uuid: "Actor.t",
      isHealing: false,
      updates: [{ path: "system.attributes.hp.temp", value: 3 }],
    },
  });
  assert.equal(emitDamageApplied(payload), false);
  assert.equal(calls[0].name, DAMAGE_APPLIED_HOOK);
});

test("adapter wires emission after applyDamage capture", () => {
  const adapter = source("scripts/pf2e-adapter.js");
  assert.match(adapter, /emitDamageAppliedFromApplication/);
  assert.match(adapter, /finishApplicationCapture/);
  assert.doesNotMatch(adapter, /damageByType/);
});

test("undo path does not call applyDamageRollToRecordedTarget", () => {
  assert.doesNotMatch(source("scripts/guarded-health-restore.js"), /applyDamageRollToRecordedTarget/);
  assert.doesNotMatch(source("scripts/guarded-health-restore.js"), /damageApplied/);
});

test("no fabricated post-IWR type amounts in producer", () => {
  const bridge = source("scripts/damage-applied-bridge.js");
  assert.match(bridge, /PRE-IWR|pre-IWR|pre-iwr/i);
  assert.doesNotMatch(bridge, /damageByType\s*:/);
  assert.match(bridge, /installDamageAppliedPublicApi/);
});

test("projectAppliedDamageFlag is plain data", () => {
  const projected = projectAppliedDamageFlag({
    uuid: "Actor.x",
    isHealing: false,
    updates: [{ path: "system.attributes.hp.value", value: 2 }],
    shield: { id: "Shield.1", damage: 3 },
  });
  assert.equal(projected.shield.damage, 3);
  JSON.parse(JSON.stringify(projected));
});
