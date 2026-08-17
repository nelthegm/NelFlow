/**
 * Integration regression: spell attack → correlate → VALIDATING → apply → APPLIED.
 * Exercises real TransactionStore transitions and PF2eAdapter.applyDamageRollToRecordedTarget.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { MODULE_ID, SETTINGS, TRANSACTION_STATES } from "../scripts/constants.js";
import { formatDiagnostic, logger } from "../scripts/logger.js";
import {
  resetNelflowBoundaryDiagnosticsForTests,
  runNelflowBoundary,
} from "../scripts/nelflow-boundary.js";
import { PF2eAdapter } from "../scripts/pf2e-adapter.js";
import {
  buildSpellAttackSnapshot,
  SPELL_ATTACK_TRANSACTION_TYPE,
} from "../scripts/spell-attack-model.js";
import {
  tryEmitSpellAttackDamageAppliedPresentation,
  tryEmitSpellAttackDamageRolledPresentation,
  resetSpellAttackPresentationFeedForTests,
  SPELL_ATTACK_PRESENTATION_PROTOCOL,
} from "../scripts/spell-attack-presentation-feed.js";
import { SpellAttackService } from "../scripts/spell-attack-service.js";
import { TransactionStore } from "../scripts/transaction-store.js";
import { deriveActualStrikeHpLoss } from "../scripts/strike-presentation-feed.js";

const TOKEN_A = "Scene.s1.Token.a";
const TOKEN_B = "Scene.s1.Token.b";
const ITEM = "Actor.caster.Item.ray";
const ACTOR = "Actor.caster";
const TARGET_ACTOR = "Actor.goblin";

function mockMessage(id, extra = {}) {
  const store = { [MODULE_ID]: {}, pf2e: { ...(extra.flags?.pf2e ?? {}) } };
  if (extra.flags?.[MODULE_ID]) store[MODULE_ID] = { ...extra.flags[MODULE_ID] };
  return {
    id,
    flags: store,
    isDamageRoll: extra.isDamageRoll === true,
    rolls: extra.rolls ?? [],
    actor: extra.actor ?? null,
    item: extra.item,
    author: extra.author ?? { id: "u1" },
    token: extra.token ?? null,
    getFlag(scope, key) {
      return store[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      store[scope] ??= {};
      store[scope][key] = structuredClone(value);
      return this;
    },
  };
}

function makeActor(uuid, hp = 40, temp = 5) {
  return {
    uuid,
    system: { attributes: { hp: { value: hp, temp } } },
    alliance: "opposition",
    getContextualClone() {
      return {
        applyDamage: async () => {
          this.system.attributes.hp.value = Math.max(0, this.system.attributes.hp.value - 20);
          this.system.attributes.hp.temp = 0;
        },
        getSelfRollOptions: () => [],
      };
    },
    applyDamage: async () => undefined,
    getSelfRollOptions: () => [],
    testUserPermission: () => true,
  };
}

describe("0.14.13 spell-attack application integration", () => {
  const warns = [];
  let originalWarn;
  let originalApply;
  let applyArgs;
  let damageAppliedHooks;

  beforeEach(() => {
    resetNelflowBoundaryDiagnosticsForTests();
    resetSpellAttackPresentationFeedForTests();
    SpellAttackService.resetStatsForTests();
    warns.length = 0;
    applyArgs = null;
    damageAppliedHooks = [];
    originalWarn = console.warn;
    console.warn = (...args) => {
      warns.push(args);
    };

    const targetActor = makeActor(TARGET_ACTOR, 40, 5);
    const sourceActor = makeActor(ACTOR, 50, 0);
    sourceActor.alliance = "party";
    const sourceItem = { uuid: ITEM, type: "spell", name: "Ray of Frost", isOfType: (t) => t === "spell" };
    const tokenDoc = {
      id: "a",
      uuid: TOKEN_A,
      parent: { id: "s1" },
      actor: targetActor,
      object: null,
    };
    // Placeable-shaped token with .document (canvas Token).
    const tokenPlaceable = {
      id: "a",
      document: tokenDoc,
      actor: targetActor,
      uuid: TOKEN_A,
    };
    tokenDoc.object = tokenPlaceable;

    const docs = new Map([
      [ACTOR, sourceActor],
      [ITEM, sourceItem],
      [TOKEN_A, tokenDoc],
      [TOKEN_B, { id: "b", uuid: TOKEN_B, parent: { id: "s1" }, actor: makeActor("Actor.other"), object: null }],
    ]);

    globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
    globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;
    globalThis.canvas = { tokens: { get: (id) => (id === "a" ? tokenPlaceable : null) } };
    globalThis.Hooks = {
      callAll(hook, payload) {
        if (hook === "nelflow.damageApplied") damageAppliedHooks.push(payload);
      },
    };
    globalThis.ui = { notifications: { warn: () => undefined } };

    const settings = {
      [SETTINGS.ENABLED]: true,
      [SETTINGS.SPELL_ATTACK_AUTO_APPLY]: true,
      [SETTINGS.DEBUG]: false,
      [SETTINGS.ENABLE_UNDO]: true,
    };

    globalThis.game = {
      user: { id: "gm1", isGM: true },
      users: {
        contents: [{ id: "gm1", isGM: true, active: true }],
        get: (id) => (id === "u1" ? { id: "u1", isGM: false, active: true, role: 1 } : { id: "gm1", isGM: true, active: true }),
        [Symbol.iterator]: function* () {
          yield { id: "gm1", isGM: true, active: true };
        },
      },
      messages: { get: () => null, [Symbol.iterator]: function* () {} },
      settings: {
        get: (_m, key) => settings[key],
      },
      nelflow: {},
    };

    // electProcessingGm uses game.users as iterable
    Object.defineProperty(globalThis.game, "users", {
      configurable: true,
      value: Object.assign(
        [{ id: "gm1", isGM: true, active: true }],
        {
          get: (id) =>
            id === "u1"
              ? { id: "u1", isGM: false, active: true, role: 1, testUserPermission: () => true }
              : { id: "gm1", isGM: true, active: true },
        },
      ),
    });

    originalApply = PF2eAdapter.applyDamageRollToRecordedTarget;
  });

  afterEach(() => {
    console.warn = originalWarn;
    PF2eAdapter.applyDamageRollToRecordedTarget = originalApply;
    SpellAttackService.resetStatsForTests();
  });

  it("1-14. full lifecycle reaches apply adapter and APPLIED", async () => {
    const sourceActor = await fromUuid(ACTOR);
    const sourceItem = await fromUuid(ITEM);
    const targetDoc = await fromUuid(TOKEN_A);
    const targetActor = targetDoc.actor;

    const attackMessage = mockMessage("atk-int-1", {
      actor: sourceActor,
      item: sourceItem,
      rolls: [{ options: { type: "attack-roll", action: "cast-a-spell" } }],
      flags: {
        pf2e: {
          context: {
            type: "attack-roll",
            outcome: "success",
            target: { token: TOKEN_A, actor: TARGET_ACTOR },
            origin: { token: "Scene.s1.Token.caster" },
            options: ["action:cast-a-spell", "nelflow:spell-attack:target-count:1"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
    });

    const damageRoll = {
      instances: [{ type: "cold", total: 23 }],
      total: 23,
      formula: "4d4+4",
      kinds: { has: () => false },
    };
    const damageMessage = mockMessage("dmg-int-1", {
      isDamageRoll: true,
      actor: sourceActor,
      // Simulate live spell card: item getter missing, origin.uuid present.
      item: undefined,
      rolls: [damageRoll],
      flags: {
        pf2e: {
          context: {
            type: "damage-roll",
            sourceType: "attack",
            outcome: "success",
            origin: { token: "Scene.s1.Token.caster" },
            target: { token: TOKEN_B, actor: "Actor.other" },
            options: ["action:cast-a-spell"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
    });

    const messages = new Map([
      [attackMessage.id, attackMessage],
      [damageMessage.id, damageMessage],
    ]);
    globalThis.game.messages = {
      get: (id) => messages.get(id) ?? null,
      find: (fn) => [...messages.values()].find(fn),
      [Symbol.iterator]: function* () {
        yield* messages.values();
      },
    };

    const snapshot = buildSpellAttackSnapshot(
      {
        contextType: "attack-roll",
        isStrike: false,
        isSpell: true,
        isSpellAttack: true,
        authorActive: true,
        authorOwnsSource: true,
        sourceActorUuid: ACTOR,
        sourceTokenUuid: "Scene.s1.Token.caster",
        sourceItemUuid: ITEM,
        actionName: "Ray of Frost",
        attackMessageId: attackMessage.id,
        attackRollId: "r1",
        targetActorUuid: TARGET_ACTOR,
        targetTokenUuid: TOKEN_A,
        sceneId: "s1",
        targetCount: 1,
        outcome: "success",
        authorUserId: "u1",
        authorRole: "player",
        authorIsGm: false,
      },
      { processingUserId: "gm1", sessionId: "sess" },
    );

    await TransactionStore.claimSpellAttack(attackMessage, snapshot, {
      state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    });
    assert.equal(TransactionStore.get(attackMessage).state, TRANSACTION_STATES.WAITING_FOR_DAMAGE);

    const states = [];
    const realUpdate = TransactionStore.update.bind(TransactionStore);
    TransactionStore.update = async (message, changes) => {
      const next = await realUpdate(message, changes);
      if (changes.state) states.push(changes.state);
      return next;
    };

    PF2eAdapter.applyDamageRollToRecordedTarget = async (args) => {
      applyArgs = args;
      // Exercise real adapter body for spell item fallback + skipIWR path.
      return originalApply.call(PF2eAdapter, args);
    };

    // Monkeypatch applyDamage on clone to also finish a fake application capture message
    const preHp = { ...targetActor.system.attributes.hp };
    assert.equal(preHp.value, 40);

    const result = await SpellAttackService.handleCreatedMessage(damageMessage);
    TransactionStore.update = realUpdate;

    assert.equal(result, true);
    assert.ok(applyArgs, "apply adapter must be invoked");
    assert.equal(applyArgs.targetToken.document?.uuid ?? applyArgs.targetToken.uuid, TOKEN_A);
    assert.equal(applyArgs.damageRoll, damageRoll);
    assert.equal(applyArgs.expectedTargetActorUuid, TARGET_ACTOR);
    assert.equal(applyArgs.applicationId, `nelflow-spell-attack-${attackMessage.id}`);
    assert.equal(applyArgs.attackMessageId, attackMessage.id);
    assert.ok(states.includes(TRANSACTION_STATES.VALIDATING));
    assert.ok(states.includes(TRANSACTION_STATES.CLAIMED));
    assert.ok(states.includes(TRANSACTION_STATES.APPLYING));
    assert.ok(states.includes(TRANSACTION_STATES.APPLIED));

    const finalTx = TransactionStore.get(attackMessage);
    assert.equal(finalTx.state, TRANSACTION_STATES.APPLIED);
    assert.equal(finalTx.transactionType, SPELL_ATTACK_TRANSACTION_TYPE);
    assert.ok(Number.isFinite(finalTx.appliedAmount));
    assert.ok(finalTx.preApplication);
    assert.ok(finalTx.postApplication);
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: finalTx.preApplication,
        postApplication: finalTx.postApplication,
      }),
      finalTx.appliedAmount,
    );

    // Target switch on damage card must not redirect application.
    assert.equal(finalTx.snapshot.targetTokenUuid, TOKEN_A);
    assert.notEqual(damageMessage.flags.pf2e.context.target.token, TOKEN_A);
  });

  it("11. damageRolled presentation failure does not block application", async () => {
    resetSpellAttackPresentationFeedForTests();
    const rolled = tryEmitSpellAttackDamageRolledPresentation({
      transactionId: "nelflow-spell-attack-x",
      targetTokenUuid: TOKEN_A,
      rolledTotal: 23,
    });
    assert.equal(rolled.emitted, true);
    // Second emit is duplicate — mechanics must not depend on it.
    assert.equal(
      tryEmitSpellAttackDamageRolledPresentation({
        transactionId: "nelflow-spell-attack-x",
        targetTokenUuid: TOKEN_A,
        rolledTotal: 23,
      }).emitted,
      false,
    );
    assert.equal(SPELL_ATTACK_PRESENTATION_PROTOCOL, 1);
  });

  it("15-17. unexpected exception logs serialized stack + transactionId once", async () => {
    const err = new Error("spell-apply-boom");
    err.nelflowContext = {
      transactionId: "nelflow-spell-attack-atk-int-1",
      messageId: "dmg-int-1",
      messageType: "spell-attack",
      state: "applying",
    };
    await runNelflowBoundary({
      subsystem: "spell-attack",
      operation: "create-chat-message",
      messageId: "dmg-int-1",
      transactionType: "spell-attack",
      task: async () => {
        throw err;
      },
    });
    await runNelflowBoundary({
      subsystem: "spell-attack",
      operation: "create-chat-message",
      messageId: "dmg-int-1",
      transactionType: "spell-attack",
      task: async () => {
        throw err;
      },
    });

    const boundaryWarns = warns.filter((args) => String(args[0] ?? "").includes("hook-boundary-failed"));
    assert.equal(boundaryWarns.length, 1);
    const line = String(boundaryWarns[0][0]);
    assert.match(line, /hook-boundary-failed/);
    assert.match(line, /"errorName":"Error"/);
    assert.match(line, /spell-apply-boom/);
    assert.match(line, /"stack":/);
    assert.match(line, /nelflow-spell-attack-atk-int-1/);
    assert.equal(boundaryWarns[0].length, 1);
    assert.equal(typeof boundaryWarns[0][0], "string");
    assert.doesNotMatch(line, /\[object Object\]/);
  });

  it("18. failed adapter does not leave target damaged when apply returns null", async () => {
    const targetDoc = await fromUuid(TOKEN_A);
    const before = targetDoc.actor.system.attributes.hp.value;
    PF2eAdapter.applyDamageRollToRecordedTarget = async () => null;

    const attackMessage = mockMessage("atk-fail-1");
    const snapshot = buildSpellAttackSnapshot(
      {
        contextType: "attack-roll",
        isStrike: false,
        isSpell: true,
        isSpellAttack: true,
        authorActive: true,
        authorOwnsSource: true,
        sourceActorUuid: ACTOR,
        sourceTokenUuid: "Scene.s1.Token.caster",
        sourceItemUuid: ITEM,
        actionName: "Ray of Frost",
        attackMessageId: attackMessage.id,
        targetActorUuid: TARGET_ACTOR,
        targetTokenUuid: TOKEN_A,
        sceneId: "s1",
        targetCount: 1,
        outcome: "success",
        authorUserId: "u1",
      },
      { processingUserId: "gm1", sessionId: "sess" },
    );
    await TransactionStore.claimSpellAttack(attackMessage, snapshot, {
      state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    });

    const sourceActor = await fromUuid(ACTOR);
    const damageRoll = { instances: [{ type: "cold", total: 10 }], total: 10, formula: "1d4", kinds: { has: () => false } };
    const damageMessage = mockMessage("dmg-fail-1", {
      isDamageRoll: true,
      actor: sourceActor,
      item: await fromUuid(ITEM),
      rolls: [damageRoll],
      flags: {
        pf2e: {
          context: {
            type: "damage-roll",
            sourceType: "attack",
            outcome: "success",
            origin: { token: "Scene.s1.Token.caster" },
            options: [],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
    });
    const messages = new Map([
      [attackMessage.id, attackMessage],
      [damageMessage.id, damageMessage],
    ]);
    globalThis.game.messages = {
      get: (id) => messages.get(id) ?? null,
      find: (fn) => [...messages.values()].find(fn),
      [Symbol.iterator]: function* () {
        yield* messages.values();
      },
    };

    const ok = await SpellAttackService.handleCreatedMessage(damageMessage);
    assert.equal(ok, false);
    assert.equal(targetDoc.actor.system.attributes.hp.value, before);
    const tx = TransactionStore.get(attackMessage);
    assert.ok([TRANSACTION_STATES.INTERRUPTED, TRANSACTION_STATES.MANUAL].includes(tx.state));
  });

  it("adapter accepts missing message.item when origin matches sourceItem", async () => {
    const sourceActor = await fromUuid(ACTOR);
    const sourceItem = await fromUuid(ITEM);
    const targetToken = (await fromUuid(TOKEN_A)).object;
    const damageRoll = { instances: [{ type: "cold", total: 23 }], total: 23, alter: () => damageRoll };
    const damageMessage = mockMessage("dmg-itemless", {
      isDamageRoll: true,
      actor: null,
      item: undefined,
      rolls: [damageRoll],
      flags: {
        pf2e: {
          context: { type: "damage-roll", options: ["self:type:character"] },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
    });

    let skipIwr = null;
    const originalClone = targetToken.actor.getContextualClone;
    targetToken.actor.getContextualClone = function () {
      return {
        getSelfRollOptions: () => [],
        applyDamage: async (args) => {
          skipIwr = args.skipIWR;
        },
      };
    };

    const applied = await PF2eAdapter.applyDamageRollToRecordedTarget({
      damageMessage,
      damageRoll,
      sourceActor,
      sourceItem,
      targetToken,
      expectedTargetActorUuid: TARGET_ACTOR,
      multiplier: 1,
      outcome: "success",
      applicationId: "nelflow-spell-attack-test",
      attackMessageId: "atk",
    });
    targetToken.actor.getContextualClone = originalClone;
    assert.ok(applied);
    assert.equal(skipIwr, false);
  });

  it("diagnostic format is a single JSON string line", () => {
    const text = formatDiagnostic(
      {
        hook: "spell-attack",
        operation: "create-chat-message",
        messageId: "m1",
        transactionId: "nelflow-spell-attack-m0",
        errorName: "TypeError",
        errorMessage: "Cannot read properties of undefined (reading 'uuid')",
        stack: "TypeError: boom\n    at createApplicationCapture (pf2e-adapter.js:189)",
      },
      null,
    );
    assert.equal(typeof text, "string");
    assert.match(text, /errorName/);
    assert.match(text, /createApplicationCapture/);
    logger.warn("hook-boundary-failed", JSON.parse(text));
    const line = String(warns.at(-1)[0]);
    assert.match(line, /^Nelflow \| hook-boundary-failed \{/);
  });
});
