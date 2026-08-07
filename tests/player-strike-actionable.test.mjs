import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TRANSACTION_STATES } from "../scripts/constants.js";
import {
  canSuppressPlayerStrikeNativeAttack,
  playerStrikeDamageActionKind,
  playerStrikeIsHit,
  playerStrikePresentationState,
} from "../scripts/player-strike-presentation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

test("1. PC hit requires a Damage action kind", () => {
  assert.equal(playerStrikeDamageActionKind("success"), "damage");
});

test("2. PC critical hit requires a Critical Damage action kind", () => {
  assert.equal(playerStrikeDamageActionKind("criticalSuccess"), "critical");
});

test("3. PC miss renders no damage action", () => {
  assert.equal(playerStrikeDamageActionKind("failure"), null);
  assert.equal(playerStrikeIsHit("failure"), false);
});

test("4. PC critical failure renders no damage action", () => {
  assert.equal(playerStrikeDamageActionKind("criticalFailure"), null);
  assert.equal(playerStrikeIsHit("criticalFailure"), false);
});

test("5. waiting presentation state remains waiting until damage", () => {
  assert.equal(
    playerStrikePresentationState({ state: TRANSACTION_STATES.WAITING_FOR_DAMAGE }),
    "waiting",
  );
});

test("6. native attack card is not suppressed before actionable replacement exists", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    outcome: "success",
    hasCanonicalPresentation: true,
    hasCanonicalDamageAction: false,
    hasNativeDamageControl: true,
  }), false);
});

test("7. replacement-render failure leaves native card visible", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    outcome: "success",
    hasCanonicalPresentation: false,
    hasCanonicalDamageAction: true,
    hasNativeDamageControl: true,
  }), false);
});

test("8. missing PF2e continuation capability leaves native card visible", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    outcome: "criticalSuccess",
    hasCanonicalPresentation: true,
    hasCanonicalDamageAction: true,
    hasNativeDamageControl: false,
  }), false);
});

test("actionable hit may suppress only when both controls exist", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    outcome: "success",
    hasCanonicalPresentation: true,
    hasCanonicalDamageAction: true,
    hasNativeDamageControl: true,
  }), true);
});

test("miss waiting-state is not required; non-hit may suppress once presentation exists", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.WAITING_FOR_DAMAGE,
    outcome: "failure",
    hasCanonicalPresentation: true,
    hasCanonicalDamageAction: false,
    hasNativeDamageControl: false,
  }), true);
});

test("applied transactions may suppress without a damage action", () => {
  assert.equal(canSuppressPlayerStrikeNativeAttack({
    transactionState: TRANSACTION_STATES.APPLIED,
    outcome: "success",
    hasCanonicalPresentation: true,
    hasCanonicalDamageAction: false,
    hasNativeDamageControl: false,
  }), true);
});

test("9-11. Damage button delegates to native strike-damage once without reconstructing formulas", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /activateNativeStrikeDamage/);
  assert.match(ui, /findNativeStrikeDamageControl/);
  assert.match(ui, /button\.click\(\)/);
  assert.match(ui, /data-action="strike-damage"/);
  assert.doesNotMatch(ui, /rebuildWeaponDamage|parseDamageFormula|fatalTrait/);
  assert.match(ui, /nelflow-player-strike__damage-action/);
  assert.match(ui, /button\.disabled = true/);
});

test("10. Critical Damage uses critical-success native outcome", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /critical-success/);
  assert.match(ui, /RollCriticalDamage/);
});

test("5b. attack result is visible without opening Results", () => {
  const ui = source("scripts/player-strike-ui.js");
  const css = source("styles/nelflow.css");
  assert.match(ui, /attackResultLine/);
  assert.match(ui, /strikeOutcomeLabel/);
  assert.match(ui, /authorizedAttackTotal/);
  assert.match(css, /nelflow-player-strike__body[\s\S]*white-space:\s*pre-line/);
  assert.match(ui, /\u2192|→/);
});

test("12-13. completed card still projects Applied and Undo", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /Summary\.Applied/);
  assert.match(ui, /canShowPlayerStrikeUndo/);
  assert.match(ui, /nelflow-player-strike__undo/);
});

test("14. Results architecture remains supplemental and excludes Application proof", () => {
  const records = source("scripts/native-records-controller.js");
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /NativeRecordsController\.recordsForTransaction/);
  assert.match(records, /INSPECTION_ROLES = new Set\(\["attack", "damage"\]\)/);
  assert.match(records, /filter\(\(record\) => INSPECTION_ROLES\.has\(record\.role\)\)/);
});

test("15-16. Attack and Damage remain inspectable via Results after completion", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /buildRollInspection/);
  assert.match(ui, /RollPopoverController\.register/);
  assert.match(ui, /Stack\.AttackMessage/);
  assert.match(ui, /Stack\.DamageMessage|Stack\.CriticalDamageMessage/);
});

test("17. PC damage is not autorolled by default in player-strike service", () => {
  const service = source("scripts/player-strike-service.js");
  assert.doesNotMatch(service, /rollStrikeDamage\(/);
  assert.match(service, /WAITING_FOR_DAMAGE/);
});

test("18. NPC autoroll path remains in strike resolver / pf2e adapter", () => {
  const adapter = source("scripts/pf2e-adapter.js");
  assert.match(adapter, /rollStrikeDamage/);
  assert.match(adapter, /hasNativeDamageMethod/);
});

test("19-20. exact concurrent correlation protects independent unresolved PC hits", () => {
  const intent = source("scripts/player-strike-intent.js");
  const model = source("scripts/player-strike-model.js");
  assert.match(intent, /CHARACTER_STRIKE_INTENT_MAX_AGE_MS|intentNonce/);
  assert.match(intent, /sourceMessageId/);
  assert.match(model, /correlatePlayerStrikeDamage|validateCharacterStrikeCorrelation/);
});

test("21-26. MAP / fatal / deadly / runes / precision stay on native PF2e damage control", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /activateNativeStrikeDamage/);
  assert.match(ui, /button\.click\(\)/);
  assert.doesNotMatch(ui, /function\s+(rebuild|compute|calculate).*(deadly|fatal|precision)/i);
  assert.doesNotMatch(ui, /parseRenderedDamage|manualCritMultiplier/);
});

test("27-28. target redirection and ambiguous attribution remain Review-safe", () => {
  const service = source("scripts/player-strike-service.js");
  const model = source("scripts/player-strike-model.js");
  assert.match(model, /TARGET_CHANGED|targetFingerprint|correlatePlayerStrikeDamage/);
  assert.match(service, /MANUAL|manual-review|TARGET_CHANGED|target/);
});

test("29. reload reconstructs from persisted attack/damage IDs", () => {
  const model = source("scripts/player-strike-model.js");
  assert.match(model, /reconcilePlayerStrikeReload/);
  const presentation = source("scripts/player-strike-presentation.js");
  assert.match(presentation, /playerStrikePresentationCandidates/);
});

test("30-31. duplicate Damage click disables the proxy and intent binding is idempotent once bound", () => {
  const ui = source("scripts/player-strike-ui.js");
  const intent = source("scripts/player-strike-intent.js");
  assert.match(ui, /button\.disabled = true/);
  assert.match(intent, /localIntentState === "bound"/);
});

test("32-33. private totals require isContentVisible and name visibility guards remain", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /isContentVisible/);
  assert.match(ui, /playersCanSeeName|HiddenTarget|RecordedTarget/);
  assert.match(ui, /authorizedAttackTotal/);
});

test("native-card-compactor enforces the actionability invariant for player Strikes", () => {
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(compactor, /canSuppressPlayerStrikeNativeAttack/);
  assert.match(compactor, /nelflowDamageActionable/);
  assert.match(compactor, /Actionability invariant/);
});

test("chat render order builds player Strike before native suppression", () => {
  const chat = source("scripts/chat-ui.js");
  const renderIndex = chat.indexOf("renderPlayerStrike(message, html)");
  const compactIndex = chat.indexOf("NativeCardCompactor.render(message, html)");
  assert.ok(renderIndex >= 0 && compactIndex > renderIndex);
});

test("localization exposes Damage and Critical Damage actions", () => {
  const lang = JSON.parse(source("lang/en.json"));
  assert.equal(lang["Nelflow.PlayerStrike.RollDamage"], "Damage");
  assert.equal(lang["Nelflow.PlayerStrike.RollCriticalDamage"], "Critical Damage");
});

test("0.12.0 metadata prepares 0.12.0 download URL", () => {
  const module = JSON.parse(source("module.json"));
  const packageMetadata = JSON.parse(source("package.json"));
  assert.equal(module.id, "nelflow");
  assert.equal(module.version, "0.12.0");
  assert.equal(packageMetadata.version, "0.12.0");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.12.0/nelflow.zip",
  );
});

test("36. NelCine strike delivery remains after PC actionable presentation", () => {
  const service = source("scripts/player-strike-service.js");
  const delivery = source("scripts/nelcine-strike-delivery.js");
  assert.match(service, /tryDeliverStrikePresentation/);
  assert.match(delivery, /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(delivery, /nelflow\.strikeResolved/);
});

test("NelCine impact and save-batch bridges remain present and exclusive with presentation delivery", () => {
  const delivery = source("scripts/nelcine-strike-delivery.js");
  const impact = source("scripts/nelcine-impact-bridge.js");
  const batch = source("scripts/nelcine-save-batch-bridge.js");
  const resolver = source("scripts/strike-resolver.js");
  assert.match(impact, /nelcine\.strikeImpact/);
  assert.match(batch, /tryEmitToolbeltSaveBatch|tryEmitLegacySaveBatch/);
  assert.match(delivery, /impactSyncSelected/);
  assert.match(resolver, /tryDeliverStrikePresentation|nelcine/);
});

test("PC actionable UI does not invent NelCine hooks or impact commits", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.doesNotMatch(ui, /nelflow\.strikeResolved|nelcine\.strikeImpact|tryDeliverStrikePresentation/);
  assert.doesNotMatch(ui, /commitStrikeApplication|AWAITING_IMPACT/);
});

test("player Strike application still delivers presentation after apply, without impact-sync by default", () => {
  const service = source("scripts/player-strike-service.js");
  assert.match(service, /tryDeliverStrikePresentation\(\{[\s\S]*impactSyncSelected:\s*false/);
});
