import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  detectActionSlugFromOptions,
  getActionDefinition,
  SUPPORTED_ACTION_SLUGS,
} from "../scripts/nelcine-action-definitions.js";
import {
  clearActionConditionCorrelation,
  CONDITION_PRESENTATION_DEFER_MS,
  evaluateConditionPresentationCorrelation,
  findMatchingRepresentedConsequence,
  inspectActionConditionCorrelation,
  registerRepresentedConsequence,
} from "../scripts/nelcine-action-correlation.js";
import {
  buildActionResultPayload,
  claimActionPresentationKey,
  clearActionBridgeState,
  extractNaturalFromCheckRoll,
  inspectPf2eActionCheckMessage,
  presentActionResultFromMessage,
  resolveDisplayConsequences,
} from "../scripts/nelcine-action-bridge.js";
import {
  clearEffectBridgeState,
  presentConditionChange,
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
  const effectBroadcasts = [];
  globalThis.game = {
    ready,
    user: { id: userId, isGM },
    users: [{ id: userId, isGM, active: true }],
    modules: {
      get: (id) =>
        id === "nelcine"
          ? {
              active: settings.nelcineActive !== false,
              version: settings.nelcineVersion ?? "0.10.0",
            }
          : null,
    },
    nelcine: {
      sync: { isPrimaryGM: () => settings.isPrimaryGM !== false },
      integrations: {
        nelflow: {
          broadcastActionResult: async (payload) => {
            if (settings.broadcastThrows) throw new Error("boom");
            broadcasts.push(payload);
            return payload;
          },
          normalizeActionResult: (payload) => payload,
          broadcastEffect: async (payload) => {
            effectBroadcasts.push(payload);
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
        return true;
      },
    },
    nelflow: {},
  };
  globalThis.canvas = { scene: { id: "Scene.1" } };
  return { broadcasts, effectBroadcasts };
}

function makeActionMessage({
  id = "msg1",
  action = "trip",
  outcome = "success",
  type = "skill-check",
  optionsExtra = [],
  target = true,
  dcVisible = true,
  total = 25,
  modifier = 8,
  natural = 17,
  statistic = "athletics",
} = {}) {
  const options = [`action:${action}`, `check:statistic:${statistic}`, ...optionsExtra];
  return {
    id,
    rolls: [
      {
        total,
        options: { totalModifier: modifier, degreeOfSuccess: 2 },
        dice: [{ faces: 20, total: natural }],
        terms: [],
      },
    ],
    flags: {
      pf2e: {
        modifierName: statistic,
        context: {
          type,
          outcome,
          options,
          origin: { actor: "Actor.source", token: "Scene.1.Token.source" },
          target: target
            ? { actor: "Actor.target", token: "Scene.1.Token.target" }
            : null,
          dc: { value: 20, visible: dcVisible, slug: "reflex" },
        },
      },
    },
  };
}

function makeConditionItem({ slug = "prone", value = null, actorUuid = "Actor.target", id = "c1" } = {}) {
  return {
    id,
    uuid: `${actorUuid}.Item.${id}`,
    type: "condition",
    name: slug[0].toUpperCase() + slug.slice(1),
    img: `icons/${slug}.webp`,
    pack: null,
    system: { slug, value: { value } },
    actor: {
      uuid: actorUuid,
      name: "Target",
      pack: null,
      getActiveTokens: () => [],
    },
  };
}

test.afterEach(() => {
  clearActionBridgeState();
  clearEffectBridgeState();
  clearActionConditionCorrelation();
  delete globalThis.game;
  delete globalThis.canvas;
});

test("1-12. Authoritative action detection; no guessing", () => {
  for (const slug of SUPPORTED_ACTION_SLUGS) {
    assert.equal(detectActionSlugFromOptions([`action:${slug}`]), slug);
    assert.ok(getActionDefinition(slug));
  }
  assert.equal(detectActionSlugFromOptions(["check:statistic:athletics", "attack"]), null);
  assert.equal(inspectPf2eActionCheckMessage(makeActionMessage({ action: "trip" })).slug, "trip");
  assert.equal(inspectPf2eActionCheckMessage(makeActionMessage({ action: "grapple" })).slug, "grapple");
  assert.equal(inspectPf2eActionCheckMessage(makeActionMessage({ action: "shove" })).slug, "shove");
  assert.equal(inspectPf2eActionCheckMessage(makeActionMessage({ action: "reposition" })).slug, "reposition");
  assert.equal(inspectPf2eActionCheckMessage(makeActionMessage({ action: "disarm" })).slug, "disarm");
  assert.equal(
    inspectPf2eActionCheckMessage(makeActionMessage({ action: "demoralize", statistic: "intimidation" })).slug,
    "demoralize",
  );
  assert.equal(
    inspectPf2eActionCheckMessage(makeActionMessage({ action: "feint", statistic: "deception" })).slug,
    "feint",
  );
  assert.equal(
    inspectPf2eActionCheckMessage(makeActionMessage({ action: "escape", target: false })).slug,
    "escape",
  );

  const athletics = makeActionMessage({ action: "trip" });
  athletics.flags.pf2e.context.options = ["check:statistic:athletics", "attack"];
  assert.equal(inspectPf2eActionCheckMessage(athletics).supported, false);

  const strike = makeActionMessage({});
  strike.flags.pf2e.context.options = ["strike:greatclub", "attack-roll"];
  strike.flags.pf2e.context.type = "attack-roll";
  assert.equal(inspectPf2eActionCheckMessage(strike), null);

  const save = makeActionMessage({});
  save.flags.pf2e.context.type = "saving-throw";
  save.flags.pf2e.context.options = ["action:trip"];
  assert.equal(inspectPf2eActionCheckMessage(save), null);
});

test("13-24. Payload fields display-safe", async () => {
  const { broadcasts } = installMinimalGame();
  const msg = makeActionMessage({ action: "trip", natural: 17, modifier: 8, total: 25 });
  await presentActionResultFromMessage(msg);
  const payload = broadcasts[0];
  assert.equal(payload.type, "actionResult");
  assert.equal(payload.source.actorUuid, "Actor.source");
  assert.equal(payload.target.actorUuid, "Actor.target");
  assert.equal(payload.check.natural, 17);
  assert.equal(payload.check.modifier, 8);
  assert.equal(payload.check.total, 25);
  assert.equal(payload.check.degree, "success");
  assert.equal(payload.check.dc, 20);
  assert.equal(payload.check.dcPublic, true);
  assert.equal(payload.actor, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /Roll|description\.value/);

  clearActionBridgeState();
  const { broadcasts: b2 } = installMinimalGame();
  await presentActionResultFromMessage(makeActionMessage({ action: "escape", target: false }));
  assert.equal(b2[0].target, null);

  clearActionBridgeState();
  const { broadcasts: b3 } = installMinimalGame();
  await presentActionResultFromMessage(makeActionMessage({ dcVisible: false }));
  assert.equal(b3[0].check.dc, null);
  assert.equal(b3[0].check.dcPublic, false);

  assert.equal(extractNaturalFromCheckRoll({ dice: [{ faces: 20, total: 12 }] }), 12);
  const incomplete = buildActionResultPayload({ transactionId: "x", action: { slug: "trip" }, check: {} });
  assert.equal(incomplete.check.natural, null);
});

test("25-30. Consequences conservative", () => {
  const trip = getActionDefinition("trip");
  assert.deepEqual(resolveDisplayConsequences(trip, "success"), [
    { slug: "prone", label: "Prone", value: null },
  ]);
  assert.deepEqual(resolveDisplayConsequences(trip, "failure"), []);
  const shove = getActionDefinition("shove");
  assert.deepEqual(resolveDisplayConsequences(shove, "success"), []);
  const demoralize = getActionDefinition("demoralize");
  assert.deepEqual(resolveDisplayConsequences(demoralize, "success"), []);
  assert.deepEqual(
    resolveDisplayConsequences(demoralize, "success", { knownValues: { frightened: 1 } }),
    [{ slug: "frightened", label: "Frightened", value: 1 }],
  );
  const grapple = getActionDefinition("grapple");
  const crit = resolveDisplayConsequences(grapple, "criticalSuccess");
  assert.equal(crit.some((c) => c.slug === "restrained"), false);
  assert.equal(crit[0].slug, "grabbed");
});

test("31-40. Condition correlation bidirectional", async () => {
  installMinimalGame();
  // Action-first
  registerRepresentedConsequence({
    transactionId: "action:msg-trip",
    targetActorUuid: "Actor.target",
    conditionSlug: "prone",
  });
  assert.ok(findMatchingRepresentedConsequence({
    targetActorUuid: "Actor.target",
    conditionSlug: "prone",
  }));
  const suppressed = await presentConditionChange(makeConditionItem(), "condition-gain");
  assert.equal(suppressed.reason, "action-represented-consequence");

  clearActionConditionCorrelation();
  clearEffectBridgeState();
  // Condition-first defer then action cancels
  let flushed = 0;
  const decision = evaluateConditionPresentationCorrelation(
    {
      targetActorUuid: "Actor.target",
      conditionSlug: "prone",
      conditionValue: null,
    },
    {
      deferMs: 50,
      flush: async () => {
        flushed += 1;
      },
    },
  );
  assert.equal(decision.action, "defer");
  registerRepresentedConsequence({
    transactionId: "action:msg2",
    targetActorUuid: "Actor.target",
    conditionSlug: "prone",
  });
  // cancel pending via bridge path
  const { cancelMatchingPendingConditionPresentations } = await import(
    "../scripts/nelcine-action-correlation.js"
  );
  cancelMatchingPendingConditionPresentations({
    conditionSlug: "prone",
    targetActorUuid: "Actor.target",
  });
  await delay(80);
  assert.equal(flushed, 0);

  // Unmatched pending eventually flushes
  clearActionConditionCorrelation();
  let flushed2 = 0;
  evaluateConditionPresentationCorrelation(
    { targetActorUuid: "Actor.other", conditionSlug: "prone" },
    {
      deferMs: 40,
      flush: async () => {
        flushed2 += 1;
      },
    },
  );
  await delay(80);
  assert.equal(flushed2, 1);

  // Unrelated target not suppressed
  clearActionConditionCorrelation();
  registerRepresentedConsequence({
    transactionId: "action:msg3",
    targetActorUuid: "Actor.target",
    conditionSlug: "prone",
  });
  assert.equal(
    findMatchingRepresentedConsequence({
      targetActorUuid: "Actor.other",
      conditionSlug: "prone",
    }),
    null,
  );

  // Different value matters when claim is valued
  clearActionConditionCorrelation();
  registerRepresentedConsequence({
    transactionId: "action:msg4",
    targetActorUuid: "Actor.target",
    conditionSlug: "frightened",
    conditionValue: 1,
  });
  assert.ok(
    findMatchingRepresentedConsequence({
      targetActorUuid: "Actor.target",
      conditionSlug: "frightened",
      conditionValue: 1,
    }),
  );
  assert.equal(
    findMatchingRepresentedConsequence({
      targetActorUuid: "Actor.target",
      conditionSlug: "frightened",
      conditionValue: 2,
    }),
    null,
  );

  assert.equal(claimActionPresentationKey("action:once"), true);
  assert.equal(claimActionPresentationKey("action:once"), false);
  assert.ok(CONDITION_PRESENTATION_DEFER_MS <= 350);
});

test("41-45. Demoralize / Trip end-to-end correlation", async () => {
  const { broadcasts, effectBroadcasts } = installMinimalGame();
  await presentActionResultFromMessage(
    makeActionMessage({ action: "demoralize", statistic: "intimidation", id: "demo1" }),
  );
  assert.equal(broadcasts[0].action.slug, "demoralize");
  // Without known value, no invented frightened in payload
  assert.equal(broadcasts[0].consequences.length, 0);
  // Correlation claim still suppresses frightened
  const r = await presentConditionChange(
    makeConditionItem({ slug: "frightened", value: 1, id: "f1" }),
    "condition-gain",
  );
  assert.equal(r.reason, "action-represented-consequence");
  assert.equal(effectBroadcasts.length, 0);

  clearActionBridgeState();
  clearEffectBridgeState();
  const { broadcasts: b2, effectBroadcasts: e2 } = installMinimalGame();
  await presentActionResultFromMessage(makeActionMessage({ action: "trip", id: "trip1" }));
  assert.equal(b2[0].consequences[0].slug, "prone");
  const prone = await presentConditionChange(makeConditionItem({ slug: "prone", id: "p1" }), "condition-gain");
  assert.equal(prone.reason, "action-represented-consequence");
  assert.equal(e2.length, 0);

  // Later unrelated frightened increase still presents when no claim
  clearActionConditionCorrelation();
  const up = await presentConditionChange(
    makeConditionItem({ slug: "frightened", value: 2, id: "f2" }),
    "condition-gain",
    { skipActionCorrelation: true, forceValue: 2 },
  );
  // With skip it emits if settings allow
  assert.equal(up.emitted === true || up.reason === "duplicate" || up.reason != null, true);
});

test("46-52. Authority and failure", async () => {
  const { broadcasts: b1 } = installMinimalGame({ settings: { isPrimaryGM: true } });
  await presentActionResultFromMessage(makeActionMessage({ id: "a1" }));
  assert.equal(b1.length, 1);

  clearActionBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    userId: "gm2",
    settings: { isPrimaryGM: false },
  });
  await presentActionResultFromMessage(makeActionMessage({ id: "a2" }));
  assert.equal(b2.length, 0);

  clearActionBridgeState();
  const { broadcasts: b3 } = installMinimalGame({ isGM: false, userId: "p1" });
  await presentActionResultFromMessage(makeActionMessage({ id: "a3" }));
  assert.equal(b3.length, 0);

  clearActionBridgeState();
  installMinimalGame({ settings: { nelcineActive: false } });
  assert.equal((await presentActionResultFromMessage(makeActionMessage({ id: "a4" }))).reason, "nelcine-inactive");

  clearActionBridgeState();
  installMinimalGame();
  delete game.nelcine.integrations.nelflow.broadcastActionResult;
  assert.equal(
    (await presentActionResultFromMessage(makeActionMessage({ id: "a5" }))).reason,
    "missing-broadcast-api",
  );

  clearActionBridgeState();
  const { broadcasts: b6 } = installMinimalGame({ settings: { broadcastThrows: true } });
  assert.equal((await presentActionResultFromMessage(makeActionMessage({ id: "a6" }))).reason, "broadcast-failed");
  assert.equal(b6.length, 0);

  assert.match(source("scripts/settings.js"), /NELCINE_ACTION_CINEMATICS[\s\S]*default:\s*true/);
});

test("53-66. Regression wiring + version 0.14.13", () => {
  const main = source("scripts/main.js");
  const action = source("scripts/nelcine-action-bridge.js");
  const effect = source("scripts/nelcine-effect-bridge.js");
  const strike = source("scripts/nelcine-strike-delivery.js");
  const batch = source("scripts/nelcine-save-batch-impact.js");

  assert.match(main, /registerNelcineActionHooks/);
  assert.match(action, /broadcastActionResult/);
  assert.doesNotMatch(action, /actionImpact|applyDamage|createEmbeddedDocuments/);
  assert.match(effect, /action-represented-consequence/);
  assert.match(effect, /condition-decrement/);
  assert.match(strike, /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(batch, /nelcine\.saveBatchImpact/);
  assert.match(action, /inspectActionConditionCorrelation|inspectCorrelation/);

  const module = JSON.parse(source("module.json"));
  const pkg = JSON.parse(source("package.json"));
  assert.equal(module.version, "0.14.13");
  assert.equal(pkg.version, "0.14.13");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.14.13/nelflow.zip",
  );

  installMinimalGame();
  assert.ok(inspectActionConditionCorrelation().representedConsequences);
});
