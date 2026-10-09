import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAppliedDamagePresentation,
  resourceLossFromRecord,
} from "../scripts/applied-damage-presentation.js";
import {
  DAMAGE_RESOURCE_PATHS,
  deriveResourceLoss,
  deriveResourceLossFromAppliedDamage,
  deriveResourceLossFromSnapshots,
  formatResourceLossBreakdown,
  isStaminaVariantEnabled,
  normalizeResourceLoss,
  projectResourceLoss,
  readStaminaValue,
  resourceLossNeedsBreakdown,
} from "../scripts/damage-resource-loss.js";
import { deriveActualStrikeHpLoss } from "../scripts/strike-presentation-feed.js";
import { deriveActualBasicSaveHpLoss } from "../scripts/basic-save-damage-presentation-feed.js";
import { buildDamageAppliedPayload } from "../scripts/damage-applied-bridge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

describe("0.14.22 damage resource accounting — normalization", () => {
  it("1. HP-only damage", () => {
    const loss = normalizeResourceLoss({ hpLoss: 8, tempHpLoss: 0, staminaLoss: 0 });
    assert.deepEqual(loss, { hpLoss: 8, tempHpLoss: 0, staminaLoss: 0, totalApplied: 8 });
  });

  it("2. Temp HP-only damage", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 40, tempHp: 12, stamina: 0 },
      { hp: 40, tempHp: 0, stamina: 0 },
    );
    assert.equal(loss.totalApplied, 12);
    assert.equal(loss.tempHpLoss, 12);
    assert.equal(loss.hpLoss, 0);
  });

  it("3. Stamina-only damage", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 50, tempHp: 0, stamina: 15 },
      { hp: 50, tempHp: 0, stamina: 5 },
    );
    assert.equal(loss.staminaLoss, 10);
    assert.equal(loss.totalApplied, 10);
  });

  it("4. Temp HP + HP", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 80, tempHp: 10, stamina: 0 },
      { hp: 76, tempHp: 0, stamina: 0 },
    );
    assert.deepEqual(loss, { hpLoss: 4, tempHpLoss: 10, staminaLoss: 0, totalApplied: 14 });
  });

  it("5. Stamina + HP", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 80, tempHp: 0, stamina: 20 },
      { hp: 76, tempHp: 0, stamina: 14 },
    );
    assert.deepEqual(loss, { hpLoss: 4, tempHpLoss: 0, staminaLoss: 6, totalApplied: 10 });
  });

  it("6. Temp HP + Stamina + HP", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 80, tempHp: 10, stamina: 20 },
      { hp: 76, tempHp: 0, stamina: 14 },
    );
    assert.deepEqual(loss, { hpLoss: 4, tempHpLoss: 10, staminaLoss: 6, totalApplied: 20 });
  });

  it("7. zero damage", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 10, tempHp: 2, stamina: 3 },
      { hp: 10, tempHp: 2, stamina: 3 },
    );
    assert.equal(loss.totalApplied, 0);
  });

  it("8. missing Temp HP field treated as 0 when deriving from updates", () => {
    const loss = deriveResourceLossFromAppliedDamage({
      updates: [{ path: DAMAGE_RESOURCE_PATHS.hp, value: 5 }],
    });
    assert.equal(loss.tempHpLoss, 0);
    assert.equal(loss.totalApplied, 5);
  });

  it("9. missing Stamina field treated as 0", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 10, tempHp: 0 },
      { hp: 7, tempHp: 0 },
    );
    assert.equal(loss.staminaLoss, 0);
    assert.equal(loss.totalApplied, 3);
  });

  it("10. Stamina variant disabled helper", () => {
    assert.equal(isStaminaVariantEnabled({ variants: { stamina: false } }), false);
    assert.equal(isStaminaVariantEnabled({ variants: { stamina: true } }), true);
    assert.equal(readStaminaValue({ system: { attributes: { hp: { sp: { value: 9 } } } } }, { staminaEnabled: false }), 0);
    assert.equal(readStaminaValue({ system: { attributes: { hp: { sp: { value: 9 } } } } }, { staminaEnabled: true }), 9);
  });

  it("11. malformed resource values fail safe", () => {
    const loss = normalizeResourceLoss({ hpLoss: "x", tempHpLoss: NaN, staminaLoss: -3 });
    assert.deepEqual(loss, { hpLoss: 0, tempHpLoss: 0, staminaLoss: 0, totalApplied: 0 });
  });

  it("12. resource increase clamps loss to zero", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 10, tempHp: 0, stamina: 5 },
      { hp: 15, tempHp: 4, stamina: 8 },
    );
    assert.equal(loss.totalApplied, 0);
  });

  it("13. no NaN", () => {
    const loss = normalizeResourceLoss({ hpLoss: undefined, tempHpLoss: null, staminaLoss: {} });
    assert.equal(Number.isNaN(loss.totalApplied), false);
  });

  it("14. no negative totals", () => {
    const loss = normalizeResourceLoss({ hpLoss: -2, tempHpLoss: -1, staminaLoss: -4 });
    assert.ok(loss.totalApplied >= 0);
  });

  it("15. total equals sum of normalized losses", () => {
    const loss = normalizeResourceLoss({ hpLoss: 4, tempHpLoss: 10, staminaLoss: 6 });
    assert.equal(loss.totalApplied, loss.hpLoss + loss.tempHpLoss + loss.staminaLoss);
  });
});

describe("0.14.22 damage resource accounting — application / events", () => {
  it("16-18. snapshot and AppliedDamageFlag deltas agree on mixed pools", () => {
    const fromSnap = deriveResourceLossFromSnapshots(
      { hp: 80, tempHp: 10, stamina: 20 },
      { hp: 76, tempHp: 0, stamina: 14 },
    );
    const fromFlag = deriveResourceLossFromAppliedDamage({
      updates: [
        { path: DAMAGE_RESOURCE_PATHS.tempHp, value: 10 },
        { path: DAMAGE_RESOURCE_PATHS.stamina, value: 6 },
        { path: DAMAGE_RESOURCE_PATHS.hp, value: 4 },
      ],
    });
    assert.deepEqual(fromSnap, fromFlag);
    assert.deepEqual(deriveResourceLoss({ appliedDamage: { updates: fromFlag && [
      { path: DAMAGE_RESOURCE_PATHS.tempHp, value: 10 },
      { path: DAMAGE_RESOURCE_PATHS.stamina, value: 6 },
      { path: DAMAGE_RESOURCE_PATHS.hp, value: 4 },
    ] } }), fromFlag);
  });

  it("19. PF2e remains authority — no IWR math in resource module", () => {
    const src = source("scripts/damage-resource-loss.js");
    assert.doesNotMatch(src, /resistance|weakness|immunity|hardness|applyDamage/i);
  });

  it("20. resistance-style actual loss uses resource delta not requested", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 30, tempHp: 0, stamina: 0 },
      { hp: 20, tempHp: 0, stamina: 0 },
    );
    assert.equal(loss.totalApplied, 10);
  });

  it("21. immunity / zero total", () => {
    assert.equal(
      deriveResourceLossFromSnapshots(
        { hp: 12, tempHp: 3, stamina: 2 },
        { hp: 12, tempHp: 3, stamina: 2 },
      ).totalApplied,
      0,
    );
  });

  it("22. overkill reports actual resource loss", () => {
    const loss = deriveResourceLossFromSnapshots(
      { hp: 5, tempHp: 0, stamina: 0 },
      { hp: 0, tempHp: 0, stamina: 0 },
    );
    assert.equal(loss.totalApplied, 5);
  });

  it("23. strike helper includes stamina", () => {
    assert.equal(
      deriveActualStrikeHpLoss({
        preApplication: { hp: 10, tempHp: 0, stamina: 8 },
        postApplication: { hp: 10, tempHp: 0, stamina: 3 },
      }),
      5,
    );
  });

  it("24. basic-save helper includes stamina", () => {
    assert.equal(
      deriveActualBasicSaveHpLoss({
        beforeHp: 10,
        beforeTempHp: 0,
        beforeStamina: 8,
        afterHp: 10,
        afterTempHp: 0,
        afterStamina: 3,
      }),
      5,
    );
  });

  it("25-26. independent target records do not share resourceLoss", () => {
    const a = resourceLossFromRecord({
      resourceLoss: { hpLoss: 10, tempHpLoss: 0, staminaLoss: 0 },
    });
    const b = resourceLossFromRecord({
      resourceLoss: { hpLoss: 2, tempHpLoss: 8, staminaLoss: 0 },
    });
    assert.equal(a.totalApplied, 10);
    assert.equal(b.totalApplied, 10);
    assert.notDeepEqual(a, b);
  });

  it("45-50. damageApplied payload exposes resourceLoss without breaking protocol 1", () => {
    const payload = buildDamageAppliedPayload({
      transactionId: "nelflow-tx-1",
      targetActorUuid: "Actor.t",
      targetTokenUuid: "Scene.s.Token.t",
      damageRoll: { instances: [{ type: "fire", persistent: false }] },
      appliedDamage: {
        uuid: "Actor.t",
        isHealing: false,
        updates: [
          { path: DAMAGE_RESOURCE_PATHS.tempHp, value: 10 },
          { path: DAMAGE_RESOURCE_PATHS.stamina, value: 6 },
          { path: DAMAGE_RESOURCE_PATHS.hp, value: 4 },
        ],
      },
      damageMessage: { id: "dmg1", uuid: "ChatMessage.dmg1" },
    });
    assert.equal(payload.protocol, 1);
    assert.equal(payload.type, "damageApplied");
    assert.deepEqual(payload.resourceLoss, { hp: 4, tempHp: 10, stamina: 6, total: 20 });
    assert.equal(payload.totalAppliedDamage, 20);
    assert.ok(payload.appliedDamage);
  });
});

describe("0.14.22 damage resource accounting — presentation", () => {
  it("27. HP-only shows total without breakdown", () => {
    globalThis.game = {
      i18n: {
        format: (key, data) => `${key}:${data.amount}:${data.target ?? ""}`,
        localize: (key) => key,
      },
    };
    const presentation = buildAppliedDamagePresentation(
      { appliedAmount: 8, resourceLoss: { hpLoss: 8, tempHpLoss: 0, staminaLoss: 0 } },
      { target: "Goblin" },
    );
    assert.match(presentation.primary, /8/);
    assert.equal(presentation.breakdown, "");
    assert.equal(resourceLossNeedsBreakdown(presentation.resourceLoss), false);
  });

  it("28. Temp HP-only no longer zero", () => {
    globalThis.game = {
      i18n: {
        format: (key, data) => `${key}:${data.amount}`,
        localize: (key) => key,
      },
    };
    const presentation = buildAppliedDamagePresentation({
      resourceLoss: { hpLoss: 0, tempHpLoss: 12, staminaLoss: 0, totalApplied: 12 },
      appliedAmount: 12,
    });
    assert.equal(presentation.total, 12);
    assert.match(presentation.breakdown, /12/);
  });

  it("29. Stamina-only no longer zero", () => {
    globalThis.game = {
      i18n: {
        format: (key, data) => `${key}:${data.amount}`,
        localize: (key) => key,
      },
    };
    const presentation = buildAppliedDamagePresentation({
      resourceLoss: { hpLoss: 0, tempHpLoss: 0, staminaLoss: 10, totalApplied: 10 },
      appliedAmount: 10,
    });
    assert.equal(presentation.total, 10);
    assert.match(presentation.breakdown, /10/);
  });

  it("30. mixed shows total and breakdown", () => {
    const loss = normalizeResourceLoss({ hpLoss: 4, tempHpLoss: 10, staminaLoss: 6 });
    assert.equal(loss.totalApplied, 20);
    assert.equal(resourceLossNeedsBreakdown(loss), true);
  });

  it("31. zero components omitted from breakdown", () => {
    const localize = (key, data) => `${data.amount}:${key.split(".").pop()}`;
    const text = formatResourceLossBreakdown({ hpLoss: 8, tempHpLoss: 5, staminaLoss: 0 }, localize);
    assert.match(text, /5:TempHp/);
    assert.match(text, /8:Hp/);
    assert.doesNotMatch(text, /Stamina/);
  });

  it("32-34. PC/NPC/spell presentation sources use Applied Damage wording", () => {
    const en = JSON.parse(source("lang/en.json"));
    assert.match(en["Nelflow.PlayerStrike.Application.Applied"], /Damage/);
    assert.match(en["Nelflow.State.AppliedAmount"], /Damage/);
    assert.match(en["Nelflow.Toolbelt.State.appliedAmount"], /Damage/);
  });

  it("35-37. zero-damage display stays zero", () => {
    const presentation = buildAppliedDamagePresentation({
      appliedAmount: 0,
      resourceLoss: { hpLoss: 0, tempHpLoss: 0, staminaLoss: 0, totalApplied: 0 },
    });
    assert.equal(presentation.total, 0);
    assert.equal(presentation.breakdown, "");
  });
});

describe("0.14.22 damage resource accounting — wiring / undo / version", () => {
  it("38-44. transactions persist resourceLoss; undo restores stamina when snapshotted", () => {
    assert.match(source("scripts/strike-resolver.js"), /resourceLoss/);
    assert.match(source("scripts/player-strike-service.js"), /resourceLoss/);
    assert.match(source("scripts/multi-target-strike-service.js"), /resourceLoss/);
    assert.match(source("scripts/spell-attack-service.js"), /resourceLoss/);
    assert.match(source("scripts/toolbelt-basic-save-service.js"), /preApplicationStamina/);
    assert.match(source("scripts/pf2e-adapter.js"), /attributes\.hp\.sp\.value/);
    assert.match(source("scripts/guarded-health-restore.js"), /stamina/);
    assert.doesNotMatch(source("scripts/guarded-health-restore.js"), /totalApplied|resourceLoss\.hp/);
    assert.match(source("scripts/turn-stack-service.js"), /resourceLoss: transaction\.resourceLoss/);
  });

  it("51-53. integration timing hooks untouched in names", () => {
    assert.match(source("scripts/damage-applied-bridge.js"), /nelflow\.damageApplied/);
    assert.match(source("scripts/damage-applied-bridge.js"), /DAMAGE_APPLIED_PROTOCOL = 1/);
  });

  it("projectResourceLoss is plain JSON", () => {
    const projected = projectResourceLoss({ hpLoss: 1, tempHpLoss: 2, staminaLoss: 3 });
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), {
      hp: 1,
      tempHp: 2,
      stamina: 3,
      total: 6,
    });
  });

  it("version metadata is 0.14.22", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.22");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.22");
  });
});
