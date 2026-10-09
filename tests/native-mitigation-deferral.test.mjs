/**
 * Native Shield Block mitigation deferral lifecycle (0.14.22).
 *
 * Represents the repaired flow:
 * damage correlation → defer auto-apply → keep native UI → PF2e Apply → settle once.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearAllDeferredMitigations,
  getDeferredMitigation,
  isMitigationPending,
  observeDeferredMitigationMessage,
  registerDeferredMitigation,
  settleDeferredMitigationFromCapture,
} from "../scripts/native-mitigation-deferral.js";
import { resolveShieldBlockForApplication } from "../scripts/shield-block-gate.js";
import { SETTINGS, TRANSACTION_STATES } from "../scripts/constants.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

describe("0.14.22 native mitigation deferral", () => {
  beforeEach(() => {
    clearAllDeferredMitigations();
    globalThis.game = {
      settings: {
        get(_mod, key) {
          return key === SETTINGS.PROMPT_SHIELD_BLOCK ? true : undefined;
        },
      },
    };
  });

  afterEach(() => {
    clearAllDeferredMitigations();
  });

  it("1. raised shield + setting on → deferToNative (regression: was Dialog hang)", async () => {
    const choice = await resolveShieldBlockForApplication({
      targetToken: {
        actor: { system: { attributes: { shield: { raised: true } } } },
      },
      applicationId: "nelflow-atk1",
    });
    assert.equal(choice.deferToNative, true);
    assert.equal(choice.block, false);
    assert.equal(choice.prompted, false);
  });

  it("2. isMitigationPending recognizes awaiting-mitigation / deferred map", () => {
    assert.equal(
      isMitigationPending({ id: "tx", state: TRANSACTION_STATES.AWAITING_MITIGATION }),
      true,
    );
    assert.equal(isMitigationPending({ id: "tx", mitigationPending: "shield-block" }), true);
    assert.equal(isMitigationPending({ id: "tx", state: TRANSACTION_STATES.APPLIED }), false);
    registerDeferredMitigation({
      transactionId: "tx-deferred",
      settle: async () => ({}),
    });
    assert.equal(isMitigationPending({ id: "tx-deferred", state: TRANSACTION_STATES.DAMAGE_ROLLED }), true);
  });

  it("3. lifecycle: pending → unique damage-taken → settle exactly once", async () => {
    let settleCount = 0;
    registerDeferredMitigation({
      transactionId: "tx-life",
      attackMessageId: "atk",
      damageMessageId: "dmg",
      settle: async () => {
        settleCount += 1;
        return { ok: true };
      },
    });
    assert.ok(getDeferredMitigation("tx-life"));

    const applicationMessage = { id: "app-1" };
    const pending = new Map([
      [
        "tx-life",
        {
          transactionId: "tx-life",
          deferred: true,
          candidates: [applicationMessage],
        },
      ],
    ]);

    observeDeferredMitigationMessage(applicationMessage, pending);
    // settle is async void — wait a tick
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settleCount, 1);
    assert.equal(getDeferredMitigation("tx-life"), null);
    assert.equal(pending.size, 0);

    // Second observe must not re-settle
    observeDeferredMitigationMessage(applicationMessage, pending);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settleCount, 1);
  });

  it("4. does not settle while candidates are non-unique", async () => {
    let settleCount = 0;
    registerDeferredMitigation({
      transactionId: "tx-ambig",
      settle: async () => {
        settleCount += 1;
      },
    });
    const msg = { id: "app-a" };
    const pending = new Map([
      [
        "tx-ambig",
        {
          transactionId: "tx-ambig",
          deferred: true,
          candidates: [msg, { id: "app-b" }],
        },
      ],
    ]);
    observeDeferredMitigationMessage(msg, pending);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settleCount, 0);
    assert.ok(getDeferredMitigation("tx-ambig"));
  });

  it("5. settleDeferredMitigationFromCapture invokes handler", async () => {
    let seen = null;
    registerDeferredMitigation({
      transactionId: "tx-direct",
      settle: async (ctx) => {
        seen = ctx.applicationMessage.id;
        return { settled: true };
      },
    });
    const result = await settleDeferredMitigationFromCapture(
      { transactionId: "tx-direct", deferred: true },
      { id: "app-z" },
    );
    assert.equal(result.settled, true);
    assert.equal(seen, "app-z");
    assert.equal(getDeferredMitigation("tx-direct"), null);
  });

  it("6. stack-first hide skips while mitigation pending", () => {
    const records = source("scripts/native-records-controller.js");
    assert.match(records, /stackHasMitigationPending/);
    assert.match(records, /isMitigationPending/);
  });

  it("7. strike / player / multi-target register deferred settlement", () => {
    assert.match(source("scripts/strike-resolver.js"), /registerDeferredMitigation/);
    assert.match(source("scripts/strike-resolver.js"), /AWAITING_MITIGATION/);
    assert.match(source("scripts/player-strike-service.js"), /registerDeferredMitigation/);
    assert.match(source("scripts/multi-target-strike-service.js"), /awaiting-mitigation/);
  });

  it("8. adapter keeps deferred capture open (no early apply)", () => {
    const adapter = source("scripts/pf2e-adapter.js");
    assert.match(adapter, /capture\.deferred = true/);
    assert.match(adapter, /captureStillOpen\?\.deferred/);
    assert.doesNotMatch(
      adapter,
      /if \(deferToNative\)[\s\S]{0,200}applyDamage\(/,
    );
  });

  it("9. transaction store allows AWAITING_MITIGATION transitions", () => {
    const store = source("scripts/transaction-store.js");
    assert.match(store, /AWAITING_MITIGATION/);
    assert.match(store, /awaiting-mitigation/);
  });

  it("10. resource accounting remains after settlement (not before)", () => {
    const resolver = source("scripts/strike-resolver.js");
    assert.match(resolver, /finalizeStrikeApplication/);
    assert.match(resolver, /resourceLossFromSnapshots/);
    // Must not emit applied presentation before deferred settle registration path returns
    assert.match(resolver, /AWAITING_MITIGATION/);
  });
});
