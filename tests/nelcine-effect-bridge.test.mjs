import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  actualHealingFromAppliedDamage,
  buildEffectPayload,
  claimEffectPresentationKey,
  clearEffectBridgeState,
  conditionDisplayFields,
  EFFECT_KINDS,
  emitEffectPresentation,
  evaluateEffectPresentationEligibility,
  getEffectIntegrationStatus,
  getRecentEffectEvents,
  isPf2eConditionItem,
  presentConditionChange,
  presentConditionValueUpdate,
  presentHealingFromDamageTakenMessage,
  previewResolvedConditionEvent,
  previewResolvedHealingEvent,
} from "../scripts/nelcine-effect-bridge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

function installMinimalGame({
  isGM = true,
  userId = "gm1",
  settings = {},
  ready = true,
} = {}) {
  const broadcasts = [];
  globalThis.game = {
    ready,
    user: { id: userId, isGM },
    users: [{ id: userId, isGM, active: true }],
    modules: {
      get: (id) =>
        id === "nelcine"
          ? {
              active: settings.nelcineActive !== false,
              version: settings.nelcineVersion ?? "0.9.0",
            }
          : null,
    },
    nelcine: {
      sync: {
        isPrimaryGM: () => settings.isPrimaryGM !== false,
      },
      integrations: {
        nelflow: {
          broadcastEffect: async (payload) => {
            if (settings.broadcastThrows) throw new Error("broadcast-boom");
            broadcasts.push(payload);
            return payload;
          },
          normalizeEffect: (payload) => payload,
        },
      },
    },
    settings: {
      get: (ns, key) => {
        if (ns !== "nelflow") return undefined;
        if (key in settings) return settings[key];
        if (key === "nelcineEffectCinematics") return true;
        if (key === "nelcineHealingCinematics") return true;
        if (key === "nelcineConditionCinematics") return true;
        return undefined;
      },
    },
    nelflow: {},
  };
  globalThis.canvas = { scene: { id: "Scene.1" } };
  return { broadcasts };
}

test.afterEach(() => {
  clearEffectBridgeState();
  delete globalThis.game;
  delete globalThis.canvas;
});

// --- SETTINGS ---

test("1-4. Effect cinematic settings registered with defaults true", () => {
  const settingsSrc = source("scripts/settings.js");
  const constants = source("scripts/constants.js");
  const lang = source("lang/en.json");
  assert.match(constants, /NELCINE_EFFECT_CINEMATICS:\s*"nelcineEffectCinematics"/);
  assert.match(constants, /NELCINE_HEALING_CINEMATICS:\s*"nelcineHealingCinematics"/);
  assert.match(constants, /NELCINE_CONDITION_CINEMATICS:\s*"nelcineConditionCinematics"/);
  assert.match(settingsSrc, /NELCINE_EFFECT_CINEMATICS[\s\S]*default:\s*true/);
  assert.match(settingsSrc, /NELCINE_HEALING_CINEMATICS[\s\S]*default:\s*true/);
  assert.match(settingsSrc, /NELCINE_CONDITION_CINEMATICS[\s\S]*default:\s*true/);
  assert.match(lang, /Enable NelCine Healing & Condition Cinematics/);
  assert.match(lang, /Show Healing Cinematics/);
  assert.match(lang, /Show Condition Cinematics/);
});

test("5-7. Master/healing/condition gates suppress independently", async () => {
  const base = {
    gameReady: true,
    masterEnabled: true,
    kindEnabled: true,
    isGM: true,
    isAuthoritativeEmitter: true,
    nelcineActive: true,
    hasBroadcastApi: true,
  };
  assert.equal(evaluateEffectPresentationEligibility(base).eligible, true);
  assert.equal(
    evaluateEffectPresentationEligibility({ ...base, masterEnabled: false }).reason,
    "master-disabled",
  );
  assert.equal(
    evaluateEffectPresentationEligibility({ ...base, kindEnabled: false }).reason,
    "kind-disabled",
  );

  const { broadcasts: b1 } = installMinimalGame({
    settings: { nelcineEffectCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "heal-master-off",
    payload: buildEffectPayload({
      transactionId: "t1",
      effectKind: EFFECT_KINDS.HEALING,
      value: 5,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b1.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    settings: { nelcineHealingCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "heal-kind-off",
    payload: buildEffectPayload({
      transactionId: "t2",
      effectKind: EFFECT_KINDS.HEALING,
      value: 5,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b2.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b3 } = installMinimalGame({
    settings: { nelcineConditionCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "cond-kind-off",
    payload: buildEffectPayload({
      transactionId: "t3",
      effectKind: EFFECT_KINDS.CONDITION_GAIN,
      condition: { slug: "prone", name: "Prone" },
      action: { name: "Prone" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b3.length, 0);
});

// --- NELCINE AVAILABILITY ---

test("8-11. Missing/inactive/incompatible NelCine and broadcast errors fail open", async () => {
  installMinimalGame({ settings: { nelcineActive: false } });
  const inactive = await emitEffectPresentation({
    dedupeKey: "inactive",
    payload: buildEffectPayload({
      transactionId: "x1",
      effectKind: EFFECT_KINDS.HEALING,
      value: 3,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(inactive.reason, "nelcine-inactive");

  clearEffectBridgeState();
  installMinimalGame();
  delete game.nelcine.integrations.nelflow.broadcastEffect;
  const missing = await emitEffectPresentation({
    dedupeKey: "missing-api",
    payload: buildEffectPayload({
      transactionId: "x2",
      effectKind: EFFECT_KINDS.HEALING,
      value: 3,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(missing.reason, "missing-broadcast-api");

  clearEffectBridgeState();
  const { broadcasts } = installMinimalGame({ settings: { broadcastThrows: true } });
  const failed = await emitEffectPresentation({
    dedupeKey: "throw",
    payload: buildEffectPayload({
      transactionId: "x3",
      effectKind: EFFECT_KINDS.HEALING,
      value: 3,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(failed.reason, "broadcast-failed");
  assert.equal(broadcasts.length, 0);
  assert.equal(getRecentEffectEvents()[0].outcome, "failed");
});

// --- HEALING ---

test("12-15. Actual HP gain from appliedDamage; overheal/zero/unknown", () => {
  // 33→50 after heal of 24: difference pre-new = -17
  assert.equal(
    actualHealingFromAppliedDamage({
      isHealing: true,
      updates: [{ path: "system.attributes.hp.value", value: -17 }],
    }),
    17,
  );
  assert.equal(
    actualHealingFromAppliedDamage({
      isHealing: true,
      updates: [{ path: "system.attributes.hp.value", value: -8 }],
    }),
    8,
  );
  assert.equal(
    actualHealingFromAppliedDamage({
      isHealing: true,
      updates: [{ path: "system.attributes.hp.value", value: 0 }],
    }),
    0,
  );
  assert.equal(
    actualHealingFromAppliedDamage({
      isHealing: true,
      updates: [{ path: "system.attributes.hp.temp", value: -5 }],
    }),
    null,
  );
  assert.equal(actualHealingFromAppliedDamage({ isHealing: false, updates: [] }), null);
  assert.equal(actualHealingFromAppliedDamage(null), null);
});

test("16-20. Healing presentation after mechanics, once, with safe action", async () => {
  const { broadcasts } = installMinimalGame();
  const message = {
    id: "msg-heal-1",
    item: { name: "Battle Medicine", img: "icons/heal.webp" },
    flags: {
      pf2e: {
        context: { type: "damage-taken" },
        appliedDamage: {
          uuid: "Actor.target",
          isHealing: true,
          updates: [{ path: "system.attributes.hp.value", value: -12 }],
        },
        origin: { actor: "Actor.source", type: "action", uuid: "Item.x" },
      },
    },
    speaker: {},
    actor: { uuid: "Actor.target", name: "Narn" },
  };
  const first = await presentHealingFromDamageTakenMessage(message);
  const second = await presentHealingFromDamageTakenMessage(message);
  assert.equal(first.emitted, true);
  assert.equal(second.reason, "duplicate");
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].effectKind, "healing");
  assert.equal(broadcasts[0].value, 12);
  assert.equal(broadcasts[0].action.name, "Battle Medicine");
  assert.equal(broadcasts[0].source.actorUuid, "Actor.source");
  assert.equal(broadcasts[0].hpBefore, undefined);
  assert.equal(broadcasts[0].hpAfter, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(broadcasts[0], "roll"), false);

  const zero = await presentHealingFromDamageTakenMessage({
    id: "msg-zero",
    flags: {
      pf2e: {
        context: { type: "damage-taken" },
        appliedDamage: {
          uuid: "Actor.target",
          isHealing: true,
          updates: [{ path: "system.attributes.hp.value", value: 0 }],
        },
      },
    },
  });
  assert.equal(zero.reason, "zero-heal");

  const unknown = await presentHealingFromDamageTakenMessage({
    id: "msg-unknown",
    flags: {
      pf2e: {
        context: { type: "damage-taken" },
        appliedDamage: {
          uuid: "Actor.target",
          isHealing: true,
          updates: [],
        },
      },
    },
  });
  assert.equal(unknown.reason, "unknown-heal-amount");
});

test("17. Unknown source remains null without chat HTML parsing", async () => {
  const bridge = source("scripts/nelcine-effect-bridge.js");
  assert.doesNotMatch(bridge, /innerHTML|querySelector|parseChat|flavor\.match/);
  const { broadcasts } = installMinimalGame();
  await presentHealingFromDamageTakenMessage({
    id: "msg-nosource",
    flags: {
      pf2e: {
        context: { type: "damage-taken" },
        appliedDamage: {
          uuid: "Actor.target",
          isHealing: true,
          updates: [{ path: "system.attributes.hp.value", value: -4 }],
        },
      },
    },
  });
  assert.equal(broadcasts[0].source.actorUuid, null);
  assert.equal(broadcasts[0].action.name, "Heal");
});

// --- CONDITIONS ---

test("21-26. Condition gain valued/unvalued, increase, dedupe", async () => {
  const { broadcasts } = installMinimalGame();
  const valued = {
    id: "c1",
    type: "condition",
    name: "Frightened",
    img: "icons/frightened.webp",
    uuid: "Actor.a.Item.c1",
    system: { slug: "frightened", value: { value: 2 } },
    actor: {
      uuid: "Actor.a",
      name: "Narn",
      pack: null,
      getActiveTokens: () => [],
    },
  };
  assert.equal(isPf2eConditionItem(valued), true);
  assert.deepEqual(conditionDisplayFields(valued), {
    slug: "frightened",
    name: "Frightened",
    img: "icons/frightened.webp",
    value: 2,
  });
  const g1 = await presentConditionChange(valued, EFFECT_KINDS.CONDITION_GAIN, {
    skipActionCorrelation: true,
  });
  const g2 = await presentConditionChange(valued, EFFECT_KINDS.CONDITION_GAIN, {
    skipActionCorrelation: true,
  });
  assert.equal(g1.emitted, true);
  assert.equal(g2.reason, "duplicate");
  assert.equal(broadcasts[0].effectKind, "condition-gain");
  assert.equal(broadcasts[0].condition.value, 2);
  assert.equal(broadcasts[0].condition.slug, "frightened");

  const unvalued = {
    id: "c2",
    type: "condition",
    name: "Prone",
    img: "icons/prone.webp",
    uuid: "Actor.a.Item.c2",
    system: { slug: "prone", value: { value: null } },
    actor: {
      uuid: "Actor.a",
      name: "Narn",
      pack: null,
      getActiveTokens: () => [],
    },
  };
  assert.equal(conditionDisplayFields(unvalued).value, null);
  const g3 = await presentConditionChange(unvalued, EFFECT_KINDS.CONDITION_GAIN, {
    skipActionCorrelation: true,
  });
  assert.equal(g3.emitted, true);
  assert.equal(broadcasts[1].condition.value, null);

  valued.system.value.value = 3;
  const up = await presentConditionValueUpdate(
    valued,
    { system: { value: { value: 3 } } },
    { previousValue: 2, nextValue: 3 },
  );
  assert.equal(up.emitted, true);
  assert.equal(broadcasts[2].condition.value, 3);
});

test("27-29. Valued decrement suppressed; remove only on deletion", async () => {
  const { broadcasts } = installMinimalGame();
  const item = {
    id: "c3",
    type: "condition",
    name: "Frightened",
    uuid: "Actor.a.Item.c3",
    system: { slug: "frightened", value: { value: 2 } },
    actor: {
      uuid: "Actor.a",
      name: "Narn",
      pack: null,
      getActiveTokens: () => [],
    },
  };
  const dec = await presentConditionValueUpdate(
    item,
    { system: { value: { value: 1 } } },
    { previousValue: 2, nextValue: 1 },
  );
  assert.equal(dec.reason, "condition-decrement");
  assert.equal(broadcasts.length, 0);
  assert.equal(getRecentEffectEvents()[0].reason, "condition-decrement");

  const rem = await presentConditionChange(item, EFFECT_KINDS.CONDITION_REMOVE);
  assert.equal(rem.emitted, true);
  assert.equal(broadcasts[0].effectKind, "condition-remove");
  assert.equal(broadcasts[0].condition.value, null);
  assert.equal(broadcasts[0].detail, "removed");
});

test("30-33. Condition remove dedupe and display-safe fields", async () => {
  const { broadcasts } = installMinimalGame();
  const item = {
    id: "c4",
    type: "condition",
    name: "Blinded",
    img: "icons/blinded.webp",
    uuid: "Actor.a.Item.c4",
    system: { slug: "blinded", value: { value: null } },
    actor: {
      uuid: "Actor.a",
      name: "Narn",
      pack: null,
      getActiveTokens: () => [],
    },
  };
  await presentConditionChange(item, EFFECT_KINDS.CONDITION_REMOVE);
  await presentConditionChange(item, EFFECT_KINDS.CONDITION_REMOVE);
  assert.equal(broadcasts.length, 1);
  const payload = broadcasts[0];
  assert.equal(payload.condition.slug, "blinded");
  assert.equal(payload.actor, undefined);
  assert.equal(payload.item, undefined);
});

// --- NOISE ---

test("34-39. Noise guards for init, packs, non-conditions", async () => {
  installMinimalGame({ ready: false });
  assert.equal(
    evaluateEffectPresentationEligibility({
      gameReady: false,
      masterEnabled: true,
      kindEnabled: true,
      isGM: true,
      isAuthoritativeEmitter: true,
      nelcineActive: true,
      hasBroadcastApi: true,
    }).reason,
    "game-not-ready",
  );

  assert.equal(isPf2eConditionItem({ type: "effect", system: { slug: "x" } }), false);
  assert.equal(isPf2eConditionItem({ type: "condition", pack: "pf2e.conditionitems" }), false);

  const { broadcasts } = installMinimalGame();
  const packed = {
    id: "c5",
    type: "condition",
    name: "Hidden",
    uuid: "Compendium.x",
    pack: "pf2e.conditionitems",
    system: { slug: "hidden", value: { value: null } },
    actor: null,
  };
  assert.equal(isPf2eConditionItem(packed), false);
  const r = await presentConditionChange(packed, EFFECT_KINDS.CONDITION_GAIN);
  assert.equal(r.emitted, false);
  assert.equal(broadcasts.length, 0);

  const noActor = {
    id: "c6",
    type: "condition",
    name: "Grabbed",
    uuid: "Actor.a.Item.c6",
    system: { slug: "grabbed", value: { value: null } },
    actor: null,
  };
  assert.equal((await presentConditionChange(noActor, EFFECT_KINDS.CONDITION_GAIN)).reason, "actor-ineligible");
});

// --- AUTHORITY ---

test("40-42. Primary GM emits; secondary GM and players do not", async () => {
  const { broadcasts: b1 } = installMinimalGame({
    settings: { isPrimaryGM: true },
  });
  await emitEffectPresentation({
    dedupeKey: "auth-1",
    payload: buildEffectPayload({
      transactionId: "a1",
      effectKind: EFFECT_KINDS.HEALING,
      value: 2,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b1.length, 1);

  clearEffectBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    userId: "gm2",
    settings: { isPrimaryGM: false },
  });
  await emitEffectPresentation({
    dedupeKey: "auth-2",
    payload: buildEffectPayload({
      transactionId: "a2",
      effectKind: EFFECT_KINDS.HEALING,
      value: 2,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b2.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b3 } = installMinimalGame({ isGM: false, userId: "player1" });
  await emitEffectPresentation({
    dedupeKey: "auth-3",
    payload: buildEffectPayload({
      transactionId: "a3",
      effectKind: EFFECT_KINDS.HEALING,
      value: 2,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b3.length, 0);
});

// --- PRIVACY / PAYLOAD ---

test("43-48. Display-safe payloads only; beneficial kinds not auto-classified", () => {
  const payload = buildEffectPayload({
    transactionId: "safe-1",
    effectKind: EFFECT_KINDS.HEALING,
    value: 9,
    action: { name: "Lay on Hands", img: "icons/x.webp" },
    target: { actorUuid: "Actor.t", tokenUuid: "Token.t" },
    source: { actorUuid: null, tokenUuid: null },
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /hpBefore|hpAfter|maxHp|Actor\.prototype|Roll/);
  assert.equal(payload.value, 9);
  assert.ok(EFFECT_KINDS.BENEFICIAL);
  assert.ok(EFFECT_KINDS.HARMFUL);
  const bridge = source("scripts/nelcine-effect-bridge.js");
  assert.match(bridge, /BENEFICIAL:\s*"beneficial"/);
  assert.match(bridge, /HARMFUL:\s*"harmful"/);
  // Automatic scope is healing + condition only in hooks.
  assert.match(bridge, /presentHealingFromDamageTakenMessage/);
  assert.match(bridge, /CONDITION_GAIN/);
  assert.doesNotMatch(bridge, /autoClassify|isBuff|isDebuff/);
});

test("49-51. Adapter/preview helpers remain presentation-only", async () => {
  const { broadcasts } = installMinimalGame();
  await previewResolvedHealingEvent({
    transactionId: "preview-heal",
    value: 7,
    actionName: "Treat Wounds",
    targetActorUuid: "Actor.t",
  });
  await previewResolvedConditionEvent({
    transactionId: "preview-cond",
    effectKind: "condition-gain",
    slug: "slowed",
    name: "Slowed",
    value: 1,
    targetActorUuid: "Actor.t",
  });
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0].value, 7);
  assert.equal(broadcasts[1].condition.slug, "slowed");
  const zero = await previewResolvedHealingEvent({
    transactionId: "preview-zero",
    value: 0,
  });
  assert.equal(zero.reason, "zero-heal");
});

// --- REGRESSION / WIRING ---

test("52-60. Strike/save-batch untouched; effect bridge wired; version 0.14.12", () => {
  const strike = source("scripts/nelcine-strike-delivery.js");
  const impact = source("scripts/nelcine-impact-bridge.js");
  const batch = source("scripts/nelcine-save-batch-bridge.js");
  const batchImpact = source("scripts/nelcine-save-batch-impact.js");
  const main = source("scripts/main.js");
  const toolbelt = source("scripts/toolbelt-basic-save-service.js");

  assert.match(strike, /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(impact, /nelcine\.strikeImpact/);
  assert.match(batch, /nelflow\.basicSaveBatchResolved/);
  assert.match(batchImpact, /nelcine\.saveBatchImpact/);
  assert.match(main, /registerNelcineEffectHooks/);
  assert.match(main, /installEffectPublicApi/);
  assert.match(toolbelt, /tryDelayToolbeltBatchForNelcine/);

  const module = JSON.parse(source("module.json"));
  const pkg = JSON.parse(source("package.json"));
  assert.equal(module.version, "0.14.12");
  assert.equal(pkg.version, "0.14.12");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.14.12/nelflow.zip",
  );
});

test("dedupe claim marks before broadcast; status diagnostics", async () => {
  const { broadcasts } = installMinimalGame();
  assert.equal(claimEffectPresentationKey("k1"), true);
  assert.equal(claimEffectPresentationKey("k1"), false);
  await emitEffectPresentation({
    dedupeKey: "k2",
    payload: buildEffectPayload({
      transactionId: "diag",
      effectKind: EFFECT_KINDS.HEALING,
      value: 1,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(broadcasts.length, 1);
  const status = getEffectIntegrationStatus();
  assert.equal(status.available, true);
  assert.equal(status.masterEnabled, true);
  assert.equal(status.healingEnabled, true);
  assert.equal(status.conditionsEnabled, true);
  assert.equal(status.nelcineVersion, "0.9.0");
  assert.ok(Array.isArray(getRecentEffectEvents()));
});
