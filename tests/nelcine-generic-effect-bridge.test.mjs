import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyEffect,
  CLASSIFICATION_SOURCES,
  evaluateGenericEffectItemEligibility,
  lookupEffectKindRegistry,
  NELCINE_EFFECT_KIND_REGISTRY,
  resolveGenericEffectTransactionId,
} from "../scripts/nelcine-effect-classification.js";
import {
  buildEffectPayload,
  clearEffectBridgeState,
  EFFECT_KINDS,
  emitEffectPresentation,
  evaluateEffectPresentationEligibility,
  getEffectIntegrationStatus,
  presentGenericEffectCreate,
  previewResolvedBeneficialEffect,
  previewResolvedHarmfulEffect,
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
              version: settings.nelcineVersion ?? "0.9.1",
            }
          : null,
    },
    nelcine: {
      sync: { isPrimaryGM: () => settings.isPrimaryGM !== false },
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
        if (key === "nelcineGenericEffectCinematics") return true;
        return undefined;
      },
    },
    nelflow: {},
  };
  globalThis.canvas = { scene: { id: "Scene.1" } };
  return { broadcasts };
}

function makeEffectItem(overrides = {}) {
  return {
    id: "eff1",
    uuid: "Actor.a.Item.eff1",
    type: "effect",
    name: "Spell Effect: Heroism",
    img: "icons/heroism.webp",
    pack: null,
    sourceId: "Compendium.pf2e.spell-effects.Item.l9HRQggofFGIxEse",
    system: {
      slug: "spell-effect-heroism",
      context: {
        origin: {
          actor: "Actor.caster",
          token: "Scene.1.Token.caster",
          item: "Actor.caster.Item.spell1",
        },
      },
    },
    flags: { nelflow: {}, pf2e: {} },
    actor: {
      uuid: "Actor.a",
      name: "Narn",
      pack: null,
      getActiveTokens: () => [],
    },
    ...overrides,
  };
}

test.afterEach(() => {
  clearEffectBridgeState();
  delete globalThis.game;
  delete globalThis.canvas;
});

test("1-3. Generic effect setting gates under master; healing/conditions independent", async () => {
  assert.match(source("scripts/constants.js"), /NELCINE_GENERIC_EFFECT_CINEMATICS:\s*"nelcineGenericEffectCinematics"/);
  assert.match(source("scripts/settings.js"), /NELCINE_GENERIC_EFFECT_CINEMATICS[\s\S]*default:\s*true/);
  assert.match(source("lang/en.json"), /Show Buff & Debuff Cinematics/);

  const { broadcasts: b1 } = installMinimalGame({
    settings: { nelcineEffectCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "gen-master-off",
    payload: buildEffectPayload({
      transactionId: "t1",
      effectKind: EFFECT_KINDS.BENEFICIAL,
      action: { name: "Heroism" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b1.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    settings: { nelcineGenericEffectCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "gen-off",
    payload: buildEffectPayload({
      transactionId: "t2",
      effectKind: EFFECT_KINDS.BENEFICIAL,
      action: { name: "Heroism" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b2.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b3 } = installMinimalGame({
    settings: { nelcineGenericEffectCinematics: false },
  });
  await emitEffectPresentation({
    dedupeKey: "heal-still",
    payload: buildEffectPayload({
      transactionId: "t3",
      effectKind: EFFECT_KINDS.HEALING,
      value: 5,
      action: { name: "Heal" },
      target: { actorUuid: "Actor.a" },
    }),
  });
  assert.equal(b3.length, 1);
  assert.equal(b3[0].effectKind, "healing");
});

test("4-13. Classification priority and hard no-guess rules", () => {
  const item = makeEffectItem({
    name: "Totally Evil Curse Name",
    img: "icons/evil.webp",
    sourceId: null,
    system: { slug: "custom-unknown", description: { value: "<p>This is a curse</p>" } },
  });
  assert.equal(classifyEffect(item).supported, false);
  assert.equal(classifyEffect(item).reason, "unsupported-effect");

  const flagged = makeEffectItem({
    flags: { nelflow: { nelcineEffectKind: "harmful" } },
    sourceId: "Compendium.pf2e.spell-effects.Item.l9HRQggofFGIxEse",
  });
  const flagResult = classifyEffect(flagged);
  assert.equal(flagResult.kind, "harmful");
  assert.equal(flagResult.source, CLASSIFICATION_SOURCES.NELFLOW_FLAG);

  const beneficialFlag = makeEffectItem({
    flags: { nelflow: { nelcineEffectKind: "beneficial" } },
    sourceId: null,
    system: { slug: "unknown-slug" },
  });
  assert.equal(classifyEffect(beneficialFlag).kind, "beneficial");

  const invalid = makeEffectItem({
    flags: { nelflow: { nelcineEffectKind: "maybe" } },
  });
  assert.equal(classifyEffect(invalid).supported, false);
  assert.equal(classifyEffect(invalid).reason, "invalid-flag");

  const txWins = classifyEffect(flagged, { transactionKind: "beneficial" });
  assert.equal(txWins.kind, "beneficial");
  assert.equal(txWins.source, CLASSIFICATION_SOURCES.TRANSACTION);

  const registry = lookupEffectKindRegistry(
    makeEffectItem({ flags: { nelflow: {} } }),
  );
  assert.equal(registry.kind, "beneficial");
  assert.equal(classifyEffect(makeEffectItem({ flags: { nelflow: {} } })).source, CLASSIFICATION_SOURCES.REGISTRY);

  const bane = makeEffectItem({
    name: "Spell Effect: Bane",
    sourceId: "Compendium.pf2e.spell-effects.Item.UTLp7omqsiC36bso",
    system: { slug: "spell-effect-bane" },
    flags: { nelflow: {} },
  });
  assert.equal(classifyEffect(bane).kind, "harmful");

  const status = (() => {
    installMinimalGame();
    return getEffectIntegrationStatus();
  })();
  assert.equal(status.classification.pf2eNative, false);
  assert.ok(status.classification.registryEntries > 0);
  assert.ok(Object.keys(NELCINE_EFFECT_KIND_REGISTRY).length >= 10);

  const clf = source("scripts/nelcine-effect-classification.js");
  assert.doesNotMatch(clf, /innerHTML|querySelector|description\.value|item\.name\s*===|toLowerCase\(\).*curse/);
});

test("14-23. Lifecycle create once; filters; delete suppressed", async () => {
  const { broadcasts } = installMinimalGame();
  const item = makeEffectItem();
  const first = await presentGenericEffectCreate(item);
  const second = await presentGenericEffectCreate(item);
  assert.equal(first.emitted, true);
  assert.equal(second.reason, "duplicate-effect");
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].effectKind, "beneficial");
  assert.equal(broadcasts[0].value, null);
  assert.equal(broadcasts[0].action.name, "Spell Effect: Heroism");

  assert.equal(evaluateGenericEffectItemEligibility({ type: "condition" }).eligible, false);
  assert.equal(evaluateGenericEffectItemEligibility({ type: "weapon", actor: {} }).eligible, false);
  assert.equal(
    evaluateGenericEffectItemEligibility(makeEffectItem({ pack: "pf2e.spell-effects" })).reason,
    "compendium",
  );
  assert.equal(
    evaluateGenericEffectItemEligibility(
      makeEffectItem({ flags: { pf2e: { grantedBy: { id: "parent" } }, nelflow: {} } }),
    ).reason,
    "granted-item",
  );
  assert.equal(
    evaluateGenericEffectItemEligibility(
      makeEffectItem({ system: { slug: "aura-bless" }, flags: { nelflow: {} } }),
    ).reason,
    "aura-carrier",
  );

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

  const bridge = source("scripts/nelcine-effect-bridge.js");
  assert.match(bridge, /presentGenericEffectCreate/);
  assert.match(bridge, /Routine deletions\/expirations are not presented/);
  assert.doesNotMatch(bridge, /presentGenericEffectDelete|CONDITION_REMOVE.*effectKind:\s*"harmful"/);
});

test("24-29. Source/payload display-safe", async () => {
  const { broadcasts } = installMinimalGame();
  await presentGenericEffectCreate(makeEffectItem());
  const payload = broadcasts[0];
  assert.equal(payload.source.actorUuid, "Actor.caster");
  assert.equal(payload.target.actorUuid, "Actor.a");
  assert.equal(payload.detail, null);
  assert.equal(payload.value, null);
  assert.equal(payload.condition, null);
  assert.equal(payload.actor, undefined);
  assert.equal(payload.item, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /description|hpBefore|Roll/);

  clearEffectBridgeState();
  const { broadcasts: b2 } = installMinimalGame();
  await presentGenericEffectCreate(
    makeEffectItem({
      system: { slug: "spell-effect-heroism", context: null },
      flags: { nelflow: {}, pf2e: {} },
    }),
  );
  assert.equal(b2[0].source.actorUuid, null);
});

test("30-34. Shared transactionId for one origin; no local effectBatch/debounce", async () => {
  const sharedOrigin = {
    actor: "Actor.caster",
    token: null,
    item: "Actor.caster.Item.spell1",
  };
  const a = makeEffectItem({
    id: "e1",
    uuid: "Actor.t1.Item.e1",
    actor: { uuid: "Actor.t1", name: "A", pack: null, getActiveTokens: () => [] },
    system: { slug: "spell-effect-heroism", context: { origin: sharedOrigin } },
  });
  const b = makeEffectItem({
    id: "e2",
    uuid: "Actor.t2.Item.e2",
    actor: { uuid: "Actor.t2", name: "B", pack: null, getActiveTokens: () => [] },
    system: { slug: "spell-effect-heroism", context: { origin: sharedOrigin } },
  });
  const idA = resolveGenericEffectTransactionId(a);
  const idB = resolveGenericEffectTransactionId(b);
  assert.equal(idA, idB);
  assert.match(idA, /^effect-apply:/);

  const separate = resolveGenericEffectTransactionId(
    makeEffectItem({
      system: {
        slug: "spell-effect-heroism",
        context: { origin: { ...sharedOrigin, item: "Actor.caster.Item.spell2" } },
      },
    }),
  );
  assert.notEqual(separate, idA);

  const uncertain = resolveGenericEffectTransactionId(
    makeEffectItem({
      id: "solo",
      uuid: "Actor.a.Item.solo",
      system: { slug: "spell-effect-heroism", context: null },
      flags: { nelflow: {}, pf2e: {} },
    }),
  );
  assert.match(uncertain, /^effect-create:/);

  const bridge = source("scripts/nelcine-effect-bridge.js");
  assert.doesNotMatch(bridge, /effectBatch|debounce|coalesceEffects/);
  assert.match(bridge, /broadcastEffect/);
});

test("35-37. Authority", async () => {
  const { broadcasts: b1 } = installMinimalGame({ settings: { isPrimaryGM: true } });
  await presentGenericEffectCreate(makeEffectItem());
  assert.equal(b1.length, 1);

  clearEffectBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    userId: "gm2",
    settings: { isPrimaryGM: false },
  });
  await presentGenericEffectCreate(makeEffectItem({ uuid: "Actor.a.Item.eff2", id: "eff2" }));
  assert.equal(b2.length, 0);

  clearEffectBridgeState();
  const { broadcasts: b3 } = installMinimalGame({ isGM: false, userId: "p1" });
  await presentGenericEffectCreate(makeEffectItem({ uuid: "Actor.a.Item.eff3", id: "eff3" }));
  assert.equal(b3.length, 0);
});

test("38-40. Aura noise window vs distinct applications", async () => {
  const { broadcasts } = installMinimalGame();
  const auraOne = makeEffectItem({
    id: "aura1",
    uuid: "Actor.a.Item.aura1",
    flags: {
      nelflow: {},
      pf2e: { aura: { slug: "bless", origin: "Actor.caster", removeOnExit: true } },
    },
  });
  const first = await presentGenericEffectCreate(auraOne);
  assert.equal(first.emitted, true);
  const churn = makeEffectItem({
    id: "aura2",
    uuid: "Actor.a.Item.aura2",
    flags: {
      nelflow: {},
      pf2e: { aura: { slug: "bless", origin: "Actor.caster", removeOnExit: true } },
    },
  });
  const suppressed = await presentGenericEffectCreate(churn);
  assert.equal(suppressed.reason, "noise-suppressed");
  assert.equal(broadcasts.length, 1);

  const otherTarget = makeEffectItem({
    id: "aura3",
    uuid: "Actor.b.Item.aura3",
    actor: { uuid: "Actor.b", name: "Other", pack: null, getActiveTokens: () => [] },
    flags: {
      nelflow: {},
      pf2e: { aura: { slug: "bless", origin: "Actor.caster", removeOnExit: true } },
    },
  });
  const other = await presentGenericEffectCreate(otherTarget);
  assert.equal(other.emitted, true);
  assert.equal(broadcasts.length, 2);
});

test("41-44. NelCine absence and broadcast failure fail open", async () => {
  installMinimalGame({ settings: { nelcineActive: false } });
  const inactive = await presentGenericEffectCreate(makeEffectItem({ uuid: "Actor.a.Item.x1", id: "x1" }));
  assert.equal(inactive.reason, "nelcine-inactive");

  clearEffectBridgeState();
  installMinimalGame();
  delete game.nelcine.integrations.nelflow.broadcastEffect;
  const missing = await presentGenericEffectCreate(makeEffectItem({ uuid: "Actor.a.Item.x2", id: "x2" }));
  assert.equal(missing.reason, "missing-broadcast-api");

  clearEffectBridgeState();
  const { broadcasts } = installMinimalGame({ settings: { broadcastThrows: true } });
  const failed = await presentGenericEffectCreate(makeEffectItem({ uuid: "Actor.a.Item.x3", id: "x3" }));
  assert.equal(failed.reason, "broadcast-failed");
  assert.equal(broadcasts.length, 0);
});

test("45-55. Regression wiring + version 0.14.6 + previews", async () => {
  const main = source("scripts/main.js");
  const bridge = source("scripts/nelcine-effect-bridge.js");
  const strike = source("scripts/nelcine-strike-delivery.js");
  const batchImpact = source("scripts/nelcine-save-batch-impact.js");
  const toolbelt = source("scripts/toolbelt-basic-save-service.js");

  assert.match(main, /registerNelcineEffectHooks/);
  assert.match(bridge, /presentHealingFromDamageTakenMessage/);
  assert.match(bridge, /CONDITION_GAIN/);
  assert.match(bridge, /condition-decrement/);
  assert.match(strike, /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(batchImpact, /nelcine\.saveBatchImpact/);
  assert.match(toolbelt, /tryDelayToolbeltBatchForNelcine/);

  const module = JSON.parse(source("module.json"));
  const pkg = JSON.parse(source("package.json"));
  assert.equal(module.version, "0.14.6");
  assert.equal(pkg.version, "0.14.6");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.14.6/nelflow.zip",
  );

  const { broadcasts } = installMinimalGame();
  await previewResolvedBeneficialEffect({
    transactionId: "preview-ben",
    actionName: "Heroism",
    targetActorUuid: "Actor.t",
  });
  await previewResolvedHarmfulEffect({
    transactionId: "preview-harm",
    actionName: "Bane",
    targetActorUuid: "Actor.t",
  });
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0].effectKind, "beneficial");
  assert.equal(broadcasts[1].effectKind, "harmful");
});
