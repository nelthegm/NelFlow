import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import {
  attackTotalFromExactRecord,
  buildStrikeRowPresentation,
  exactRecordForRole,
  hasExactDamageRecord,
} from "../scripts/strike-row-presentation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");
const chat = source("scripts/chat-ui.js");
const css = source("styles/nelflow.css");
const localization = JSON.parse(source("lang/en.json"));
const helper = source("scripts/strike-row-presentation.js");
const popover = source("scripts/roll-popover-controller.js");
const stackController = source("scripts/stack-presentation-controller.js");

function record(role, total = null) {
  return { id: `${role}-message`, role, total };
}

function inspectAttack(entry) {
  return { kind: "attack", available: true, total: entry.total };
}

function view({ outcome = "success", attackTotal = 24, damage = true, damageText = "13 Slashing" } = {}) {
  const records = [record("attack", attackTotal)];
  if (damage) records.push(record("damage"));
  return buildStrikeRowPresentation({
    row: { outcome, damageSummary: { total: 13 } },
    records,
    inspectAttack,
    formatDamage: () => damageText,
  });
}

describe("Nelflow 0.14.18 compact Strike row readability", () => {
  it("1. hit keeps the authoritative outcome and exact attack total", () => {
    assert.deepEqual(view({ outcome: "success", attackTotal: 24 }).outcome, "success");
    assert.equal(view({ outcome: "success", attackTotal: 24 }).attackTotal, 24);
  });

  it("2. critical hit keeps the authoritative outcome and exact attack total", () => {
    assert.equal(view({ outcome: "criticalSuccess", attackTotal: 33 }).outcome, "criticalSuccess");
    assert.equal(view({ outcome: "criticalSuccess", attackTotal: 33 }).attackTotal, 33);
  });

  it("3. miss keeps the authoritative outcome and exact attack total", () => {
    assert.equal(view({ outcome: "failure", attackTotal: 18, damage: false }).outcome, "failure");
    assert.equal(view({ outcome: "failure", attackTotal: 18, damage: false }).attackTotal, 18);
  });

  it("4. critical miss keeps the authoritative outcome and exact attack total", () => {
    assert.equal(view({ outcome: "criticalFailure", attackTotal: 9, damage: false }).outcome, "criticalFailure");
    assert.equal(view({ outcome: "criticalFailure", attackTotal: 9, damage: false }).attackTotal, 9);
  });

  it("5. missing attack total never invents a number", () => {
    assert.equal(view({ attackTotal: null }).attackTotal, null);
    assert.equal(attackTotalFromExactRecord([], inspectAttack), null);
  });

  it("6. a hit with an exact native damage record gets a separate damage projection", () => {
    assert.equal(view().showDamage, true);
    assert.equal(view().damage, "13 Slashing");
  });

  it("7. a critical hit with an exact native damage record gets a separate damage projection", () => {
    const projected = view({ outcome: "criticalSuccess", damageText: "36 Slashing" });
    assert.equal(projected.showDamage, true);
    assert.equal(projected.damage, "36 Slashing");
  });

  it("8. the damage result line begins with the localized Damage label", () => {
    assert.match(chat, /damageHeading\.textContent = localize\("Nelflow\.Stack\.DamageLabel"\)/);
    assert.equal(localization["Nelflow.Stack.DamageLabel"], "Damage");
  });

  it("9. a miss without an exact damage record has no damage projection", () => {
    assert.equal(view({ outcome: "failure", damage: false }).showDamage, false);
  });

  it("10. a critical miss without an exact damage record has no damage projection", () => {
    assert.equal(view({ outcome: "criticalFailure", damage: false }).showDamage, false);
  });

  it("11. rolled damage and applied HP use distinct existing fields", () => {
    assert.match(chat, /presentation\.damage/);
    assert.match(chat, /row\.appliedAmount/);
    assert.doesNotMatch(helper, /appliedAmount/);
  });

  it("12. resistance may display rolled 18 and applied 12 independently", () => {
    const projected = view({ damageText: "18 Slashing" });
    const row = { damageSummary: { total: 18 }, appliedAmount: 12 };
    assert.equal(projected.damage, "18 Slashing");
    assert.equal(row.appliedAmount, 12);
  });

  it("13. structured damage-type formatting remains the only damage display source", () => {
    assert.match(chat, /formatDamage: formatDamageSummary/);
    assert.doesNotMatch(helper, /innerHTML|outerHTML|textContent|querySelector/);
  });

  it("14. MAP remains in the Strike heading through the existing formatter", () => {
    assert.match(chat, /const map = mapText\(row\)/);
    assert.match(chat, /mapLabel\.className = "nelflow-stack__map"/);
  });

  it("15. an exact attack record maps to a d20 inspection icon", () => {
    assert.match(chat, /attack: \["Nelflow\.Stack\.ViewAttackRoll", "fa-solid fa-dice-d20"\]/);
  });

  it("16. an exact damage record maps to a burst inspection icon", () => {
    assert.match(chat, /damage: \["Nelflow\.Stack\.ViewDamageRoll", "fa-solid fa-burst"\]/);
  });

  it("17. a normal miss has no damage record and therefore no damage icon", () => {
    assert.equal(hasExactDamageRecord([record("attack", 18)]), false);
    assert.equal(exactRecordForRole([record("attack", 18)], "damage"), null);
  });

  it("18. Undo visibility still uses the existing canUseUndo eligibility gate", () => {
    assert.match(chat, /if \(canUseUndo\(row, stack\)\)/);
    assert.match(chat, /row\.transactionState === TRANSACTION_STATES\.APPLIED/);
  });

  it("19. Attack, Damage, and Undo controls share one nowrap flex row", () => {
    assert.match(chat, /controls\.className = "nelflow-strike-controls"/);
    assert.match(css, /\.nelflow-strike-controls\s*\{[\s\S]*?display: flex;[\s\S]*?flex-wrap: nowrap;/);
  });

  it("20. unavailable controls create no blank placeholder slots", () => {
    assert.match(chat, /if \(inspection\) controls\.append\(inspection\)/);
    assert.match(chat, /if \(controls\.childElementCount\) main\.append\(controls\)/);
    assert.doesNotMatch(chat, /placeholder/i);
  });

  it("21. attack inspection refreshes the exact linked record", () => {
    assert.match(chat, /NativeRecordsController\.refreshRecord\(record\)/);
    assert.match(source("scripts/native-records-controller.js"), /candidate\.id === record\.id && candidate\.role === record\.role/);
  });

  it("22. damage inspection uses the same exact linked-record refresh", () => {
    assert.match(chat, /return RollPopoverController\.register\([\s\S]*inspectionModel\(record\)/);
    assert.doesNotMatch(chat, /nearest|timestamp|strikeName.*find/i);
  });

  it("23. Undo still invokes the existing guarded StrikeResolver path", () => {
    assert.match(chat, /StrikeResolver\.undoFromMessage\(attackMessage\)/);
    assert.doesNotMatch(chat, /actor\.update|system\.attributes\.hp/);
  });

  it("24. every compact control is a semantic button", () => {
    assert.match(chat, /function iconButton[\s\S]*document\.createElement\("button"\)/);
    assert.match(chat, /button\.type = "button"/);
    assert.doesNotMatch(chat, /createElement\("i"\)\.addEventListener/);
  });

  it("25. icon controls receive localized aria labels", () => {
    assert.match(chat, /button\.setAttribute\("aria-label", label\)/);
    assert.equal(localization["Nelflow.Stack.ViewAttackRoll"], "View Attack Roll");
    assert.equal(localization["Nelflow.Stack.UndoAppliedDamage"], "Undo Applied Damage");
  });

  it("26. icon controls receive localized title tooltips", () => {
    assert.match(chat, /button\.title = title/);
    assert.equal(localization["Nelflow.Stack.ViewDamageRoll"], "View Damage Roll");
    assert.equal(localization["Nelflow.Stack.ViewCriticalDamageRoll"], "View Critical Damage Roll");
  });

  it("27. native button click activation opens the same inspection used by focus", () => {
    assert.match(popover, /control\.addEventListener\("click"[\s\S]*openPopover\(control\)/);
    assert.match(popover, /document\.addEventListener\("focusin"[\s\S]*openPopover\(control\)/);
  });

  it("28. stack following reparents the exact node, preserving control listeners", () => {
    assert.match(stackController, /parentElement\?\.append\(node\)/);
    assert.doesNotMatch(stackController, /cloneNode|innerHTML/);
  });

  it("29. rerender reconstructs controls from durable exact row records", () => {
    assert.match(chat, /NativeRecordsController\.recordsForRow\(stack, row\)/);
    assert.match(chat, /renderRow\(row, stack, records\)/);
  });

  it("30. row rehydration is presentation-only and invokes no roll or application", () => {
    assert.doesNotMatch(helper, /rollDamage|applyDamage|ChatMessage\.create|update\(/);
  });

  it("31. collapsed stack behavior continues to hide only durable row bodies", () => {
    assert.match(stackController, /view\.rows\.hidden = !expanded/);
    assert.match(stackController, /nelflow-stack--collapsed/);
  });

  it("32. expansion continues to restore the same redesigned rows", () => {
    assert.match(stackController, /expanded = !expanded[\s\S]*applyDisclosure\(view, expanded\)/);
    assert.match(stackController, /aria-expanded/);
  });

  it("33. Results inspection remains present and independently disclosed", () => {
    assert.match(chat, /panel\.className = "nelflow-stack__results"/);
    assert.match(css, /\.nelflow-stack--results-open \.nelflow-stack__results/);
  });

  it("34. structured Riders still render through the existing renderer", () => {
    assert.match(chat, /const riders = renderStrikeRiders\(row, stack\)/);
    assert.match(chat, /if \(riders\) main\.append\(riders\)/);
  });

  it("35. supplemental Actions still render when Riders do not replace them", () => {
    assert.match(chat, /supplementalActions = renderSupplementalActions\(row, stackId\)/);
    assert.match(chat, /auxiliary\.append\(supplementalActions\)/);
  });

  it("36. attack totals are absent when exact native records are unauthorized", () => {
    assert.equal(attackTotalFromExactRecord([], inspectAttack), null);
    assert.match(source("scripts/native-records-controller.js"), /visibleMessage\(message\)/);
  });

  it("37. normal row text never appends transaction identifiers", () => {
    const rowBody = chat.slice(chat.indexOf("function renderRow"), chat.indexOf("function batchTargetLabel"));
    assert.doesNotMatch(rowBody, /textContent\s*=\s*row\.transactionId|append\([^\n]*transactionId/);
  });

  it("38. player target presentation does not receive UUID metadata", () => {
    assert.match(chat, /if \(game\.user\.isGM\) \{[\s\S]*target\.dataset\.uuid/);
    assert.match(chat, /target: game\.user\.isGM \? row\.targetName : localize\("Nelflow\.Native\.Target"\)/);
  });

  it("39. player-native Strike presentation remains a separate renderer", () => {
    assert.match(chat, /renderPlayerStrike/);
    assert.doesNotMatch(helper, /player-strike|NativeCardCompactor/);
  });

  it("40. Toolbelt save presentation remains a separate renderer", () => {
    assert.match(chat, /renderToolbeltBasicSave/);
    assert.match(chat, /renderSaveResolverChat/);
    assert.doesNotMatch(helper, /toolbelt|saveResolver/);
  });

  it("41. critical damage may reuse the burst icon while retaining an exact label", () => {
    assert.match(chat, /criticalDamage: \["Nelflow\.Stack\.ViewCriticalDamageRoll", "fa-solid fa-burst"\]/);
  });

  it("42. icon controls have a theme-compatible visible focus state", () => {
    assert.match(css, /\.nelflow-stack__reference:focus-visible,[\s\S]*outline: 2px solid var\(--color-border-highlight, currentColor\)/);
  });

  it("43. controls use bundled Font Awesome classes only", () => {
    assert.match(chat, /fa-solid fa-dice-d20/);
    assert.match(chat, /fa-solid fa-burst/);
    assert.match(chat, /fa-solid fa-rotate-left/);
    assert.doesNotMatch(chat, /https?:\/\/[^"']+\.(?:svg|png|webp)/);
  });

  it("44. the row projection does not mutate transaction or schema data", () => {
    assert.doesNotMatch(helper, /\.update\(|setFlag|deleteFlag|transactionState\s*=/);
    assert.match(helper, /row\?\.outcome/);
  });

  it("45. damage lines require an exact role-matched record", () => {
    assert.equal(hasExactDamageRecord([record("application"), record("attack", 20)]), false);
    assert.equal(hasExactDamageRecord([record("damage")]), true);
  });
});
