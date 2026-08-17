import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAudit,
  createFailureRecord,
  ensureRecovery,
  FAILURE_CODES,
  failureCodeFor,
  MAX_AUDIT_ENTRIES,
  recordFailure,
  RECOVERY_STATUSES,
  shortId,
  updateRecovery,
} from "../scripts/transaction-failure.js";
import {
  guardSupportedByTransaction,
  reconcileToolbeltTransaction,
} from "../scripts/transaction-reconciliation.js";
import {
  buildSanitizedDiagnostic,
  copyDiagnosticWithFallback,
  diagnosticDescriptors,
  healthNotificationRequired,
  recoveryRequiresConfirmation,
  TransactionDiagnosticsService,
} from "../scripts/transaction-diagnostics-service.js";
import {
  AUTO_DAMAGE_ROLL_STATES,
  isTerminalAutoDamageState,
  shouldGuardSourceDamageControl,
} from "../scripts/auto-damage-roll-model.js";
import { runNelflowBoundary } from "../scripts/nelflow-boundary.js";

for (const code of FAILURE_CODES) {
  test(`failure code is stable: ${code}`, () => assert.equal(failureCodeFor(code), code));
}

test("unknown failure normalizes to internal-exception", () => {
  assert.equal(failureCodeFor("Private actor exploded at Castle Ravenloft"), "internal-exception");
});

test("known legacy reason maps to stable failure", () => {
  assert.equal(failureCodeFor("native-application-failed"), "application-native-call-failed");
});

test("failure record is JSON serializable", () => {
  const record = createFailureRecord({ code: "damage-message-missing", subsystem: "autoroll" });
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test("failure record shortens complete identifiers", () => {
  const uuid = "Scene.VeryPrivateScene.Token.VeryPrivateToken";
  const record = createFailureRecord({ context: { messageId: uuid, transactionId: uuid } });
  assert.equal(JSON.stringify(record).includes(uuid), false);
});

test("failure record ignores actor names", () => {
  const record = createFailureRecord({ context: { actorName: "Secret Dragon" } });
  assert.equal(JSON.stringify(record).includes("Secret Dragon"), false);
});

test("failure record ignores formulas and totals", () => {
  const record = createFailureRecord({ context: { formula: "20d6", total: 987654321 } });
  assert.equal(JSON.stringify(record).includes("20d6"), false);
  assert.equal(JSON.stringify(record).includes("987654321"), false);
});

test("audit trail is capped", () => {
  const transaction = { revision: 0 };
  for (let index = 0; index < MAX_AUDIT_ENTRIES + 10; index += 1) {
    appendAudit(transaction, { event: `event-${index}`, state: `state-${index}`, subsystem: "test", occurredAt: index });
  }
  assert.equal(transaction.audit.length, MAX_AUDIT_ENTRIES);
  assert.equal(transaction.audit[0].event, "event-10");
});

test("duplicate audit events are not appended", () => {
  const transaction = { revision: 1 };
  appendAudit(transaction, { event: "claimed", state: "claimed", subsystem: "autoroll" });
  appendAudit(transaction, { event: "claimed", state: "claimed", subsystem: "autoroll" });
  assert.equal(transaction.audit.length, 1);
});

test("changed audit state is meaningful", () => {
  const transaction = { revision: 1 };
  appendAudit(transaction, { event: "claimed", state: "claimed", subsystem: "autoroll" });
  appendAudit(transaction, { event: "claimed", state: "rolling", subsystem: "autoroll" });
  assert.equal(transaction.audit.length, 2);
});

test("audit contains no supplied private context", () => {
  const transaction = {};
  appendAudit(transaction, { event: "failed", state: "error", subsystem: "test", actorName: "Hidden" });
  assert.equal(JSON.stringify(transaction.audit).includes("Hidden"), false);
});

test("recordFailure appends safe audit", () => {
  const transaction = { revision: 3, state: "rolling" };
  recordFailure(transaction, { code: "autoroll-interrupted", subsystem: "autoroll", operation: "reload" });
  assert.equal(transaction.failure.code, "autoroll-interrupted");
  assert.equal(transaction.audit.at(-1).safeReason, "autoroll-interrupted");
});

test("recovery defaults to none", () => {
  const transaction = {};
  assert.equal(ensureRecovery(transaction).status, RECOVERY_STATUSES.NONE);
});

test("recovery running records action without user identity", () => {
  const transaction = {};
  updateRecovery(transaction, { status: RECOVERY_STATUSES.RUNNING, action: "rescan-toolbelt-state" });
  assert.equal(transaction.recovery.lastAction, "rescan-toolbelt-state");
  assert.equal("requestedBy" in transaction.recovery, false);
});

test("manual recovery is terminal data", () => {
  const transaction = {};
  updateRecovery(transaction, { status: RECOVERY_STATUSES.MANUAL, action: "mark-manual" });
  assert.equal(transaction.recovery.status, "manual");
  assert.ok(transaction.recovery.completedAt);
});

test("abandoned recovery is terminal data", () => {
  const transaction = {};
  updateRecovery(transaction, { status: RECOVERY_STATUSES.ABANDONED, action: "abandon" });
  assert.equal(transaction.recovery.status, "abandoned");
});

test("shortId never returns full long ID", () => {
  assert.equal(shortId("12345678901234567890"), "1234567890");
});

function target(overrides = {}) {
  return {
    toolbeltTargetKey: "target-key",
    tokenUuid: "Scene.s.Token.t",
    actorUuid: "Actor.a",
    saveState: "resolved",
    ...overrides,
  };
}

function reconciliation(overrides = {}, normalizedOverrides = {}) {
  const normalizedTarget = target(normalizedOverrides.target ?? {});
  const draft = {
    damageMessageId: "damage-1",
    sourceActorUuid: "Actor.source",
    sourceItemUuid: "Actor.source.Item.spell",
    rollIndex: 0,
    saveType: "reflex",
    targetFingerprint: "fingerprint-a",
    targetOrder: ["target-key"],
    targets: {
      "target-key": {
        state: "ready",
        tokenUuid: "Scene.s.Token.t",
        actorUuid: "Actor.a",
        rollIndex: 0,
      },
    },
    ...overrides,
  };
  const normalized = {
    ok: true,
    message: { id: "damage-1" },
    sourceActorUuid: "Actor.source",
    sourceItemUuid: "Actor.source.Item.spell",
    rollIndex: 0,
    saveType: "reflex",
    targetFingerprint: "fingerprint-a",
    targets: [normalizedTarget],
    ...normalizedOverrides,
  };
  return reconcileToolbeltTransaction(draft, normalized);
}

test("structured rescan reports ready-for-application", () => assert.equal(reconciliation().status, "ready-for-application"));
test("structured rescan reports waiting-for-saves", () => assert.equal(reconciliation({}, { target: { saveState: "pending" } }).status, "waiting-for-saves"));
test("structured rescan reports already complete", () => assert.equal(reconciliation({ targets: { "target-key": { state: "applied", tokenUuid: "Scene.s.Token.t", actorUuid: "Actor.a", rollIndex: 0 } } }).status, "already-complete"));
test("unsupported Toolbelt data fails open", () => assert.equal(reconcileToolbeltTransaction({}, { ok: false, reason: "toolbelt-version-unsupported" }).status, "unsupported"));
test("ambiguous Toolbelt data remains ambiguous", () => assert.equal(reconcileToolbeltTransaction({}, { ok: false, reason: "shared-damage-ambiguous" }).status, "ambiguous"));
test("wrong damage message is rejected", () => assert.equal(reconciliation({}, { message: { id: "wrong" } }).reason, "damage-origin-mismatch"));
test("wrong actor candidate is rejected", () => assert.equal(reconciliation({}, { sourceActorUuid: "Actor.other" }).reason, "damage-origin-mismatch"));
test("wrong item candidate is rejected", () => assert.equal(reconciliation({}, { sourceItemUuid: "Actor.source.Item.other" }).reason, "damage-origin-mismatch"));
test("wrong rank-equivalent source context stays structural", () => assert.equal(reconciliation({ sourceItemUuid: "Actor.source.Item.rank3" }, { sourceItemUuid: "Actor.source.Item.rank4" }).status, "ambiguous"));
test("wrong roll index is rejected", () => assert.equal(reconciliation({}, { rollIndex: 1 }).reason, "damage-origin-mismatch"));
test("wrong save type is rejected", () => assert.equal(reconciliation({}, { saveType: "will" }).status, "ambiguous"));
test("changed target fingerprint is rejected", () => assert.equal(reconciliation({}, { targetFingerprint: "fingerprint-b" }).reason, "target-fingerprint-changed"));
test("changed target order is rejected", () => assert.equal(reconciliation({ targetOrder: ["other"] }).reason, "target-state-ambiguous"));
test("missing target record is rejected", () => assert.equal(reconciliation({ targets: {} }).reason, "target-state-ambiguous"));
test("wrong target token is rejected", () => assert.equal(reconciliation({}, { target: { tokenUuid: "Scene.s.Token.other" } }).status, "ambiguous"));
test("wrong target actor is rejected", () => assert.equal(reconciliation({}, { target: { actorUuid: "Actor.other" } }).status, "ambiguous"));
test("reconciliation does not inspect HP", () => assert.equal(JSON.stringify(reconciliation()).includes("hp"), false));
test("manual transaction never supports guard", () => assert.equal(guardSupportedByTransaction({ phase: "manual", hasConclusiveRecord: true }), false));
test("abandoned transaction never supports guard", () => assert.equal(guardSupportedByTransaction({ phase: "abandoned", hasConclusiveRecord: true }), false));
test("interrupted transaction never supports guard", () => assert.equal(guardSupportedByTransaction({ phase: "interrupted", hasConclusiveRecord: true }), false));
test("conclusive completion supports guard", () => assert.equal(guardSupportedByTransaction({ phase: "complete", hasConclusiveRecord: true }), true));
test("current session active operation supports guard", () => assert.equal(guardSupportedByTransaction({ phase: "applying", currentSessionOwned: true }), true));
test("unsupported active operation fails open", () => assert.equal(guardSupportedByTransaction({ phase: "applying", currentSessionOwned: false }), false));

test("completed autoroll with exact message stays guarded", () => {
  assert.equal(shouldGuardSourceDamageControl({ state: "completed", damageMessageId: "damage", guardSourceControl: true, damageActionId: "spell-damage" }), true);
});
test("completed autoroll without exact message fails open", () => {
  assert.equal(shouldGuardSourceDamageControl({ state: "completed", damageMessageId: null, guardSourceControl: true, damageActionId: "spell-damage" }), false);
});
test("current-session rolling autoroll is guarded", () => {
  assert.equal(shouldGuardSourceDamageControl({ state: "rolling", guardSourceControl: true, damageActionId: "spell-damage", activeOperation: { sessionId: "current" } }, "current"), true);
});
test("previous-session rolling autoroll is unguarded", () => {
  assert.equal(shouldGuardSourceDamageControl({ state: "rolling", guardSourceControl: true, damageActionId: "spell-damage", activeOperation: { sessionId: "old" } }, "current"), false);
});
test("manual autoroll is unguarded", () => assert.equal(shouldGuardSourceDamageControl({ state: "manual", guardSourceControl: true, damageActionId: "spell-damage" }), false));
test("abandoned autoroll is unguarded", () => assert.equal(shouldGuardSourceDamageControl({ state: "abandoned", guardSourceControl: true, damageActionId: "spell-damage" }), false));
test("manual override restores source control", () => assert.equal(shouldGuardSourceDamageControl({ state: "completed", damageMessageId: "d", guardSourceControl: true, damageActionId: "spell-damage", manualRollEnabled: true }), false));
test("Manual autoroll state is terminal", () => assert.equal(isTerminalAutoDamageState(AUTO_DAMAGE_ROLL_STATES.MANUAL), true));
test("Abandoned autoroll state is terminal", () => assert.equal(isTerminalAutoDamageState(AUTO_DAMAGE_ROLL_STATES.ABANDONED), true));
test("Interrupted autoroll state is terminal", () => assert.equal(isTerminalAutoDamageState(AUTO_DAMAGE_ROLL_STATES.INTERRUPTED), true));

function installGame({ isGM = true } = {}) {
  globalThis.game = {
    version: "14.331",
    release: { version: "14.331" },
    system: { id: "pf2e", version: "8.3.0" },
    user: { id: "gm-user", isGM },
    users: new Map([
      ["gm-user", { id: "gm-user", isGM: true }],
      ["player-user", { id: "player-user", isGM: false }],
    ]),
    modules: new Map([
      ["nelflow", { active: true, version: "0.5.1" }],
      ["pf2e-toolbelt", { active: true, version: "3.52.1" }],
      ["dice-so-nice", { active: true, version: "5.0.0" }],
      ["monks-combat-details", { active: true, version: "13.1" }],
    ]),
    settings: {
      get: (module, key) => module === "pf2e-toolbelt" && key === "betterChat.enabled"
        ? true
        : ({
            basicSaveWorkflow: "toolbelt",
            toolbeltBasicSaveSources: "spells-and-npc-abilities",
            automaticBasicSaveDamageRoll: "all",
            toolbeltBasicSaveApplication: "all-resolved",
            compactTurnStacks: "npc-strikes",
            collapseLinkedNativeCards: true,
          }[key] ?? false),
    },
    messages: new Map(),
  };
}

function descriptor() {
  const transaction = {
    integrationId: "auto-damage-roll:FULL-PRIVATE-INTEGRATION-ID",
    sourceMessageId: "FULL-PRIVATE-SOURCE-MESSAGE-ID",
    damageMessageId: "FULL-PRIVATE-DAMAGE-MESSAGE-ID",
    sourceKind: "spell",
    sourceUserId: "player-user",
    rollingUserId: "player-user",
    state: "completed",
    revision: 7,
    targetTokenUuids: ["Scene.Secret.Token.Target"],
    actorName: "Secret Dragon",
    itemName: "Secret Fireball",
    formula: "20d6[fire]",
    total: 987654321,
    flags: { private: true },
    guardSourceControl: true,
    manualRollEnabled: false,
    audit: [{ revision: 7, event: "damage-message-linked", state: "completed", subsystem: "autoroll", occurredAt: 1, userRole: "player", safeReason: null }],
  };
  return {
    type: "autoroll",
    id: transaction.integrationId,
    transaction,
    ownerMessage: { id: transaction.sourceMessageId },
  };
}

test("diagnostic export contains environment versions", () => {
  installGame();
  const diagnostic = buildSanitizedDiagnostic(descriptor());
  assert.equal(diagnostic.environment.systemVersion, "8.3.0");
  assert.equal(diagnostic.environment.nelflowVersion, "0.5.1");
  assert.equal(diagnostic.environment.toolbeltVersion, "3.52.1");
});

test("diagnostic export excludes actor names", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes("Secret Dragon"), false);
});
test("diagnostic export excludes item names", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes("Secret Fireball"), false);
});
test("diagnostic export excludes formulas", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes("20d6"), false);
});
test("diagnostic export excludes private totals", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes("987654321"), false);
});
test("diagnostic export excludes raw flags", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes('"flags"'), false);
});
test("diagnostic export excludes complete target identities", () => {
  installGame();
  assert.equal(JSON.stringify(buildSanitizedDiagnostic(descriptor())).includes("Scene.Secret.Token.Target"), false);
});
test("diagnostic export shortens message IDs", () => {
  installGame();
  const json = JSON.stringify(buildSanitizedDiagnostic(descriptor()));
  assert.equal(json.includes("FULL-PRIVATE-SOURCE-MESSAGE-ID"), false);
  assert.equal(json.includes("MESSAGE-ID"), true);
});
test("diagnostic export includes external module versions safely", () => {
  installGame();
  const modules = buildSanitizedDiagnostic(descriptor()).environment.externalModules;
  assert.equal(modules.some((entry) => entry.id === "monks-combat-details" && entry.version === "13.1"), true);
});
test("diagnostic export includes Better Chat and Dice So Nice state", () => {
  installGame();
  const environment = buildSanitizedDiagnostic(descriptor()).environment;
  assert.equal(environment.betterChatMessageActive, true);
  assert.equal(environment.diceSoNiceActive, true);
});
test("diagnostic export is serializable", () => {
  installGame();
  assert.doesNotThrow(() => JSON.stringify(buildSanitizedDiagnostic(descriptor())));
});

test("clipboard success does not open fallback", async () => {
  let fallback = false;
  const result = await copyDiagnosticWithFallback("{}", { writeText: async () => undefined, showFallback: async () => { fallback = true; } });
  assert.deepEqual({ ...result, fallbackCalled: fallback }, { copied: true, fallback: false, fallbackCalled: false });
});
test("clipboard failure opens safe fallback", async () => {
  let fallbackValue = null;
  const result = await copyDiagnosticWithFallback("{\"safe\":true}", { writeText: async () => { throw new Error("denied"); }, showFallback: async (value) => { fallbackValue = value; } });
  assert.equal(result.fallback, true);
  assert.equal(fallbackValue, "{\"safe\":true}");
});

test("diagnostic descriptor access is GM-only", () => {
  installGame({ isGM: false });
  const message = { getFlag: () => { throw new Error("player must not inspect flags"); } };
  assert.deepEqual(diagnosticDescriptors(message), []);
});
test("player recovery request is rejected before mutation", async () => {
  installGame({ isGM: false });
  assert.equal((await TransactionDiagnosticsService.recover(descriptor(), "mark-manual")).result, "unauthorized");
});
test("abandon requires confirmation", () => assert.equal(recoveryRequiresConfirmation("abandon"), true));
test("existing damage link requires confirmation", () => assert.equal(recoveryRequiresConfirmation("use-existing-damage"), true));
test("clear guard does not require destructive confirmation", () => assert.equal(recoveryRequiresConfirmation("clear-guard"), false));
test("health notification is GM-only", () => assert.equal(healthNotificationRequired({ isGM: false, count: 3, alreadyNotified: false }), false));
test("health notification appears for review work", () => assert.equal(healthNotificationRequired({ isGM: true, count: 1, alreadyNotified: false }), true));
test("health notification appears once", () => assert.equal(healthNotificationRequired({ isGM: true, count: 1, alreadyNotified: true }), false));
test("no health notification when no review is needed", () => assert.equal(healthNotificationRequired({ isGM: true, count: 0, alreadyNotified: false }), false));

test("hook boundary exception becomes safe failure", async () => {
  installGame();
  globalThis.ui = { notifications: { warn: () => undefined } };
  const { resetNelflowBoundaryDiagnosticsForTests } = await import("../scripts/nelflow-boundary.js");
  resetNelflowBoundaryDiagnosticsForTests();
  const result = await runNelflowBoundary({ subsystem: "test-hook", operation: "create-message", messageId: "message-1", task: async () => { throw new Error("Secret actor formula 20d6"); } });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "internal-exception");
  assert.equal(JSON.stringify(result.failure).includes("Secret actor"), false);
});
test("hook boundary does not reject", async () => {
  installGame();
  globalThis.ui = { notifications: { warn: () => undefined } };
  const { resetNelflowBoundaryDiagnosticsForTests } = await import("../scripts/nelflow-boundary.js");
  resetNelflowBoundaryDiagnosticsForTests();
  await assert.doesNotReject(() => runNelflowBoundary({ subsystem: "test", operation: "update", task: async () => { throw new Error("boom"); } }));
});
test("hook boundary records through callback", async () => {
  installGame();
  globalThis.ui = { notifications: { warn: () => undefined } };
  const { resetNelflowBoundaryDiagnosticsForTests } = await import("../scripts/nelflow-boundary.js");
  resetNelflowBoundaryDiagnosticsForTests();
  let recorded = null;
  await runNelflowBoundary({ subsystem: "test", operation: "update", task: async () => { throw new Error("boom"); }, onFailure: async (failure) => { recorded = failure; } });
  assert.equal(recorded.code, "internal-exception");
});
