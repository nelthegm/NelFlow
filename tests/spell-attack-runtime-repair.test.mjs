/**
 * Regression: 0.14.13 live Foundry spell-attack hook-boundary failure.
 * Root cause: TransactionStore rejected damage-observed → claimed (skipped validating).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { MODULE_ID, TRANSACTION_STATES } from "../scripts/constants.js";
import { logger } from "../scripts/logger.js";
import {
  resetNelflowBoundaryDiagnosticsForTests,
  runNelflowBoundary,
} from "../scripts/nelflow-boundary.js";
import {
  buildSpellAttackSnapshot,
  SPELL_ATTACK_TRANSACTION_TYPE,
} from "../scripts/spell-attack-model.js";
import {
  captureSpellAttackObservation,
  isSpellAttackCandidate,
  normalizeSpellAttack,
  normalizeSpellAttackDamage,
} from "../scripts/spell-attack-adapter.js";
import { TransactionStore } from "../scripts/transaction-store.js";
import { SPELL_ATTACK_PRESENTATION_PROTOCOL } from "../scripts/spell-attack-presentation-feed.js";

const TOKEN_A = "Scene.s1.Token.a";
const ITEM = "Actor.caster.Item.ray";
const ACTOR = "Actor.caster";

function attackEvidence(overrides = {}) {
  return {
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
    attackMessageId: "atk-live-1",
    attackRollId: "roll1",
    targetActorUuid: "Actor.goblin",
    targetTokenUuid: TOKEN_A,
    sceneId: "s1",
    targetCount: 1,
    outcome: "success",
    authorUserId: "u1",
    authorRole: "player",
    authorIsGm: false,
    ...overrides,
  };
}

function mockMessage(id, flags = {}) {
  const store = { [MODULE_ID]: { ...(flags[MODULE_ID] ?? {}) }, pf2e: { ...(flags.pf2e ?? {}) } };
  return {
    id,
    flags: store,
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

describe("0.14.13 spell-attack runtime repair", () => {
  const warns = [];
  let originalWarn;

  beforeEach(() => {
    resetNelflowBoundaryDiagnosticsForTests();
    warns.length = 0;
    originalWarn = console.warn;
    console.warn = (...args) => {
      warns.push(args);
    };
    globalThis.game = {
      user: { id: "gm1", isGM: true },
      users: { get: () => ({ id: "u1", isGM: false, active: true, role: 1 }) },
      messages: { get: () => null },
    };
    globalThis.ui = { notifications: { warn: () => undefined } };
    globalThis.fromUuidSync = () => null;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("1. real preCreate spell-card source shape does not throw", () => {
    const document = {
      id: null,
      flags: {
        pf2e: {
          context: {
            type: "attack-roll",
            outcome: "success",
            target: { token: TOKEN_A, actor: "Actor.goblin" },
            origin: { token: "Scene.s1.Token.caster" },
            options: ["action:cast-a-spell", "spell-attack"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      _source: {
        rolls: [
          JSON.stringify({
            options: { type: "attack-roll", action: "cast-a-spell" },
          }),
        ],
        flags: {
          pf2e: {
            context: {
              type: "attack-roll",
              options: ["action:cast-a-spell"],
            },
          },
        },
      },
      item: { type: "spell", isAttack: true, uuid: ITEM, name: "Ray of Frost" },
      updateSource(changes) {
        this.flags.pf2e.context.options = changes["flags.pf2e.context.options"];
        this.flags.nelflow = { transaction: changes[`flags.${MODULE_ID}.transaction`] };
      },
    };
    assert.doesNotThrow(() => captureSpellAttackObservation(document, "gm1"));
    assert.ok(
      document.flags.pf2e.context.options.some((o) =>
        o.startsWith("nelflow:spell-attack:target-count:"),
      ),
    );
  });

  it("2. real create spell-attack shape does not throw", () => {
    const message = {
      id: "atk-live-1",
      item: { type: "spell", isAttack: true, uuid: ITEM, name: "Ray of Frost" },
      actor: { uuid: ACTOR, type: "character", testUserPermission: () => true },
      rolls: [{ options: { type: "attack-roll", action: "cast-a-spell" } }],
      flags: {
        pf2e: {
          context: {
            type: "attack-roll",
            outcome: "success",
            target: { token: TOKEN_A, actor: "Actor.goblin" },
            origin: { token: "Scene.s1.Token.caster" },
            options: ["action:cast-a-spell", "nelflow:spell-attack:target-count:1"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      author: { id: "u1" },
    };
    assert.equal(isSpellAttackCandidate(message), true);
    assert.ok(normalizeSpellAttack(message));
  });

  it("3-5. successful spell transaction transitions include validating (not damage-observed→claimed)", async () => {
    const attackMessage = mockMessage("atk-live-1");
    const snapshot = buildSpellAttackSnapshot(attackEvidence(), {
      processingUserId: "gm1",
      sessionId: "sess",
    });
    await TransactionStore.claimSpellAttack(attackMessage, snapshot, {
      state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    });
    let tx = TransactionStore.get(attackMessage);
    assert.equal(tx.transactionType, SPELL_ATTACK_TRANSACTION_TYPE);
    assert.equal(tx.state, TRANSACTION_STATES.WAITING_FOR_DAMAGE);

    tx = await TransactionStore.update(attackMessage, {
      state: TRANSACTION_STATES.DAMAGE_OBSERVED,
      damageMessageId: "dmg-1",
    });
    assert.equal(tx.state, TRANSACTION_STATES.DAMAGE_OBSERVED);

    await assert.rejects(
      () => TransactionStore.update(attackMessage, { state: TRANSACTION_STATES.CLAIMED }),
      /Invalid transaction transition: damage-observed -> claimed/,
    );

    tx = await TransactionStore.update(attackMessage, { state: TRANSACTION_STATES.VALIDATING });
    assert.equal(tx.state, TRANSACTION_STATES.VALIDATING);
    tx = await TransactionStore.update(attackMessage, { state: TRANSACTION_STATES.CLAIMED });
    assert.equal(tx.state, TRANSACTION_STATES.CLAIMED);
    tx = await TransactionStore.update(attackMessage, { state: TRANSACTION_STATES.APPLYING });
    assert.equal(tx.state, TRANSACTION_STATES.APPLYING);
    tx = await TransactionStore.update(attackMessage, { state: TRANSACTION_STATES.APPLIED });
    assert.equal(tx.state, TRANSACTION_STATES.APPLIED);

    const service = readFileSync(new URL("../scripts/spell-attack-service.js", import.meta.url), "utf8");
    assert.match(service, /TRANSACTION_STATES\.VALIDATING/);
    assert.match(service, /DAMAGE_OBSERVED → VALIDATING → CLAIMED/);
  });

  it("6-9. missing optional origin / unresolved item / token / malformed card fail open", () => {
    const throwingItem = {
      id: "m-bad",
      rolls: [{ options: { type: "attack-roll", action: "cast-a-spell" } }],
      flags: {
        pf2e: {
          context: { type: "attack-roll", outcome: "success", options: ["action:cast-a-spell"] },
        },
      },
      get item() {
        throw new Error("origin-item-unresolved");
      },
    };
    assert.equal(isSpellAttackCandidate(throwingItem), false);
    assert.equal(normalizeSpellAttack(throwingItem), null);

    const noItem = {
      id: "m-no-item",
      item: null,
      rolls: [{ options: { type: "attack-roll", action: "cast-a-spell" } }],
      flags: {
        pf2e: {
          context: {
            type: "attack-roll",
            outcome: "success",
            target: { token: TOKEN_A, actor: "Actor.goblin" },
            options: ["action:cast-a-spell"],
          },
          origin: {},
        },
      },
      author: { id: "u1" },
    };
    assert.equal(isSpellAttackCandidate(noItem), false);

    const malformed = {
      id: "m-malformed",
      rolls: "not-an-array",
      flags: { pf2e: { context: { type: "attack-roll" } } },
      get item() {
        return { type: "spell", isAttack: true };
      },
    };
    assert.equal(isSpellAttackCandidate(malformed), false);
    assert.equal(normalizeSpellAttack(malformed), null);

    globalThis.fromUuidSync = () => {
      throw new Error("token-unresolved");
    };
    const okShape = {
      id: "m-token",
      item: { type: "spell", isAttack: true, uuid: ITEM, name: "Ray of Frost" },
      actor: { uuid: ACTOR, testUserPermission: () => true },
      rolls: [{ options: { type: "attack-roll", action: "cast-a-spell" } }],
      flags: {
        pf2e: {
          context: {
            type: "attack-roll",
            outcome: "success",
            target: { token: TOKEN_A, actor: "Actor.goblin" },
            options: ["action:cast-a-spell", "nelflow:spell-attack:target-count:1"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      author: { id: "u1" },
    };
    const normalized = normalizeSpellAttack(okShape);
    assert.ok(normalized);
    assert.equal(normalized.evidence.sceneId, null);
  });

  it("10-11. async hook rejection produces one useful diagnostic with stack", async () => {
    const err = new Error("Invalid transaction transition: damage-observed -> claimed");
    await runNelflowBoundary({
      subsystem: "spell-attack",
      operation: "create-chat-message",
      messageId: "dmg-repeat-1",
      transactionType: "spell-attack",
      task: async () => {
        throw err;
      },
    });
    await runNelflowBoundary({
      subsystem: "spell-attack",
      operation: "create-chat-message",
      messageId: "dmg-repeat-1",
      transactionType: "spell-attack",
      task: async () => {
        throw err;
      },
    });

    const boundaryWarns = warns.filter((args) => args[1] === "hook-boundary-failed");
    assert.equal(boundaryWarns.length, 1);
    const serialized = String(boundaryWarns[0][2]);
    assert.match(serialized, /"errorName":"Error"/);
    assert.match(serialized, /damage-observed -> claimed/);
    assert.match(serialized, /"stack":/);
    assert.match(serialized, /"operation":"create-chat-message"/);
    assert.match(serialized, /"hook":"spell-attack"/);
    assert.equal(serialized.includes("{"), true);
    // Exported log is a string, not a live Object that collapses to "Object".
    assert.equal(typeof boundaryWarns[0][2], "string");
  });

  it("12-15. strike / basic-save / healing / protocol unchanged by repair surface", () => {
    assert.equal(SPELL_ATTACK_PRESENTATION_PROTOCOL, 1);
    const service = readFileSync(new URL("../scripts/spell-attack-service.js", import.meta.url), "utf8");
    assert.doesNotMatch(service, /game\.user\.targets/);
    assert.match(service, /applyDamageRollToRecordedTarget/);
    assert.doesNotMatch(
      readFileSync(new URL("../scripts/player-strike-service.js", import.meta.url), "utf8").slice(0, 200),
      /spell-attack-auto-apply-broken/,
    );
    logger.warn("probe", { stage: "test", reason: "ok" });
  });

  it("damage normalize fails open when item getter throws", () => {
    const message = {
      id: "dmg1",
      isDamageRoll: true,
      rolls: [{ instances: [{}], total: 10, formula: "1d4" }],
      flags: {
        pf2e: {
          context: { type: "damage-roll", sourceType: "attack", outcome: "success" },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      get item() {
        throw new Error("item-unresolved");
      },
      author: { id: "u1" },
    };
    const damage = normalizeSpellAttackDamage(message);
    assert.ok(damage);
    assert.equal(damage.evidence.sourceItemUuid, ITEM);
  });
});
