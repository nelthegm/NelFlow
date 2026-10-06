/**
 * Shield Block prompt gate for Strike auto-apply (0.14.16).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearShieldBlockGatePending,
  isShieldRaised,
  resolveShieldBlockChooserUserId,
  resolveShieldBlockForApplication,
  SHIELD_BLOCK_SOCKET_ACTION,
} from "../scripts/shield-block-gate.js";
import { SETTINGS } from "../scripts/constants.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

describe("0.14.16 Shield Block prompt gate", () => {
  beforeEach(() => {
    clearShieldBlockGatePending();
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
    globalThis.game = {
      user: { id: "gm1", isGM: true },
      users: {
        get(id) {
          return this._list.find((u) => u.id === id);
        },
        [Symbol.iterator]() {
          return this._list[Symbol.iterator]();
        },
        _list: [
          { id: "gm1", isGM: true, active: true, character: null },
          { id: "p1", isGM: false, active: true, character: { id: "Actor.pc1" } },
        ],
      },
      settings: {
        get(_mod, key) {
          return key === SETTINGS.PROMPT_SHIELD_BLOCK ? true : undefined;
        },
      },
      i18n: {
        localize: (key) => key,
        format: (key, data) => `${key}:${JSON.stringify(data)}`,
      },
      socket: { emits: [], on() {}, emit(_ns, payload) { this.emits.push(payload); } },
    };
    globalThis.ui = { notifications: { info() {} } };
    globalThis.foundry = {
      applications: {
        api: {
          DialogV2: {
            async wait() {
              return "block";
            },
          },
        },
      },
    };
  });

  afterEach(() => {
    clearShieldBlockGatePending();
  });

  it("1. detects raised shield from attributes.shield.raised", () => {
    assert.equal(isShieldRaised({ system: { attributes: { shield: { raised: true } } } }), true);
    assert.equal(isShieldRaised({ system: { attributes: { shield: { raised: false } } } }), false);
    assert.equal(isShieldRaised(null), false);
  });

  it("2. prefers active player OWNER as chooser", () => {
    const token = {
      actor: {
        id: "Actor.pc1",
        ownership: { p1: 3, gm1: 3 },
        name: "Hero",
      },
      name: "Hero",
    };
    assert.equal(resolveShieldBlockChooserUserId(token), "p1");
  });

  it("3. falls back to processing GM for NPC without player owner", () => {
    const token = {
      actor: {
        id: "Actor.npc1",
        ownership: { default: 0, gm1: 3 },
        name: "Guard",
      },
      name: "Guard",
    };
    assert.equal(resolveShieldBlockChooserUserId(token), "gm1");
  });

  it("4. setting off skips prompt", async () => {
    game.settings.get = () => false;
    const result = await resolveShieldBlockForApplication({
      targetToken: {
        name: "Hero",
        actor: { system: { attributes: { shield: { raised: true } } } },
      },
      applicationId: "tx-1",
    });
    assert.equal(result.prompted, false);
    assert.equal(result.block, false);
    assert.equal(result.reason, "setting-off");
  });

  it("5. not raised skips prompt", async () => {
    const result = await resolveShieldBlockForApplication({
      targetToken: {
        name: "Hero",
        actor: { system: { attributes: { shield: { raised: false } } } },
      },
      applicationId: "tx-2",
    });
    assert.equal(result.prompted, false);
    assert.equal(result.block, false);
    assert.equal(result.reason, "shield-not-raised");
  });

  it("6. local chooser Block returns shieldBlockRequest true", async () => {
    const result = await resolveShieldBlockForApplication({
      targetToken: {
        name: "Guard",
        actor: {
          id: "Actor.npc1",
          ownership: { gm1: 3 },
          system: { attributes: { shield: { raised: true } } },
        },
      },
      applicationId: "tx-3",
    });
    assert.equal(result.prompted, true);
    assert.equal(result.block, true);
    assert.equal(result.reason, "user-block");
  });

  it("7. local chooser Apply without blocking returns false", async () => {
    foundry.applications.api.DialogV2.wait = async () => "no-block";
    const result = await resolveShieldBlockForApplication({
      targetToken: {
        name: "Guard",
        actor: {
          ownership: { gm1: 3 },
          system: { attributes: { shield: { raised: true } } },
        },
      },
      applicationId: "tx-4",
    });
    assert.equal(result.block, false);
    assert.equal(result.reason, "user-no-block");
  });

  it("8-11. Strike paths enable prompt; spell/save do not", () => {
    assert.match(source("scripts/pf2e-adapter.js"), /shieldBlockPrompt:\s*true/);
    assert.match(source("scripts/player-strike-service.js"), /shieldBlockPrompt:\s*true/);
    assert.match(source("scripts/multi-target-strike-service.js"), /shieldBlockPrompt:\s*true/);
    assert.match(source("scripts/strike-resolver.js"), /applyDamageToRecordedTarget/);

    const spell = source("scripts/spell-attack-service.js");
    assert.doesNotMatch(spell, /shieldBlockPrompt:\s*true/);
    assert.doesNotMatch(source("scripts/toolbelt-basic-save-service.js"), /shieldBlockPrompt:\s*true/);
    assert.doesNotMatch(source("scripts/save-resolver-service.js"), /shieldBlockPrompt:\s*true/);
  });

  it("12. adapter resolves gate then passes dynamic shieldBlockRequest", () => {
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(adapter, /resolveShieldBlockForApplication/);
    assert.match(adapter, /shieldBlockRequest,/);
    assert.match(adapter, /let shieldBlockRequest = false/);
  });

  it("13. no IWR reimplementation in gate", () => {
    const gate = source("scripts/shield-block-gate.js");
    assert.doesNotMatch(gate, /\bweakness\b|\bresistance\b|\biwr\b/i);
    assert.match(gate, /attributes\?\.shield\?\.raised === true/);
  });

  it("14. main initializes socket gate", () => {
    assert.match(source("scripts/main.js"), /initializeShieldBlockGate/);
  });

  it("15. remote prompt uses socket action", () => {
    assert.equal(SHIELD_BLOCK_SOCKET_ACTION, "shield-block-prompt");
  });

  it("16. version metadata is 0.14.20", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.20");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.20");
  });
});
