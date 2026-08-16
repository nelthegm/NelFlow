/**
 * 0.14.12 — authoritative healing presentation feed (protocol 1, applied-only).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import {
  HEALING_APPLIED_PRESENTATION_HOOK,
  HEALING_PRESENTATION_PROTOCOL,
  HEALING_SUPPORTED_WORKFLOWS,
  buildHealingAppliedPresentationPayload,
  buildHealingResultId,
  evaluateHealingAppliedPresentationEligibility,
  getHealingPresentationStatus,
  handleHealingPresentationChatMessage,
  hasHealingAppliedPresentationEmission,
  installHealingPresentationFeedApi,
  resetHealingPresentationFeedForTests,
  resolveHealingTargetToken,
  tryEmitHealingAppliedPresentation,
} from "../scripts/healing-presentation-feed.js";
import { actualHealingFromAppliedDamage } from "../scripts/nelcine-effect-bridge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function healingMessage(overrides = {}) {
  const {
    flags: flagOverrides,
    speaker: speakerOverrides,
    ...rest
  } = overrides;
  return {
    id: "msg-heal-1",
    speaker: {
      scene: "s1",
      token: "ally",
      actor: "a1",
      ...speakerOverrides,
    },
    actor: { uuid: "Actor.a1", name: "Ally" },
    item: { name: "Heal", uuid: "Item.heal", img: "icons/heal.webp" },
    flags: {
      pf2e: {
        context: { type: "damage-taken", domains: ["healing-received"], options: [] },
        appliedDamage: {
          uuid: "Actor.a1",
          isHealing: true,
          updates: [{ path: "system.attributes.hp.value", value: -17 }],
        },
        origin: { actor: "Actor.cleric", uuid: "Item.heal", type: "spell" },
        ...(flagOverrides?.pf2e ?? {}),
      },
      ...(flagOverrides
        ? Object.fromEntries(Object.entries(flagOverrides).filter(([k]) => k !== "pf2e"))
        : {}),
    },
    ...rest,
  };
}

describe("0.14.12 healing presentation feed", () => {
  /** @type {object[]} */
  let emitted;

  beforeEach(() => {
    resetHealingPresentationFeedForTests();
    emitted = [];
    globalThis.game = {
      user: { id: "gm1", isGM: true },
      nelflow: { integrations: {}, dev: {} },
    };
    globalThis.canvas = {
      scene: { id: "s1" },
      tokens: {
        placeables: [
          {
            document: { uuid: "Scene.s1.Token.ally", actorId: "a1" },
            uuid: "Scene.s1.Token.ally",
            actor: { id: "a1", uuid: "Actor.a1" },
          },
        ],
      },
    };
    globalThis.Hooks = {
      callAll(hook, payload) {
        emitted.push({ hook, payload });
      },
      on() {},
    };
    installHealingPresentationFeedApi();
  });

  // --- PROTOCOL ---

  it("1-4. protocol 1 applied-only; no applying hook; other integrations unchanged", () => {
    assert.equal(HEALING_PRESENTATION_PROTOCOL, 1);
    const api = game.nelflow.integrations.healingPresentation;
    assert.equal(api.protocol, 1);
    assert.equal(api.appliedHook, HEALING_APPLIED_PRESENTATION_HOOK);
    assert.equal(api.stages.applied, true);
    assert.equal(api.stages.applying, false);
    assert.equal(Object.prototype.hasOwnProperty.call(api, "applyingHook"), false);
    const status = getHealingPresentationStatus();
    assert.equal(status.applyingHook, null);
    assert.equal(status.tempHpIncluded, false);
    assert.ok(status.supportedWorkflows.includes("pf2e-chat-apply-healing"));

    // Contract files still declare Strike 4 / basic-save 3.
    assert.match(source("scripts/strike-presentation-feed.js"), /STRIKE_PRESENTATION_FEED_PROTOCOL\s*=\s*4/);
    assert.match(
      source("scripts/basic-save-presentation-feed.js"),
      /BASIC_SAVE_PRESENTATION_PROTOCOL\s*=\s*3/,
    );
    assert.match(source("scripts/damage-applied-bridge.js"), /DAMAGE_APPLIED_HOOK/);
  });

  // --- IDENTITY ---

  it("5-8. exact target + deterministic healingResultId shared by applied stage", () => {
    const id = buildHealingResultId({
      messageId: "msg-heal-1",
      targetTokenUuid: "Scene.s1.Token.ally",
    });
    assert.equal(id, "healing:msg-heal-1:Scene.s1.Token.ally");
    const other = buildHealingResultId({
      messageId: "msg-heal-1",
      targetTokenUuid: "Scene.s1.Token.b",
    });
    assert.notEqual(id, other);

    const token = resolveHealingTargetToken(healingMessage());
    assert.equal(token.tokenUuid, "Scene.s1.Token.ally");
    assert.equal(token.reason, "speaker-token");
  });

  // --- ACTUAL HEALING ---

  it("9-13. overheal / full / authority from appliedDamage updates only", () => {
    // rolled conceptually 30, missing 10 → appliedDamage delta -10
    assert.equal(
      actualHealingFromAppliedDamage({
        isHealing: true,
        updates: [{ path: "system.attributes.hp.value", value: -10 }],
      }),
      10,
    );
    assert.equal(
      actualHealingFromAppliedDamage({
        isHealing: true,
        updates: [{ path: "system.attributes.hp.value", value: -30 }],
      }),
      30,
    );
    assert.equal(
      actualHealingFromAppliedDamage({
        isHealing: true,
        updates: [{ path: "system.attributes.hp.value", value: 0 }],
      }),
      0,
    );

    const built = buildHealingAppliedPresentationPayload({
      messageId: "m1",
      targetTokenUuid: "Scene.s1.Token.ally",
      applied: 10,
      rolledTotal: 30,
    });
    assert.equal(built.ok, true);
    assert.equal(built.payload.healing.applied, 10);
    assert.equal(built.payload.healing.rolledTotal, 30);
    assert.ok(built.payload.healing.applied <= 30);
  });

  it("14-17. no HTML parsing / no max-HP invention in feed source", () => {
    const feed = source("scripts/healing-presentation-feed.js");
    assert.doesNotMatch(feed, /innerHTML|querySelector|outerHTML|textContent/);
    assert.doesNotMatch(feed, /hitPoints\.max|attributes\.hp\.max/);
    assert.doesNotMatch(feed, /Actor\.update|actor\.update|new\s+Roll/);
    assert.match(feed, /actualHealingFromAppliedDamage/);
  });

  // --- TEMP HP ---

  it("18-19. temp HP grant is not normal healing.applied", () => {
    assert.equal(
      actualHealingFromAppliedDamage({
        isHealing: true,
        updates: [{ path: "system.attributes.hp.temp", value: -5 }],
      }),
      null,
    );
    const result = handleHealingPresentationChatMessage(
      healingMessage({
        flags: {
          pf2e: {
            context: { type: "damage-taken" },
            appliedDamage: {
              uuid: "Actor.a1",
              isHealing: true,
              updates: [{ path: "system.attributes.hp.temp", value: -5 }],
            },
          },
        },
      }),
    );
    assert.equal(result.emitted, false);
    assert.equal(result.reason, "no-normal-hp-restoration");
  });

  // --- MULTI-TARGET / EXACTLY ONCE ---

  it("20-22 / 28-30. multi-target independent; exactly once registries", () => {
    const a = handleHealingPresentationChatMessage(healingMessage({ id: "msg-a" }));
    const b = handleHealingPresentationChatMessage(
      healingMessage({
        id: "msg-b",
        speaker: { scene: "s1", token: "ally2", actor: "a2" },
        flags: {
          pf2e: {
            context: { type: "damage-taken" },
            appliedDamage: {
              uuid: "Actor.a2",
              isHealing: true,
              updates: [{ path: "system.attributes.hp.value", value: -30 }],
            },
          },
        },
      }),
    );
    // Second token not on canvas with speaker — still uses speaker uuid construction.
    assert.equal(a.emitted, true);
    assert.equal(a.payload.healing.applied, 17);
    assert.equal(b.emitted, true);
    assert.equal(b.payload.healing.applied, 30);
    assert.notEqual(a.healingResultId, b.healingResultId);

    const dup = handleHealingPresentationChatMessage(healingMessage({ id: "msg-a" }));
    assert.equal(dup.emitted, false);
    assert.equal(dup.reason, "already-emitted");
    assert.equal(emitted.length, 2);
    assert.ok(hasHealingAppliedPresentationEmission(a.healingResultId));
  });

  // --- TIMING / FAILURE ---

  it("23-27. applied after authoritative flag; failed gate emits nothing", () => {
    // No applying stage exists — gate rejects missing applied.
    const gate = evaluateHealingAppliedPresentationEligibility({
      isGM: true,
      healingResultId: "x",
      isHealingTaken: true,
      targetTokenUuid: "Scene.s1.Token.ally",
      applied: null,
    });
    assert.equal(gate.eligible, false);

    const failApp = tryEmitHealingAppliedPresentation({
      messageId: "fail",
      targetTokenUuid: "Scene.s1.Token.ally",
      applied: undefined,
      isHealingTaken: true,
    });
    assert.equal(failApp.emitted, false);
  });

  // --- EXCLUSIONS ---

  it("31-34. manual HP / non-healing / damage-taken damage emit none", () => {
    assert.equal(
      handleHealingPresentationChatMessage({
        id: "manual",
        flags: {},
      }).reason,
      "not-healing-taken",
    );
    assert.equal(
      handleHealingPresentationChatMessage(
        healingMessage({
          flags: {
            pf2e: {
              context: { type: "damage-taken" },
              appliedDamage: {
                uuid: "Actor.a1",
                isHealing: false,
                updates: [{ path: "system.attributes.hp.value", value: 12 }],
              },
            },
          },
        }),
      ).reason,
      "not-healing-taken",
    );
  });

  it("35-37. privacy / token ambiguity", () => {
    game.user.isGM = false;
    assert.equal(handleHealingPresentationChatMessage(healingMessage()).reason, "not-gm");

    game.user.isGM = true;
    canvas.tokens.placeables.push({
      document: { uuid: "Scene.s1.Token.ally-b", actorId: "a1" },
      uuid: "Scene.s1.Token.ally-b",
      actor: { id: "a1", uuid: "Actor.a1" },
    });
    const ambiguous = resolveHealingTargetToken({
      speaker: { scene: "s1", actor: "a1" },
      flags: { pf2e: { appliedDamage: { uuid: "Actor.a1" } } },
    }, "Actor.a1");
    // Without speaker token, unique-actor path sees two tokens.
    assert.equal(ambiguous.tokenUuid, null);
    assert.equal(ambiguous.reason, "ambiguous-actor-tokens");
  });

  // --- REGRESSION CONTRACTS ---

  it("38-50. mechanical + Strike/save/NelZones regression contracts", () => {
    const feed = source("scripts/healing-presentation-feed.js");
    assert.doesNotMatch(feed, /game\.socket|socket\.emit/);
    assert.doesNotMatch(feed, /prototype\.applyDamage|Actor\.prototype/);
    assert.match(
      source("scripts/damage-applied-bridge.js"),
      /if \(!appliedDamage \|\| appliedDamage\.isHealing\) return null/,
    );
    assert.equal(HEALING_SUPPORTED_WORKFLOWS.length > 0, true);

    const zero = handleHealingPresentationChatMessage(
      healingMessage({
        id: "msg-zero",
        flags: {
          pf2e: {
            context: { type: "damage-taken" },
            appliedDamage: {
              uuid: "Actor.a1",
              isHealing: true,
              updates: [{ path: "system.attributes.hp.value", value: 0 }],
            },
          },
        },
      }),
    );
    assert.equal(zero.emitted, true);
    assert.equal(zero.payload.healing.applied, 0);

    assert.equal(game.nelflow.dev.getHealingPresentationStatus().protocol, 1);
    assert.equal(typeof game.nelflow.dev.watchHealingPresentationFeed, "function");
  });

  it("metadata version 0.14.12", () => {
    const manifest = JSON.parse(source("module.json"));
    assert.equal(manifest.version, "0.14.12");
    assert.match(manifest.download, /v0\.14\.12\/nelflow\.zip/);
  });
});
