import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TRANSACTION_STATES } from "../scripts/constants.js";
import {
  canShowPlayerStrikeAppliedAmount,
  canShowPlayerStrikeUndo,
  playerStrikePresentationCandidates,
  playerStrikePresentationState,
  selectPlayerStrikePresentationHost,
  shouldRenderPlayerStrikeApplication,
} from "../scripts/player-strike-presentation.js";
import {
  getStrikePresentationMode,
  STRIKE_PRESENTATION_MODES,
  usesNativeAugmentedStrikePresentation,
} from "../scripts/strike-presentation-mode.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");
const player = (changes = {}) => ({
  id: "tx",
  transactionType: "player-strike",
  state: TRANSACTION_STATES.APPLIED,
  attackMessageId: "attack",
  damageMessageId: "damage",
  applicationMessageId: "application",
  appliedAmount: 12,
  snapshot: { actorType: "character", outcome: "success" },
  ...changes,
});

test("1. ordinary character Strike selects native-augmented presentation", () => {
  assert.equal(getStrikePresentationMode(player()), STRIKE_PRESENTATION_MODES.NATIVE_AUGMENTED);
});

test("2. actor type, not rolling user role, selects character presentation", () => {
  assert.equal(getStrikePresentationMode(player({ sourceUserId: "gm" })), "native-augmented");
});

test("3. NPC Strike selects canonical stack presentation", () => {
  assert.equal(getStrikePresentationMode({ transactionType: "strike", snapshot: { actorType: "npc" } }), "canonical-stack");
});

test("4. shared-roll character Strike retains canonical batch exception", () => {
  assert.equal(getStrikePresentationMode({ transactionType: "multi-target-strike", snapshot: { actorType: "character" } }), "canonical-stack");
});

test("5. unsupported transaction types fail to canonical presentation", () => {
  assert.equal(getStrikePresentationMode({ transactionType: "unknown" }), "canonical-stack");
});

test("6. native presentation predicate is explicit", () => {
  assert.equal(usesNativeAugmentedStrikePresentation(player()), true);
  assert.equal(usesNativeAugmentedStrikePresentation({ transactionType: "strike" }), false);
});

test("6b. durable legacy player-strike flags rehydrate to native presentation", () => {
  assert.equal(getStrikePresentationMode(player({ snapshot: {} })), "native-augmented");
});

test("7. exact native damage card is the first application host", () => {
  assert.deepEqual(playerStrikePresentationCandidates(player()), ["damage", "application"]);
});

test("8. native attack card is never an ordinary application host", () => {
  assert.equal(selectPlayerStrikePresentationHost(player(), (id) => id === "attack"), null);
});

test("9. exact visible damage message wins over application record", () => {
  assert.equal(selectPlayerStrikePresentationHost(player(), () => true), "damage");
});

test("10. visible application record is the privacy-safe fallback", () => {
  assert.equal(selectPlayerStrikePresentationHost(player(), (id) => id === "application"), "application");
});

test("11. unavailable linked records produce no synthetic host", () => {
  assert.equal(selectPlayerStrikePresentationHost(player(), () => false), null);
});

test("12. duplicate host IDs remain idempotent", () => {
  assert.deepEqual(playerStrikePresentationCandidates(player({ applicationMessageId: "damage" })), ["damage"]);
});

test("13. waiting attack creates no Nelflow application footer", () => {
  assert.equal(shouldRenderPlayerStrikeApplication(player({ state: TRANSACTION_STATES.WAITING_FOR_DAMAGE })), false);
});

test("14. misses create no Nelflow application footer", () => {
  assert.equal(shouldRenderPlayerStrikeApplication(player({ state: TRANSACTION_STATES.SKIPPED })), false);
});

test("15. application progress may augment the native damage card", () => {
  assert.equal(shouldRenderPlayerStrikeApplication(player({ state: TRANSACTION_STATES.APPLYING })), true);
});

test("16. applied state renders the lightweight footer", () => {
  assert.equal(shouldRenderPlayerStrikeApplication(player()), true);
  assert.equal(playerStrikePresentationState(player()), "applied");
});

test("17. successful Undo updates the augmentation state", () => {
  assert.equal(playerStrikePresentationState(player({ state: TRANSACTION_STATES.UNDONE })), "undone");
});

test("18. blocked Undo updates only the augmentation state", () => {
  assert.equal(playerStrikePresentationState(player({ undoBlocked: true })), "undo-blocked");
});

test("19. guarded Undo remains GM-only and setting-gated", () => {
  assert.equal(canShowPlayerStrikeUndo(player(), { isGM: true, undoEnabled: true }), true);
  assert.equal(canShowPlayerStrikeUndo(player(), { isGM: false, undoEnabled: true }), false);
  assert.equal(canShowPlayerStrikeUndo(player(), { isGM: true, undoEnabled: false }), false);
});

test("20. blocked Undo never exposes another control", () => {
  assert.equal(canShowPlayerStrikeUndo(player({ undoBlocked: true }), { isGM: true, undoEnabled: true }), false);
});

test("21. applied amount is visible to the authoritative GM", () => {
  assert.equal(canShowPlayerStrikeAppliedAmount(player(), { isGM: true }), true);
});

test("22. non-GM amount requires access to exact application proof", () => {
  assert.equal(canShowPlayerStrikeAppliedAmount(player(), { isGM: false, canViewMessage: () => false }), false);
  assert.equal(canShowPlayerStrikeAppliedAmount(player(), { isGM: false, canViewMessage: (id) => id === "application" }), true);
});

test("23-28. PC renderer has no replacement Strike summary, Results, Waiting, or damage proxy", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.doesNotMatch(ui, /attackResultLine|strikeLabel|authorizedAttackTotal/);
  assert.doesNotMatch(ui, /resultsControl|RollPopoverController|buildRollInspection/);
  assert.doesNotMatch(ui, /WaitingForDamage|Summary\.Waiting|Waiting for Damage/);
  assert.doesNotMatch(ui, /damageActionControl|activateNativeStrikeDamage|findNativeStrikeDamageControl/);
  assert.doesNotMatch(ui, /data-action=["']strike-damage|\.click\(\)/);
  assert.doesNotMatch(ui, /nelflow-player-strike__damage-action/);
});

test("29. native Damage and Critical Damage clicks are observed without replacement", () => {
  const intent = source("scripts/player-strike-intent.js");
  assert.match(intent, /button\[data-action="strike-damage"\]/);
  assert.match(intent, /addEventListener\("click"[\s\S]*capture: true/);
  assert.doesNotMatch(intent, /preventDefault|stopPropagation|button\.click\(\)/);
});

test("30. renderer appends one deterministic application-status region", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /data-nelflow-application-status/);
  assert.match(ui, /dataset\.nelflowApplicationStatus/);
  assert.equal((ui.match(/append\(status\)/g) ?? []).length, 1);
});

test("31. rerender removes only the prior Nelflow augmentation", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.match(ui, /querySelectorAll\("\[data-nelflow-application-status\]"\)/);
  assert.doesNotMatch(ui, /innerHTML|replaceChildren|removeChild/);
});

test("32. native attack and damage cards bypass Strike compaction", () => {
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(compactor, /usesNativeAugmentedStrikePresentation\(linked\.transaction\)[\s\S]*restoreFullCard\(html\)/);
  assert.match(compactor, /linked\.marker\.role === "application"/);
  assert.doesNotMatch(compactor, /canSuppressPlayerStrikeNativeAttack|nelflowDamageActionable/);
});

test("33. application augmentation never reconstructs native PF2e HTML", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.doesNotMatch(ui, /innerHTML|outerHTML|DOMParser|insertAdjacentHTML/);
  assert.doesNotMatch(ui, /message\.content|message\.flavor/);
});

test("34. application footer does not repeat Strike or damage roll details", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.doesNotMatch(ui, /strikeOutcomeLabel|damageSummary|attack total|damage formula/i);
  assert.match(ui, /Application\.Applied/);
});

test("35. existing exact guarded Undo implementation is reused", () => {
  const ui = source("scripts/player-strike-ui.js");
  const resolver = source("scripts/strike-resolver.js");
  assert.match(ui, /StrikeResolver\.undoFromMessage\(resolved\.attackMessage\)/);
  assert.match(resolver, /preApplication[\s\S]*postApplication/);
  assert.doesNotMatch(ui, /restoreHealth|actor\.update|system\.attributes\.hp/);
});

test("36. exact native click-intent correlation remains intact", () => {
  const intent = source("scripts/player-strike-intent.js");
  const model = source("scripts/player-strike-model.js");
  assert.match(intent, /intentNonce|sourceMessageId|boundDamageMessageId/);
  assert.match(model, /validateCharacterStrikeCorrelation|correlatePlayerStrikeDamage/);
});

test("37. target switching cannot redirect the proven transaction", () => {
  const model = source("scripts/player-strike-model.js");
  const service = source("scripts/player-strike-service.js");
  assert.match(model, /evidence\.targetTokenUuid === snapshot\.targetTokenUuid/);
  assert.match(service, /targetDocument\.disposition|targetToken\.actor\.uuid !== transaction\.snapshot\.targetActorUuid/);
});

test("38. two unresolved hits remain transaction-scoped and ambiguity-safe", () => {
  const service = source("scripts/player-strike-service.js");
  assert.match(service, /waitingTransactions|directCorrelation|enqueue\(owner\.message\.id/);
  assert.match(service, /DAMAGE_AMBIGUOUS|manual-review/);
});

test("39. PF2e remains authoritative for native damage construction and IWR", () => {
  const service = source("scripts/player-strike-service.js");
  const adapter = source("scripts/pf2e-adapter.js");
  assert.match(service, /damageRoll: damage\.roll/);
  assert.match(adapter, /skipIWR: false/);
  assert.doesNotMatch(service, /new\s+(?:Roll|DamageRoll)|damage\.formula/);
});

test("40. character mechanics still deliver NelCine after application", () => {
  const service = source("scripts/player-strike-service.js");
  assert.match(service, /tryDeliverStrikePresentation\(presentationArgs\)/);
  assert.match(service, /tryEmitStrikePresentationFeed\(presentationArgs\)/);
  assert.match(service, /transactionType: "player-strike"/);
  assert.match(service, /impactSyncSelected: false/);
});

test("41. post-application damageApplied emission remains in the shared PF2e adapter", () => {
  const adapter = source("scripts/pf2e-adapter.js");
  assert.match(adapter, /emitDamageAppliedFromApplication/);
  assert.match(adapter, /applyDamageRollToRecordedTarget/);
});

test("42. NPC compact stack path remains independent", () => {
  const resolver = source("scripts/strike-resolver.js");
  const stack = source("scripts/turn-stack-service.js");
  assert.match(resolver, /TurnStackService\.syncTransaction/);
  assert.match(stack, /stackRef|rows/);
});

test("43. NPC Riders remain outside player augmentation", () => {
  const ui = source("scripts/player-strike-ui.js");
  const chat = source("scripts/chat-ui.js");
  assert.doesNotMatch(ui, /Riders|strikeRiders/);
  assert.match(chat, /rider/);
});

test("44. recovery remains separate and fail-open", () => {
  const chat = source("scripts/chat-ui.js");
  assert.match(chat, /renderTransactionRecovery/);
  assert.match(chat, /data-nelflow-application-status/);
  assert.match(chat, /NativeRecordsController\.failOpen/);
});

test("45. 0.14.9 metadata targets the published package", () => {
  const module = JSON.parse(source("module.json"));
  const packageMetadata = JSON.parse(source("package.json"));
  assert.equal(module.id, "nelflow");
  assert.equal(module.version, "0.14.9");
  assert.equal(packageMetadata.version, "0.14.9");
  assert.equal(module.manifest, "https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json");
  assert.equal(module.download, "https://github.com/nelthegm/NelFlow/releases/download/v0.14.9/nelflow.zip");
});

test("46. NelCine strike delivery remains after PC actionable presentation", () => {
  const service = source("scripts/player-strike-service.js");
  const delivery = source("scripts/nelcine-strike-delivery.js");
  assert.match(service, /tryDeliverStrikePresentation/);
  assert.match(delivery, /NELCINE_STRIKE_RESOLVED_HOOK/);
  assert.match(delivery, /nelflow\.strikeResolved/);
});

test("47. NelCine impact and save-batch bridges remain present and exclusive with presentation delivery", () => {
  const delivery = source("scripts/nelcine-strike-delivery.js");
  const impact = source("scripts/nelcine-impact-bridge.js");
  const batch = source("scripts/nelcine-save-batch-bridge.js");
  const resolver = source("scripts/strike-resolver.js");
  assert.match(impact, /nelcine\.strikeImpact/);
  assert.match(batch, /tryEmitToolbeltSaveBatch|tryEmitLegacySaveBatch/);
  assert.match(delivery, /impactSyncSelected/);
  assert.match(resolver, /tryDeliverStrikePresentation|nelcine/);
});

test("48. PC actionable UI does not invent NelCine hooks or impact commits", () => {
  const ui = source("scripts/player-strike-ui.js");
  assert.doesNotMatch(ui, /nelflow\.strikeResolved|nelcine\.strikeImpact|tryDeliverStrikePresentation/);
  assert.doesNotMatch(ui, /commitStrikeApplication|AWAITING_IMPACT/);
});

test("49. player Strike application emits neutral feed then NelCine delivery, without impact-sync by default", () => {
  const service = source("scripts/player-strike-service.js");
  assert.match(service, /tryEmitStrikePresentationFeed\(presentationArgs\)/);
  assert.match(service, /tryDeliverStrikePresentation\(presentationArgs\)/);
  assert.match(service, /impactSyncSelected:\s*false/);
});
