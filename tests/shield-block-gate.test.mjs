/**
 * Shield Block gate for Strike auto-apply — defer to PF2e native UI (0.14.22).
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
import { SETTINGS, TRANSACTION_STATES } from "../scripts/constants.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

describe("0.14.22 Shield Block defer-to-native gate", () => {
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
  });

  afterEach(() => {
    clearShieldBlockGatePending();
  });

  it("1. detects raised shield from attributes.shield.raised", () => {
    assert.equal(isShieldRaised({ system: { attributes: { shield: { raised: true } } } }), true);
    assert.equal(isShieldRaised({ system: { attributes: { shield: { raised: false } } } }), false);
    assert.equal(isShieldRaised(null), false);
  });

  it("2. prefers active player OWNER as chooser identity helper", () => {
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

  it("4. setting off skips deferral", async () => {
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
    assert.equal(result.deferToNative, false);
    assert.equal(result.reason, "setting-off");
  });

  it("5. not raised skips deferral", async () => {
    const result = await resolveShieldBlockForApplication({
      targetToken: {
        name: "Hero",
        actor: { system: { attributes: { shield: { raised: false } } } },
      },
      applicationId: "tx-2",
    });
    assert.equal(result.prompted, false);
    assert.equal(result.block, false);
    assert.equal(result.deferToNative, false);
    assert.equal(result.reason, "shield-not-raised");
  });

  it("6. raised shield defers to native PF2e card (no DialogV2)", async () => {
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
    assert.equal(result.prompted, false);
    assert.equal(result.block, false);
    assert.equal(result.deferToNative, true);
    assert.equal(result.reason, "defer-to-native-shield-block");
  });

  it("7. gate source does not open DialogV2 or socket prompts", () => {
    const gate = source("scripts/shield-block-gate.js");
    assert.doesNotMatch(gate, /DialogV2/);
    assert.doesNotMatch(gate, /socket\.emit/);
    assert.match(gate, /deferToNative:\s*true/);
    assert.match(gate, /attributes\?\.shield\?\.raised === true/);
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

  it("12. adapter defers instead of forcing shieldBlockRequest", () => {
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(adapter, /resolveShieldBlockForApplication/);
    assert.match(adapter, /deferToNative/);
    assert.match(adapter, /deferred:\s*true/);
    assert.match(adapter, /observeDeferredMitigationMessage/);
  });

  it("13. no IWR reimplementation in gate", () => {
    const gate = source("scripts/shield-block-gate.js");
    assert.doesNotMatch(gate, /\bweakness\b|\bresistance\b|\biwr\b/i);
  });

  it("14. main initializes shield block gate", () => {
    assert.match(source("scripts/main.js"), /initializeShieldBlockGate/);
  });

  it("15. socket action constant retained for compatibility", () => {
    assert.equal(SHIELD_BLOCK_SOCKET_ACTION, "shield-block-prompt");
  });

  it("16. AWAITING_MITIGATION transaction state exists", () => {
    assert.equal(TRANSACTION_STATES.AWAITING_MITIGATION, "awaiting-mitigation");
  });

  it("17. version metadata is 0.14.22", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.22");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.22");
  });
});
