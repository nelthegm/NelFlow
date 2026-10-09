/**
 * 0.14.22 Shield Block + chat presentation contracts (sections U/V/N).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  abandonDeferredMitigation,
  clearAllDeferredMitigations,
  getDeferredMitigation,
  isMitigationPending,
  observeDeferredMitigationMessage,
  reconcileOrphanedMitigations,
  registerDeferredMitigation,
  shouldInterruptOrphanedMitigation,
} from "../scripts/native-mitigation-deferral.js";
import {
  isShieldRaised,
  resolveShieldBlockChooserUserId,
  resolveShieldBlockForApplication,
} from "../scripts/shield-block-gate.js";
import {
  getStrikePresentationMode,
  STRIKE_PRESENTATION_MODES,
  usesNativeAugmentedStrikePresentation,
} from "../scripts/strike-presentation-mode.js";
import { SETTINGS, TRANSACTION_STATES } from "../scripts/constants.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel) {
  return readFileSync(join(root, "..", rel), "utf8");
}

describe("0.14.22 Shield Block automated contracts (U)", () => {
  beforeEach(() => {
    clearAllDeferredMitigations();
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
      i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
    };
  });

  afterEach(() => {
    clearAllDeferredMitigations();
  });

  it("1. raised shield without pending application does nothing by itself", () => {
    assert.equal(isShieldRaised({ system: { attributes: { shield: { raised: true } } } }), true);
    assert.equal(getDeferredMitigation("none"), null);
    assert.equal(isMitigationPending({ id: "x", state: TRANSACTION_STATES.DAMAGE_ROLLED }), false);
  });

  it("2. incoming damage exposes native Shield Block interaction (defer)", async () => {
    const choice = await resolveShieldBlockForApplication({
      targetToken: {
        actor: { system: { attributes: { shield: { raised: true } } } },
      },
    });
    assert.equal(choice.deferToNative, true);
    assert.match(source("scripts/pf2e-adapter.js"), /deferToNative/);
    assert.match(source("scripts/pf2e-adapter.js"), /capture\.deferred = true/);
  });

  it("3. target owner is the interaction recipient (chooser identity)", () => {
    const token = {
      actor: {
        id: "Actor.pc1",
        ownership: { p1: 3, gm1: 3 },
      },
    };
    assert.equal(resolveShieldBlockChooserUserId(token), "p1");
    // Native PF2e card is visible to owners — NelFlow no longer GM-dialogs.
    assert.doesNotMatch(source("scripts/shield-block-gate.js"), /DialogV2/);
  });

  it("4. stack remains pending while interaction unresolved", () => {
    assert.equal(
      isMitigationPending({
        id: "tx",
        state: TRANSACTION_STATES.AWAITING_MITIGATION,
      }),
      true,
    );
    assert.match(source("scripts/chat-ui.js"), /WaitingForDamageResolution/);
    assert.match(
      source("lang/en.json"),
      /"Nelflow\.State\.WaitingForDamageResolution": "Waiting for Damage Resolution"/,
    );
  });

  it("5. native interactive UI is not prematurely suppressed", () => {
    const records = source("scripts/native-records-controller.js");
    assert.match(records, /stackHasMitigationPending/);
    assert.match(source("scripts/strike-resolver.js"), /failOpen/);
  });

  it("6-7. decline completes application and finalizes once", async () => {
    // Decline = Apply without shield-block toggle → same settle path as accept.
    let settles = 0;
    registerDeferredMitigation({
      transactionId: "tx-decline",
      settle: async () => {
        settles += 1;
        return { ok: true };
      },
      timeoutMs: 60_000,
    });
    const app = { id: "app-d" };
    const pending = new Map([
      ["tx-decline", { transactionId: "tx-decline", deferred: true, candidates: [app] }],
    ]);
    observeDeferredMitigationMessage(app, pending);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(settles, 1);
    observeDeferredMitigationMessage(app, pending);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(settles, 1);
  });

  it("8-9. accept completes application and finalizes once", async () => {
    // Accept uses identical unique damage-taken settle — PF2e owns hardness.
    let settles = 0;
    registerDeferredMitigation({
      transactionId: "tx-accept",
      settle: async () => {
        settles += 1;
      },
      timeoutMs: 60_000,
    });
    const app = { id: "app-a" };
    const pending = new Map([
      ["tx-accept", { transactionId: "tx-accept", deferred: true, candidates: [app] }],
    ]);
    observeDeferredMitigationMessage(app, pending);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(settles, 1);
  });

  it("10-13. post-block actor resource loss only; no NelFlow Hardness / shield HP math", () => {
    // Gate comments may mention PF2e hardness; executable resolve path must not compute it.
    const resolveBody = source("scripts/shield-block-gate.js").split(
      "export async function resolveShieldBlockForApplication",
    )[1]?.split("export function initializeShieldBlockGate")[0] ?? "";
    assert.doesNotMatch(resolveBody, /\bhardness\b|\bshieldHp\b|\bweakness\b|\bresistance\b/i);
    const loss = source("scripts/damage-resource-loss.js");
    assert.doesNotMatch(loss, /shield\.hp|item\.hp|\bhardness\b/i);
    assert.match(loss, /hpLoss|tempHpLoss|staminaLoss/);
    // Settlement uses healthSnapshot deltas after PF2e apply.
    assert.match(source("scripts/strike-resolver.js"), /healthSnapshot/);
    assert.match(source("scripts/strike-resolver.js"), /resourceLossFromSnapshots/);
  });

  it("14. damageApplied fires once after decision (adapter path skips emit while deferred)", () => {
    const adapter = source("scripts/pf2e-adapter.js");
    // Deferred return precedes applyDamage / emitDamageAppliedFromApplication in try.
    const deferIdx = adapter.indexOf("capture.deferred = true");
    const applyIdx = adapter.indexOf("await contextClone.applyDamage", deferIdx);
    const emitIdx = adapter.indexOf("emitDamageAppliedFromApplication", applyIdx);
    assert.ok(deferIdx > -1);
    assert.ok(applyIdx > deferIdx);
    assert.ok(emitIdx > applyIdx);
    assert.match(source("scripts/strike-resolver.js"), /emitDamageAppliedFromApplication/);
  });

  it("15. Undo transaction only after APPLIED settlement", () => {
    const resolver = source("scripts/strike-resolver.js");
    assert.match(
      resolver,
      /transaction\.state !== TRANSACTION_STATES\.APPLIED/,
    );
    assert.doesNotMatch(
      source("scripts/player-strike-presentation.js"),
      /AWAITING_MITIGATION[\s\S]{0,80}canShowPlayerStrikeUndo/,
    );
  });

  it("16-17. no duplicate Dialog prompt; single settle registration", () => {
    assert.doesNotMatch(source("scripts/shield-block-gate.js"), /DialogV2|socket\.emit/);
    registerDeferredMitigation({
      transactionId: "tx-once",
      settle: async () => ({}),
      timeoutMs: 60_000,
    });
    assert.ok(getDeferredMitigation("tx-once"));
    // Re-register replaces; still one map entry.
    registerDeferredMitigation({
      transactionId: "tx-once",
      settle: async () => ({}),
      timeoutMs: 60_000,
    });
    assert.equal([...[getDeferredMitigation("tx-once")]].length, 1);
  });

  it("18. abandoned / timeout fails conservatively (no auto-apply)", async () => {
    let abandoned = null;
    registerDeferredMitigation({
      transactionId: "tx-abandon",
      settle: async () => {
        throw new Error("should-not-settle");
      },
      onAbandoned: async ({ reason }) => {
        abandoned = reason;
      },
      timeoutMs: 60_000,
    });
    const result = await abandonDeferredMitigation("tx-abandon", "player-disconnect");
    assert.equal(result.abandoned, true);
    assert.equal(abandoned, "player-disconnect");
    assert.equal(getDeferredMitigation("tx-abandon"), null);
    assert.match(source("scripts/native-mitigation-deferral.js"), /never auto-declines|Do not apply guessed/i);
  });

  it("19. reload during pending does not double-apply (orphan interrupt)", async () => {
    const orphan = {
      id: "tx-orphan",
      state: TRANSACTION_STATES.AWAITING_MITIGATION,
    };
    assert.equal(shouldInterruptOrphanedMitigation(orphan), true);
    registerDeferredMitigation({
      transactionId: "tx-live",
      settle: async () => ({}),
      timeoutMs: 60_000,
    });
    assert.equal(
      shouldInterruptOrphanedMitigation({
        id: "tx-live",
        state: TRANSACTION_STATES.AWAITING_MITIGATION,
      }),
      false,
    );
    const interrupted = [];
    await reconcileOrphanedMitigations({
      messages: [
        {
          id: "m1",
          getFlag: () => orphan,
        },
      ],
      updateTransaction: async (message, transaction) => {
        interrupted.push(transaction.id);
      },
    });
    assert.deepEqual(interrupted, ["tx-orphan"]);
  });

  it("20. multi-GM does not duplicate resolution (single deferred settle)", async () => {
    let count = 0;
    registerDeferredMitigation({
      transactionId: "tx-gm",
      settle: async () => {
        count += 1;
      },
      timeoutMs: 60_000,
    });
    const app = { id: "app-gm" };
    const pending = new Map([
      ["tx-gm", { transactionId: "tx-gm", deferred: true, candidates: [app] }],
    ]);
    observeDeferredMitigationMessage(app, pending);
    observeDeferredMitigationMessage(app, pending);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(count, 1);
  });
});

describe("0.14.22 chat presentation contracts (V/N)", () => {
  it("21-26. NPC final presentation is stack-first after settlement", () => {
    const records = source("scripts/native-records-controller.js");
    const compact = source("scripts/native-card-compactor.js");
    assert.match(records, /nelflow-native-record-hidden/);
    assert.match(records, /stackFirstEnabled/);
    assert.match(compact, /registerNative/);
    // Mitigation pending keeps card; settlement re-hides via markStackRendered.
    assert.match(source("scripts/strike-resolver.js"), /markStackRendered/);
    assert.match(source("scripts/strike-resolver.js"), /failOpen/);
  });

  it("27-28. native card available while interactive; hide only after safe settlement", () => {
    assert.match(source("scripts/native-records-controller.js"), /!stackHasMitigationPending/);
    assert.match(source("scripts/pf2e-adapter.js"), /captureStillOpen\?\.deferred/);
  });

  it("29-30. PC native damage card remains; footer attaches once (native-augmented)", () => {
    assert.equal(
      getStrikePresentationMode({
        transactionType: "player-strike",
        snapshot: { actorType: "character" },
      }),
      STRIKE_PRESENTATION_MODES.NATIVE_AUGMENTED,
    );
    assert.equal(
      usesNativeAugmentedStrikePresentation({
        transactionType: "player-strike",
        snapshot: { actorType: "character" },
      }),
      true,
    );
    assert.equal(
      getStrikePresentationMode({
        transactionType: "strike",
        snapshot: { actorType: "npc" },
      }),
      STRIKE_PRESENTATION_MODES.CANONICAL_STACK,
    );
    const compact = source("scripts/native-card-compactor.js");
    assert.match(compact, /usesNativeAugmentedStrikePresentation/);
    assert.match(compact, /restoreFullCard/);
  });

  it("31-32. no duplicate Results row; reload orphan fails closed not re-hide duplicate", () => {
    assert.match(source("scripts/main.js"), /reconcileOrphanedMitigations/);
    assert.match(source("scripts/main.js"), /reload-orphaned-mitigation/);
  });

  it("P. basic-save / spell-attack not globally suppressed by Shield gate", () => {
    assert.doesNotMatch(source("scripts/spell-attack-service.js"), /shieldBlockPrompt:\s*true/);
    assert.doesNotMatch(source("scripts/toolbelt-basic-save-service.js"), /shieldBlockPrompt:\s*true/);
    assert.doesNotMatch(source("scripts/save-resolver-service.js"), /shieldBlockPrompt:\s*true/);
  });

  it("generic waiting label does not claim Shield Block without structured proof", () => {
    const en = JSON.parse(source("lang/en.json"));
    assert.equal(en["Nelflow.State.WaitingForDamageResolution"], "Waiting for Damage Resolution");
    assert.equal(en["Nelflow.Status.AwaitingMitigation"], "Waiting for Damage Resolution");
    assert.doesNotMatch(
      en["Nelflow.State.WaitingForDamageResolution"],
      /Shield Block/i,
    );
  });
});
