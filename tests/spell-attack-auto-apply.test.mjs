/**
 * 0.14.13 — single-target spell attack auto-apply (correlation + presentation).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { TRANSACTION_STATES } from "../scripts/constants.js";
import {
  buildSpellAttackSnapshot,
  buildSpellAttackTransactionId,
  correlateSpellAttackDamage,
  SPELL_ATTACK_FAILURES,
  SPELL_ATTACK_TRANSACTION_TYPE,
  validateSpellAttack,
  validateSpellAttackDamage,
} from "../scripts/spell-attack-model.js";
import {
  isSpellAttackCandidate,
  normalizeSpellAttack,
  normalizeSpellAttackDamage,
} from "../scripts/spell-attack-adapter.js";
import {
  buildSpellAttackDamageAppliedPayload,
  buildSpellAttackDamageRolledPayload,
  installSpellAttackPresentationFeedApi,
  resetSpellAttackPresentationFeedForTests,
  SPELL_ATTACK_PRESENTATION_PROTOCOL,
  tryEmitSpellAttackDamageAppliedPresentation,
  tryEmitSpellAttackDamageRolledPresentation,
} from "../scripts/spell-attack-presentation-feed.js";
import { deriveActualStrikeHpLoss } from "../scripts/strike-presentation-feed.js";
import { readFileSync } from "node:fs";

const TOKEN_A = "Scene.s1.Token.a";
const TOKEN_B = "Scene.s1.Token.b";
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
    attackMessageId: "atk1",
    attackRollId: "roll1",
    targetActorUuid: "Actor.goblin",
    targetTokenUuid: TOKEN_A,
    sceneId: "s1",
    targetCount: 1,
    outcome: "success",
    authorUserId: "u1",
    ...overrides,
  };
}

function damageEvidence(overrides = {}) {
  return {
    damageMessageId: "dmg1",
    isNativeDamageRoll: true,
    contextType: "damage-roll",
    sourceType: "attack",
    isStrikeDamage: false,
    sourceActorUuid: ACTOR,
    sourceTokenUuid: "Scene.s1.Token.caster",
    sourceItemUuid: ITEM,
    targetActorUuid: "Actor.other",
    targetTokenUuid: TOKEN_B,
    authorUserId: "u1",
    outcome: "success",
    isHealing: false,
    rolledTotal: 20,
    formula: "4d4+4",
    ...overrides,
  };
}

function waitingTx(id, snapshotOverrides = {}) {
  const evidence = attackEvidence({ attackMessageId: id });
  return {
    id: buildSpellAttackTransactionId(id),
    transactionType: SPELL_ATTACK_TRANSACTION_TYPE,
    state: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    attackMessageId: id,
    sourceUserId: "u1",
    snapshot: buildSpellAttackSnapshot(evidence, {
      processingUserId: "gm1",
      sessionId: "s",
    }),
    ...snapshotOverrides,
  };
}

describe("0.14.13 spell-attack auto-apply", () => {
  beforeEach(() => {
    resetSpellAttackPresentationFeedForTests();
    globalThis.game = {
      nelflow: {},
      users: { get: () => ({ id: "u1", isGM: false, active: true, role: 1 }) },
    };
  });

  it("1-7. recognizes spell attack; excludes strike/save/generic", () => {
    const spellAttack = {
      id: "m1",
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
            options: ["action:cast-a-spell"],
          },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      author: { id: "u1" },
    };
    assert.equal(isSpellAttackCandidate(spellAttack), true);

    const strike = {
      ...spellAttack,
      item: { type: "weapon", uuid: "Actor.x.Item.w" },
      rolls: [{ options: { type: "attack-roll", action: "strike" } }],
    };
    assert.equal(isSpellAttackCandidate(strike), false);

    const saveDamage = {
      isDamageRoll: true,
      rolls: [{ instances: [{}], total: 10 }],
      flags: {
        pf2e: {
          context: { type: "damage-roll", sourceType: "save" },
          origin: { uuid: ITEM, actor: ACTOR },
        },
      },
      item: { type: "spell", isOfType: (t) => t === "spell" },
      author: { id: "u1" },
    };
    assert.equal(normalizeSpellAttackDamage(saveDamage), null);

    assert.equal(validateSpellAttack(attackEvidence()).ok, true);
    assert.equal(validateSpellAttack(attackEvidence({ isSpell: false })).ok, false);
  });

  it("8-13. target capture rules", () => {
    assert.equal(validateSpellAttack(attackEvidence({ targetCount: 0 })).reason, SPELL_ATTACK_FAILURES.TARGET_MISSING);
    assert.equal(validateSpellAttack(attackEvidence({ targetCount: 2 })).reason, SPELL_ATTACK_FAILURES.MULTIPLE_TARGETS);
    const snap = buildSpellAttackSnapshot(attackEvidence(), { processingUserId: "gm", sessionId: "s" });
    assert.equal(snap.targetTokenUuid, TOKEN_A);
    assert.equal(snap.targetActorUuid, "Actor.goblin");
    // Damage message current target differs — still valid correlation evidence.
    assert.equal(validateSpellAttackDamage(snap, damageEvidence({ targetTokenUuid: TOKEN_B })).ok, true);
  });

  it("14-19. outcome eligibility", () => {
    assert.equal(validateSpellAttack(attackEvidence({ outcome: "success" })).ok, true);
    assert.equal(validateSpellAttack(attackEvidence({ outcome: "criticalSuccess" })).ok, true);
    assert.equal(validateSpellAttack(attackEvidence({ outcome: "failure" })).reason, SPELL_ATTACK_FAILURES.NOT_A_HIT);
    assert.equal(validateSpellAttack(attackEvidence({ outcome: "criticalFailure" })).reason, SPELL_ATTACK_FAILURES.NOT_A_HIT);
    assert.equal(validateSpellAttack(attackEvidence({ outcome: null })).reason, SPELL_ATTACK_FAILURES.OUTCOME_MISSING);
    const src = readFileSync(new URL("../scripts/spell-attack-model.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /ac\b|armorClass|vs\s*AC/i);
  });

  it("20-31. transaction id + unique/ambiguous correlation", () => {
    assert.equal(buildSpellAttackTransactionId("atk1"), "nelflow-spell-attack-atk1");
    const a = waitingTx("atkA");
    const b = waitingTx("atkB");
    const unique = correlateSpellAttackDamage([a], damageEvidence());
    assert.equal(unique.ok, true);
    assert.equal(unique.method, "pf2e-structured-spell-attack-unique");

    const ambiguous = correlateSpellAttackDamage([a, b], damageEvidence());
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.reason, SPELL_ATTACK_FAILURES.DAMAGE_AMBIGUOUS);

    assert.equal(
      correlateSpellAttackDamage([a], damageEvidence({ sourceActorUuid: "Actor.other" })).ok,
      false,
    );
    assert.equal(
      correlateSpellAttackDamage([a], damageEvidence({ sourceItemUuid: "Actor.caster.Item.other" })).ok,
      false,
    );
    const src = readFileSync(new URL("../scripts/spell-attack-service.js", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /game\.user\.targets/);
    assert.doesNotMatch(src, /sort\(\s*\(a,\s*b\)\s*=>\s*.*createdAt/);
  });

  it("55-60. actual HP/temp loss derivation", () => {
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 10, tempHp: 5 },
        postApplication: { hp: 10, tempHp: 0 },
      }),
      5,
    );
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 20, tempHp: 10 },
        postApplication: { hp: 5, tempHp: 0 },
      }),
      25,
    );
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 5, tempHp: 0 },
        postApplication: { hp: 0, tempHp: 0 },
      }),
      5,
    );
  });

  it("68-84. presentation protocol payloads + exactly once", () => {
    assert.equal(SPELL_ATTACK_PRESENTATION_PROTOCOL, 1);
    installSpellAttackPresentationFeedApi();
    assert.equal(game.nelflow.integrations.spellAttackPresentation.protocol, 1);

    const rolled = buildSpellAttackDamageRolledPayload({
      transactionId: "nelflow-spell-attack-atk1",
      targetTokenUuid: TOKEN_A,
      rolledTotal: 20,
      formula: "4d4+4",
      outcome: "success",
    });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.payload.damage.total, 20);
    assert.equal(rolled.payload.stage, "damageRolled");

    const applied = buildSpellAttackDamageAppliedPayload({
      transactionId: "nelflow-spell-attack-atk1",
      targetTokenUuid: TOKEN_A,
      applied: 30,
      rolledTotal: 20,
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.payload.damage.applied, 30);

    const e1 = tryEmitSpellAttackDamageRolledPresentation(rolled.payload);
    const e2 = tryEmitSpellAttackDamageRolledPresentation(rolled.payload);
    assert.equal(e1.emitted, true);
    assert.equal(e2.emitted, false);
    assert.equal(e2.reason, "duplicate");

    const a1 = tryEmitSpellAttackDamageAppliedPresentation(applied.payload);
    const a2 = tryEmitSpellAttackDamageAppliedPresentation(applied.payload);
    assert.equal(a1.emitted, true);
    assert.equal(a2.emitted, false);
  });

  it("100-111. mechanical safety contracts", () => {
    const files = [
      "scripts/spell-attack-model.js",
      "scripts/spell-attack-adapter.js",
      "scripts/spell-attack-service.js",
      "scripts/spell-attack-presentation-feed.js",
    ].map((p) => readFileSync(p, "utf8")).join("\n");
    assert.doesNotMatch(files, /closest\(|innerHTML|querySelector.*button|data-action=.spell-damage/);
    assert.doesNotMatch(files, /new\s+Roll\b|Actor\.update|weakness|resistance\s*\*|critRule/);
    assert.doesNotMatch(files, /NelTactics|neltactics|toolbelt\.|ToolbeltTargetHelper/);
  });
});