import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TRANSACTION_DIAGNOSTIC_MODES,
  TRANSACTION_STATES,
} from "../scripts/constants.js";
import {
  canShowPlayerStrikeAppliedAmount,
  canShowPlayerStrikeUndo,
  isPlayerStrikePresentationHost,
  playerStrikePresentationCandidates,
  playerStrikePresentationState,
  selectPlayerStrikePresentationHost,
} from "../scripts/player-strike-presentation.js";
import {
  recoveryStatusKey,
  transactionNeedsDiagnosticAttention,
  transactionNeedsRecoveryPresentation,
  visibleDiagnosticDescriptors,
} from "../scripts/transaction-diagnostics-policy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");
const transaction = (changes = {}) => ({
  id: "nelflow-attack",
  transactionType: "player-strike",
  state: TRANSACTION_STATES.APPLIED,
  attackMessageId: "attack",
  damageMessageId: "damage",
  applicationMessageId: "application",
  appliedAmount: 9,
  ...changes,
});
const descriptor = (changes = {}) => ({
  type: "player-strike",
  transaction: transaction(changes),
});

test("successful player Strike selects the native damage card as canonical host", () => {
  assert.equal(selectPlayerStrikePresentationHost(transaction(), () => true), "damage");
});

test("one transaction has exactly one canonical presentation host", () => {
  const current = transaction();
  const visible = new Set(["attack", "damage", "application"]);
  const hosts = [...visible].filter((id) =>
    isPlayerStrikePresentationHost(id, current, (candidate) => visible.has(candidate)));
  assert.deepEqual(hosts, ["damage"]);
});

test("hidden or deleted damage never turns the native attack card into an application host", () => {
  assert.equal(selectPlayerStrikePresentationHost(transaction(), (id) => id === "attack"), null);
});

test("application card is used only when earlier hosts are unavailable", () => {
  assert.equal(
    selectPlayerStrikePresentationHost(transaction(), (id) => id === "application"),
    "application",
  );
});

test("no visible native record produces no presentation host", () => {
  assert.equal(selectPlayerStrikePresentationHost(transaction(), () => false), null);
});

test("canonical selection is deterministic after reload", () => {
  const persisted = JSON.parse(JSON.stringify(transaction()));
  const visible = (id) => id !== "application";
  assert.equal(selectPlayerStrikePresentationHost(persisted, visible), "damage");
  assert.equal(selectPlayerStrikePresentationHost(persisted, visible), "damage");
});

test("duplicate linked IDs are deduplicated without reordering", () => {
  assert.deepEqual(
    playerStrikePresentationCandidates(transaction({ applicationMessageId: "damage" })),
    ["damage"],
  );
});

test("applied player Strike has one legal guarded Undo projection", () => {
  assert.equal(canShowPlayerStrikeUndo(transaction(), { isGM: true, undoEnabled: true }), true);
  assert.equal(canShowPlayerStrikeUndo(transaction(), { isGM: false, undoEnabled: true }), false);
});

test("Undo Blocked is terminal presentation and has no Undo control", () => {
  const blocked = transaction({ undoBlocked: true });
  assert.equal(playerStrikePresentationState(blocked), "undo-blocked");
  assert.equal(canShowPlayerStrikeUndo(blocked, { isGM: true, undoEnabled: true }), false);
});

test("applied amount requires GM access or visibility of the native application record", () => {
  const current = transaction();
  assert.equal(canShowPlayerStrikeAppliedAmount(current, { isGM: true }), true);
  assert.equal(canShowPlayerStrikeAppliedAmount(current, {
    isGM: false,
    canViewMessage: (id) => id === "application",
  }), true);
  assert.equal(canShowPlayerStrikeAppliedAmount(current, {
    isGM: false,
    canViewMessage: () => false,
  }), false);
});

test("legacy policy still treats an ordinary missed Strike as clean terminal data", () => {
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({
    state: TRANSACTION_STATES.SKIPPED,
    failure: { code: "player-strike-not-a-hit" },
  })), false);
});

for (const state of ["failed", "interrupted", "ambiguous", "orphaned", "manual", "partial"]) {
  test(`${state} receives concise recovery presentation`, () => {
    assert.equal(transactionNeedsRecoveryPresentation(descriptor({ state })), true);
  });
}

test("failed Undo and recovery states remain actionable", () => {
  assert.equal(transactionNeedsRecoveryPresentation(descriptor({ undoOperation: { state: "failed" } })), true);
  assert.equal(transactionNeedsRecoveryPresentation(descriptor({ recovery: { status: "available" } })), true);
});

test("non-terminal transactions cannot create a diagnostic flash", () => {
  assert.equal(transactionNeedsRecoveryPresentation(descriptor({ state: "waiting-for-damage" })), false);
  assert.equal(transactionNeedsRecoveryPresentation(descriptor({ state: "applying" })), false);
});

test("recovery status is concise and contains no identifier", () => {
  assert.equal(recoveryStatusKey(descriptor({ state: "interrupted" })), "Nelflow.Recovery.Status.Interrupted");
  assert.equal(recoveryStatusKey(descriptor({ state: "ambiguous" })), "Nelflow.Recovery.Status.Unverified");
  assert.equal(recoveryStatusKey(descriptor({ undoBlocked: true })), "Nelflow.Recovery.Status.UndoUnsafe");
  assert.equal(recoveryStatusKey(descriptor({ presentationError: "internal-exception" })), "Nelflow.Recovery.Status.DisplayIssue");
});

test("legacy diagnostic modes do not mutate persistent diagnostic data", () => {
  const current = descriptor({
    failure: { code: "player-strike-application-failed" },
    audit: [{ event: "application-failed" }],
  });
  const before = JSON.stringify(current);
  assert.deepEqual(visibleDiagnosticDescriptors([current], TRANSACTION_DIAGNOSTIC_MODES.OFF), []);
  assert.equal(visibleDiagnosticDescriptors([current], TRANSACTION_DIAGNOSTIC_MODES.ALWAYS).length, 1);
  assert.equal(JSON.stringify(current), before);
});

test("viewer visibility callback prevents hidden-message hosting", () => {
  const visible = new Set(["attack"]);
  assert.equal(selectPlayerStrikePresentationHost(transaction(), (id) => visible.has(id)), null);
  assert.equal(visible.has("damage"), false);
});

test("presentation cleanup preserves native records and guarded Undo path", () => {
  const playerUi = source("scripts/player-strike-ui.js");
  const chatUi = source("scripts/chat-ui.js");
  assert.match(playerUi, /StrikeResolver\.undoFromMessage\(resolved\.attackMessage\)/);
  assert.doesNotMatch(playerUi, /deleteChatMessage|\.delete\(|\.setFlag\(|\.update\(/);
  assert.match(chatUi, /\["player-strike", "multi-target-strike"\]\.includes/);
});

test("legacy diagnostics setting remains registered but is hidden", () => {
  const settings = source("scripts/settings.js");
  assert.match(settings, /SETTINGS\.SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*scope: "client"/);
  assert.match(settings, /SETTINGS\.SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*restricted: true/);
  assert.match(settings, /default: TRANSACTION_DIAGNOSTIC_MODES\.ERRORS_ONLY,[\s\S]*config: false/);
});

test("successful and failed chat renderers never construct Transaction Details", () => {
  const chatUi = source("scripts/chat-ui.js");
  const playerUi = source("scripts/player-strike-ui.js");
  const recoveryUi = source("scripts/transaction-diagnostics-ui.js");
  const ordinaryChatSources = `${chatUi}\n${playerUi}\n${recoveryUi}`;
  assert.doesNotMatch(ordinaryChatSources, /Nelflow\.Diagnostics\.Details|transactionPanel|transactionDiagnosticProjection/);
  assert.doesNotMatch(recoveryUi, /SHOW_TRANSACTION_DIAGNOSTICS|getSetting/);
  assert.doesNotMatch(recoveryUi, /createElement\("details"\)|element\("details"/);
  assert.match(recoveryUi, /renderTransactionRecovery/);
});

test("NPC stack render starts with synchronous legacy diagnostic cleanup", () => {
  const chatUi = source("scripts/chat-ui.js");
  const start = chatUi.indexOf("export function renderNelflowChat");
  const cleanup = chatUi.indexOf("removeLegacyTransactionDiagnostics(html)", start);
  const autoUi = chatUi.indexOf("renderAutoDamageRoll(message, html)", start);
  assert.equal(cleanup > start && cleanup < autoUi, true);
});

test("no delayed cleanup mechanism is used", () => {
  const sources = `${source("scripts/chat-ui.js")}\n${source("scripts/transaction-diagnostics-ui.js")}`;
  assert.doesNotMatch(sources, /setTimeout|requestAnimationFrame|MutationObserver/);
});

test("legacy diagnostic containers are hidden before first paint", () => {
  const css = source("styles/nelflow.css");
  assert.match(css, /\.nelflow-diagnostics,[\s\S]*\[data-nelflow-transaction-details\][\s\S]*display:\s*none\s*!important/);
});

test("reload and chat history use the same diagnostic-free setup renderer", () => {
  const main = source("scripts/main.js");
  assert.match(main, /Hooks\.once\("setup"[\s\S]*renderChatMessageHTML[\s\S]*renderNelflowChat/);
  const readyIndex = main.indexOf('Hooks.once("ready"');
  assert.equal(main.indexOf("renderChatMessageHTML", readyIndex), -1);
});

test("diagnostic flags, sanitized export, and guarded recovery remain available", () => {
  const service = source("scripts/transaction-diagnostics-service.js");
  const recoveryUi = source("scripts/transaction-diagnostics-ui.js");
  assert.match(service, /export function buildSanitizedDiagnostic/);
  assert.match(service, /static async recover|static recover/);
  assert.match(recoveryUi, /buildSanitizedDiagnostic/);
  assert.match(recoveryUi, /TransactionDiagnosticsService\.recover/);
  assert.match(recoveryUi, /Nelflow\.Recovery\.SupportInfo/);
});

test("application summary and Undo each have one canonical player host", () => {
  const playerUi = source("scripts/player-strike-ui.js");
  assert.equal((playerUi.match(/status\.append\(undo\)/g) ?? []).length, 1);
  assert.equal((playerUi.match(/body\.textContent = applicationText/g) ?? []).length, 1);
  assert.match(playerUi, /data-nelflow-application-status/);
  assert.doesNotMatch(playerUi, /nelflowCanonicalTransaction/);
});

test("linked native application cards use a neutral record label", () => {
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(compactor, /Nelflow\.Native\.ApplicationRecordSummary/);
  assert.doesNotMatch(compactor, /format\("Nelflow\.Native\.ApplicationSummary/);
});

test("native records remain viewer-gated and native documents are not rewritten", () => {
  const chatUi = source("scripts/chat-ui.js");
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(chatUi, /message\?\.visible && message\.isContentVisible/);
  assert.match(compactor, /!message\.visible \|\| !message\.isContentVisible/);
  assert.doesNotMatch(compactor, /\.update\(|\.setFlag\(|deleteChatMessage|\.delete\(/);
});

test("player and NPC presentation omit transaction identifiers from status DOM", () => {
  const sources = `${source("scripts/chat-ui.js")}\n${source("scripts/player-strike-ui.js")}`;
  assert.doesNotMatch(sources, /dataset\.transactionId|nelflowCanonicalTransaction|dataset\.attackMessageId/);
  assert.doesNotMatch(source("scripts/chat-ui.js"), /textContent\s*=\s*row\.presentationError/);
});

test("0.14.9 metadata preserves GitHub distribution structure", () => {
  const module = JSON.parse(source("module.json"));
  const packageMetadata = JSON.parse(source("package.json"));
  assert.equal(module.id, "nelflow");
  assert.equal(module.version, "0.14.9");
  assert.equal(packageMetadata.version, "0.14.9");
  assert.equal(module.manifest, "https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json");
  assert.equal(module.download, "https://github.com/nelthegm/NelFlow/releases/download/v0.14.9/nelflow.zip");
});
