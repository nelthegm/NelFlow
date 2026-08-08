import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDefeatedPayload,
  clearDefeatedBridgeState,
  DEFEATED_CAUSE_TYPES,
  evaluateNpcDefeatTransition,
  findLethalCauseForTarget,
  isNpcCreatureActor,
  noteLethalApplication,
  noteLethalApplicationIfZeroHp,
  presentNpcDefeatFromCombatant,
  setDefeatedSchedule,
} from "../scripts/nelcine-defeated-bridge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

function installMinimalGame({
  isGM = true,
  userId = "gm1",
  settings = {},
  ready = true,
  combatId = "Combat.1",
} = {}) {
  const broadcasts = [];
  const combat = {
    id: combatId,
    sceneId: "Scene.1",
    combatants: { has: () => true },
  };
  globalThis.game = {
    ready,
    user: { id: userId, isGM },
    users: [{ id: userId, isGM, active: true }],
    combat,
    modules: {
      get: (id) =>
        id === "nelcine"
          ? {
              active: settings.nelcineActive !== false,
              version: settings.nelcineVersion ?? "0.10.2",
            }
          : null,
    },
    nelcine: {
      sync: { isPrimaryGM: () => settings.isPrimaryGM !== false },
      integrations: {
        nelflow: {
          broadcastDefeated: async (payload) => {
            if (settings.broadcastThrows) throw new Error("boom");
            broadcasts.push(payload);
            return payload;
          },
          normalizeDefeated: (payload) => payload,
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
  return { broadcasts, combat };
}

function makeCombatant({
  id = "cbt1",
  type = "npc",
  combatId = "Combat.1",
  actorUuid = "Actor.npc1",
  tokenUuid = "Scene.1.Token.t1",
  name = "Narn",
} = {}) {
  const combat = { id: combatId, sceneId: "Scene.1" };
  const actor = {
    type,
    uuid: actorUuid,
    name,
    img: "icons/npc.webp",
    isOfType: (t) => t === type,
  };
  const token = {
    uuid: tokenUuid,
    name,
    texture: { src: "icons/token.webp" },
    parent: { id: "Scene.1" },
  };
  return {
    id,
    actor,
    token,
    combat,
    parent: combat,
    tokenId: "t1",
  };
}

test.beforeEach(() => {
  setDefeatedSchedule((fn) => {
    fn();
    return 1;
  });
});

test.afterEach(() => {
  clearDefeatedBridgeState();
  setDefeatedSchedule();
  delete globalThis.game;
  delete globalThis.canvas;
});

test("1-3. Defeated setting registered; off suppresses presentation", async () => {
  assert.match(source("scripts/constants.js"), /NELCINE_DEFEATED_CINEMATICS:\s*"nelcineDefeatedCinematics"/);
  assert.match(source("scripts/settings.js"), /NELCINE_DEFEATED_CINEMATICS[\s\S]*default:\s*true/);
  assert.match(source("lang/en.json"), /Show NPC Defeated Cinematics/);

  const { broadcasts } = installMinimalGame({
    settings: { nelcineDefeatedCinematics: false },
  });
  const r = await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(r.reason, "setting-disabled");
  assert.equal(broadcasts.length, 0);
});

test("4-12. Detection eligibility and transitions", async () => {
  installMinimalGame();
  assert.equal(isNpcCreatureActor({ type: "npc", isOfType: (t) => t === "npc" }), true);
  assert.equal(isNpcCreatureActor({ type: "character", isOfType: (t) => t === "character" }), false);

  const ok = evaluateNpcDefeatTransition(makeCombatant(), { defeated: true });
  assert.equal(ok.eligible, true);

  assert.equal(
    evaluateNpcDefeatTransition(makeCombatant(), { defeated: false }).reason,
    "undefeated",
  );
  assert.equal(
    evaluateNpcDefeatTransition(makeCombatant({ type: "character" }), { defeated: true }).reason,
    "player-character",
  );
  assert.equal(
    evaluateNpcDefeatTransition(makeCombatant({ type: "hazard" }), { defeated: true }).reason,
    "non-npc",
  );

  const noCombatGame = installMinimalGame();
  delete game.combat;
  assert.equal(
    evaluateNpcDefeatTransition(makeCombatant(), { defeated: true }).reason,
    "outside-active-combat",
  );
  game.combat = noCombatGame.combat;

  const { broadcasts } = installMinimalGame();
  const first = await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  const second = await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(first.emitted, true);
  assert.equal(second.reason, "duplicate");
  assert.equal(broadcasts.length, 1);

  // undefeated clears eligibility
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: false }, { waitMs: 0 });
  const again = await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(again.emitted, true);
  assert.equal(broadcasts.length, 2);
});

test("13-18. Exact lethal cause correlation", async () => {
  installMinimalGame();
  noteLethalApplication({
    actorUuid: "Actor.npc1",
    tokenUuid: "Scene.1.Token.t1",
    transactionId: "nelflow-atk1",
    causeType: DEFEATED_CAUSE_TYPES.STRIKE,
    postHp: 0,
    sourceActorUuid: "Actor.hero",
    sourceName: "Hero",
  });
  const cause = findLethalCauseForTarget({
    actorUuid: "Actor.npc1",
    tokenUuid: "Scene.1.Token.t1",
  });
  assert.equal(cause.type, "strike");
  assert.equal(cause.transactionId, "nelflow-atk1");

  assert.equal(
    findLethalCauseForTarget({ actorUuid: "Actor.other", tokenUuid: "Scene.1.Token.other" }),
    null,
  );

  assert.equal(
    noteLethalApplicationIfZeroHp({
      actor: { uuid: "Actor.x" },
      token: { uuid: "Token.x" },
      transactionId: "save-1",
      causeType: "save",
      postApplication: { hp: 5 },
    }),
    false,
  );
  assert.equal(
    noteLethalApplicationIfZeroHp({
      actor: { uuid: "Actor.y" },
      token: { uuid: "Token.y" },
      transactionId: "save-2",
      causeType: "save",
      postApplication: { hp: 0 },
    }),
    true,
  );

  const { broadcasts } = installMinimalGame();
  noteLethalApplication({
    actorUuid: "Actor.npc1",
    tokenUuid: "Scene.1.Token.t1",
    transactionId: "nelflow-atk1",
    causeType: "strike",
    postHp: 0,
    sourceActorUuid: "Actor.hero",
    sourceName: "Hero",
  });
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(broadcasts[0].cause.type, "strike");
  assert.equal(broadcasts[0].cause.transactionId, "nelflow-atk1");
  assert.equal(broadcasts[0].source.actorUuid, "Actor.hero");
});

test("19-24. Strike handoff paths do not delay HP (wiring)", () => {
  const strike = source("scripts/strike-resolver.js");
  const defeated = source("scripts/nelcine-defeated-bridge.js");
  assert.match(strike, /noteLethalApplicationIfZeroHp/);
  assert.match(strike, /postApplication[\s\S]*noteLethalApplicationIfZeroHp/);
  assert.match(defeated, /updateCombatant/);
  assert.match(defeated, /broadcastDefeated/);
  assert.doesNotMatch(defeated, /defeatedImpact|await.*applyDamage|actionImpact/);
  assert.match(source("scripts/player-strike-service.js"), /noteLethalApplicationIfZeroHp/);
  assert.match(source("scripts/multi-target-strike-service.js"), /noteLethalApplicationIfZeroHp/);
});

test("25-27. Multi NPC defeats are distinct events", async () => {
  const { broadcasts } = installMinimalGame();
  await presentNpcDefeatFromCombatant(
    makeCombatant({ id: "a", actorUuid: "Actor.a", tokenUuid: "Token.a", name: "A" }),
    { defeated: true },
    { waitMs: 0 },
  );
  await presentNpcDefeatFromCombatant(
    makeCombatant({ id: "b", actorUuid: "Actor.b", tokenUuid: "Token.b", name: "B" }),
    { defeated: true },
    { waitMs: 0 },
  );
  await presentNpcDefeatFromCombatant(
    makeCombatant({ id: "c", actorUuid: "Actor.c", tokenUuid: "Token.c", name: "C" }),
    { defeated: true },
    { waitMs: 0 },
  );
  assert.equal(broadcasts.length, 3);
  assert.equal(new Set(broadcasts.map((b) => b.transactionId)).size, 3);
  assert.doesNotMatch(source("scripts/nelcine-defeated-bridge.js"), /defeatedBatch|coalesceDefeated/);
});

test("28-30. Authority", async () => {
  const { broadcasts: b1 } = installMinimalGame({ settings: { isPrimaryGM: true } });
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(b1.length, 1);

  clearDefeatedBridgeState();
  const { broadcasts: b2 } = installMinimalGame({
    userId: "gm2",
    settings: { isPrimaryGM: false },
  });
  await presentNpcDefeatFromCombatant(makeCombatant({ id: "x2" }), { defeated: true }, { waitMs: 0 });
  assert.equal(b2.length, 0);

  clearDefeatedBridgeState();
  const { broadcasts: b3 } = installMinimalGame({ isGM: false, userId: "p1" });
  await presentNpcDefeatFromCombatant(makeCombatant({ id: "x3" }), { defeated: true }, { waitMs: 0 });
  assert.equal(b3.length, 0);
});

test("31-33. Undo / re-defeat eligibility", async () => {
  const { broadcasts } = installMinimalGame();
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(broadcasts.length, 1);
  // Simulate undo restoring undefeated
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: false }, { waitMs: 0 });
  // Stale duplicate defeated:true without reset already claimed — after undefeated, new defeat works
  await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 });
  assert.equal(broadcasts.length, 2);
});

test("34-39. Payload privacy", () => {
  const payload = buildDefeatedPayload({
    transactionId: "defeated:1",
    target: { actorUuid: "Actor.n", tokenUuid: "Token.n", name: "Narn", img: "x.webp" },
    cause: { type: "strike", transactionId: "nelflow-1" },
  });
  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /"hp"|maxHp|damage|Roll|Combatant/);
  assert.equal(payload.cause.type, "strike");
  assert.equal(payload.source, null);
  assert.ok(payload.target.actorUuid);
});

test("40-43. Failure fails open", async () => {
  installMinimalGame({ settings: { nelcineActive: false } });
  assert.equal(
    (await presentNpcDefeatFromCombatant(makeCombatant(), { defeated: true }, { waitMs: 0 })).reason,
    "nelcine-inactive",
  );

  clearDefeatedBridgeState();
  installMinimalGame();
  delete game.nelcine.integrations.nelflow.broadcastDefeated;
  assert.equal(
    (await presentNpcDefeatFromCombatant(makeCombatant({ id: "m2" }), { defeated: true }, { waitMs: 0 }))
      .reason,
    "missing-broadcast-api",
  );

  clearDefeatedBridgeState();
  const { broadcasts } = installMinimalGame({ settings: { broadcastThrows: true } });
  assert.equal(
    (await presentNpcDefeatFromCombatant(makeCombatant({ id: "m3" }), { defeated: true }, { waitMs: 0 }))
      .reason,
    "broadcast-failed",
  );
  assert.equal(broadcasts.length, 0);
});

test("44-55. Regression wiring + version 0.14.2", () => {
  const main = source("scripts/main.js");
  assert.match(main, /registerNelcineDefeatedHooks/);
  assert.match(source("scripts/nelcine-action-bridge.js"), /broadcastActionResult/);
  assert.match(source("scripts/nelcine-effect-bridge.js"), /action-represented-consequence/);
  assert.match(source("scripts/nelcine-strike-delivery.js"), /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(source("scripts/nelcine-save-batch-impact.js"), /nelcine\.saveBatchImpact/);
  assert.match(source("scripts/toolbelt-basic-save-service.js"), /noteLethalApplicationIfZeroHp/);
  assert.doesNotMatch(source("scripts/nelcine-defeated-bridge.js"), /dying|wounded|unconscious/i);

  const module = JSON.parse(source("module.json"));
  const pkg = JSON.parse(source("package.json"));
  assert.equal(module.version, "0.14.2");
  assert.equal(pkg.version, "0.14.2");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.14.2/nelflow.zip",
  );
});
