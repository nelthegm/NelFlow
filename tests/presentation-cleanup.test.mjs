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
  transactionNeedsDiagnosticAttention,
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

test("hidden or deleted damage falls back to the visible attack card", () => {
  assert.equal(
    selectPlayerStrikePresentationHost(transaction(), (id) => id === "attack"),
    "attack",
  );
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
    ["damage", "attack"],
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

test("Errors Only hides cleanly applied Transaction Details", () => {
  assert.deepEqual(
    visibleDiagnosticDescriptors([descriptor()], TRANSACTION_DIAGNOSTIC_MODES.ERRORS_ONLY),
    [],
  );
});

test("Errors Only treats an ordinary missed Strike as clean terminal presentation", () => {
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({
    state: TRANSACTION_STATES.SKIPPED,
    failure: { code: "player-strike-not-a-hit" },
  })), false);
});

for (const state of ["failed", "interrupted", "ambiguous", "orphaned", "manual", "partial"]) {
  test(`Errors Only exposes ${state} Transaction Details`, () => {
    assert.equal(transactionNeedsDiagnosticAttention(descriptor({ state })), true);
  });
}

test("Errors Only exposes failed Undo and recovery states", () => {
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({ undoOperation: { state: "failed" } })), true);
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({ recovery: { status: "available" } })), true);
});

test("Errors Only exposes non-terminal transactions", () => {
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({ state: "waiting-for-damage" })), true);
  assert.equal(transactionNeedsDiagnosticAttention(descriptor({ state: "applying" })), true);
});

test("Always preserves diagnostic disclosure", () => {
  const descriptors = [descriptor(), descriptor({ id: "second", state: "failed" })];
  assert.equal(
    visibleDiagnosticDescriptors(descriptors, TRANSACTION_DIAGNOSTIC_MODES.ALWAYS).length,
    2,
  );
});

test("Off hides disclosure without mutating diagnostic data", () => {
  const current = descriptor({
    failure: { code: "player-strike-application-failed" },
    audit: [{ event: "application-failed" }],
  });
  const before = JSON.stringify(current);
  assert.deepEqual(visibleDiagnosticDescriptors([current], TRANSACTION_DIAGNOSTIC_MODES.OFF), []);
  assert.equal(JSON.stringify(current), before);
});

test("viewer visibility callback prevents hidden-message hosting", () => {
  const visible = new Set(["attack"]);
  assert.equal(selectPlayerStrikePresentationHost(transaction(), (id) => visible.has(id)), "attack");
  assert.equal(visible.has("damage"), false);
});

test("presentation cleanup preserves native records and guarded Undo path", () => {
  const playerUi = source("scripts/player-strike-ui.js");
  const chatUi = source("scripts/chat-ui.js");
  assert.match(playerUi, /StrikeResolver\.undoFromMessage\(resolved\.attackMessage\)/);
  assert.doesNotMatch(playerUi, /deleteChatMessage|\.delete\(|\.setFlag\(|\.update\(/);
  assert.match(chatUi, /transactionType === "player-strike"\) return/);
});

test("diagnostics setting is client scoped and defaults to Errors Only", () => {
  const settings = source("scripts/settings.js");
  assert.match(settings, /SETTINGS\.SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*scope: "client"/);
  assert.match(settings, /SETTINGS\.SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*restricted: true/);
  assert.match(settings, /default: TRANSACTION_DIAGNOSTIC_MODES\.ERRORS_ONLY/);
});

test("0.6.4 metadata preserves GitHub distribution structure", () => {
  const module = JSON.parse(source("module.json"));
  const packageMetadata = JSON.parse(source("package.json"));
  assert.equal(module.id, "nelflow");
  assert.equal(module.version, "0.6.4");
  assert.equal(packageMetadata.version, "0.6.4");
  assert.equal(module.manifest, "https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json");
  assert.equal(module.download, "https://github.com/nelthegm/NelFlow/releases/download/v0.6.4-rc1/nelflow.zip");
});
