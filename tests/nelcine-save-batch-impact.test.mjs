import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  armPendingSaveBatch,
  broadcastAuthoritativeSaveBatch,
  canUseSaveBatchImpactSync,
  claimPendingBatchResult,
  clearPendingSaveBatches,
  commitPendingBatchResult,
  commitRemainingPreparedResults,
  computeSaveBatchEmergencyTimeoutMs,
  evaluateSaveBatchImpactSyncEligibility,
  finalizePendingBatchResult,
  getPendingImpactBatch,
  getPendingImpactStatus,
  handleSaveBatchImpact,
  lifecycleIdsFromSaveBatchImpact,
  mapSaveBatchImpactSource,
  PREPARED_RESULT_STATES,
  SAVE_BATCH_COMMIT_TRIGGERS,
} from "../scripts/nelcine-save-batch-impact.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

function installMinimalGame({ isGM = true, userId = "gm1", settings = {} } = {}) {
  globalThis.game = {
    user: { id: userId, isGM },
    modules: { get: () => ({ active: settings.nelcineActive === true }) },
    nelcine: settings.nelcineApi ?? null,
    settings: {
      get: (ns, key) => {
        if (ns === "nelflow") return settings[key];
        if (ns === "nelcine") return settings[`nelcine.${key}`];
        return undefined;
      },
    },
    nelflow: {},
  };
}

test.afterEach(() => {
  clearPendingSaveBatches();
  delete globalThis.game;
});

test("1. Sync setting defaults false", () => {
  assert.match(source("scripts/settings.js"), /NELCINE_SAVE_BATCH_IMPACT_SYNC[\s\S]*default:\s*false/);
});

test("2-4. Setting false / baseline path keeps ordinary emit after mechanics", () => {
  const toolbelt = source("scripts/toolbelt-basic-save-service.js");
  assert.match(toolbelt, /tryEmitToolbeltSaveBatch/);
  assert.match(toolbelt, /tryDelayToolbeltBatchForNelcine/);
  assert.match(toolbelt, /if \(delayed\) return/);
  assert.equal(
    evaluateSaveBatchImpactSyncEligibility({ impactSyncEnabled: false }).eligible,
    false,
  );
  assert.equal(
    evaluateSaveBatchImpactSyncEligibility({ impactSyncEnabled: false }).reason,
    "impact-sync-disabled",
  );
});

test("5-13. Eligibility fails open for missing preconditions", () => {
  const base = {
    impactSyncEnabled: true,
    batchCinematicsEnabled: true,
    isGM: true,
    isProcessingGm: true,
    nelcineActive: true,
    hasBroadcastApi: true,
    hasImpactContract: true,
    primaryGmApiAvailable: true,
    isPrimaryGM: true,
    nelcineClientEnabled: true,
    presentationMode: "full",
    supportedWorkflow: true,
    hpAlreadyStarted: false,
    transactionId: "batch-1",
    alreadyPresented: false,
    minimumTargets: 2,
    targetCount: 3,
    saveType: "reflex",
    hasSharedDamageRoll: true,
    hasAuthoritativeDegrees: true,
    hasStableResultIds: true,
  };
  assert.equal(evaluateSaveBatchImpactSyncEligibility(base).eligible, true);
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, nelcineActive: false }).reason, "nelcine-inactive");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, batchCinematicsEnabled: false }).reason, "batch-cinematics-disabled");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, presentationMode: "off" }).reason, "presentation-off");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, hasBroadcastApi: false }).reason, "missing-broadcast-api");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, supportedWorkflow: false }).reason, "unsupported-workflow");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, targetCount: 1 }).reason, "below-minimum-targets");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, hasStableResultIds: false }).reason, "unstable-result-ids");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, hasSharedDamageRoll: false }).reason, "independent-per-target-rolls");
  assert.equal(evaluateSaveBatchImpactSyncEligibility({ ...base, hpAlreadyStarted: true }).reason, "hp-already-started");
});

test("14-19. Preparation arms prepared results without exposing Undo", async () => {
  let commits = 0;
  const batch = armPendingSaveBatch(
    {
      transactionId: "batch-prep",
      workflow: "toolbelt",
      damageMessageId: "dmg1",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [
        { resultId: "r1", targetKey: "a", multiplier: 1 },
        { resultId: "r2", targetKey: "b", multiplier: 0 },
      ],
      commitHandler: async () => {
        commits += 1;
        return { ok: true };
      },
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  assert.equal(batch.results.get("r1").state, PREPARED_RESULT_STATES.PREPARED);
  assert.equal(batch.results.get("r2").state, PREPARED_RESULT_STATES.PREPARED);
  assert.equal(commits, 0);
  const status = (() => {
    installMinimalGame();
    return getPendingImpactStatus();
  })();
  assert.equal(status.pendingBatchCount, 1);
  assert.equal(status.batches[0].preparedCount, 2);
});

test("20-23. Path exclusivity uses broadcastSaveBatch and suppresses ordinary hook", () => {
  const toolbelt = source("scripts/toolbelt-basic-save-service.js");
  const impact = source("scripts/nelcine-save-batch-impact.js");
  assert.match(impact, /broadcastSaveBatch/);
  assert.match(impact, /authoritativeImpacts:\s*true/);
  assert.match(toolbelt, /nelcineSaveBatchEmitted = true/);
  assert.match(toolbelt, /broadcastAuthoritativeSaveBatch/);
  // Synchronized path marks emitted before broadcast so ordinary post-complete
  // tryEmitToolbeltSaveBatch becomes a no-op for that transaction.
  assert.match(toolbelt, /nelcineSaveBatchImpactArmed = true/);
});

test("24-35. Commit claims once and maps triggers", async () => {
  installMinimalGame();
  const seen = [];
  armPendingSaveBatch(
    {
      transactionId: "batch-commit",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [{ resultId: "r1", targetKey: "a" }],
      commitHandler: async ({ trigger }) => {
        seen.push(trigger);
        return { ok: true };
      },
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  assert.equal(mapSaveBatchImpactSource("visual"), SAVE_BATCH_COMMIT_TRIGGERS.VISUAL);
  assert.equal(mapSaveBatchImpactSource("immediate"), SAVE_BATCH_COMMIT_TRIGGERS.IMMEDIATE);
  assert.equal(mapSaveBatchImpactSource("fallback"), SAVE_BATCH_COMMIT_TRIGGERS.FALLBACK);
  assert.equal(await commitPendingBatchResult("batch-commit", "r1", "visual"), true);
  assert.equal(await commitPendingBatchResult("batch-commit", "r1", "visual"), false);
  assert.deepEqual(seen, ["visual"]);
});

test("36-44. Race and duplicate protection", async () => {
  installMinimalGame();
  let commits = 0;
  armPendingSaveBatch(
    {
      transactionId: "batch-race",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [{ resultId: "r1" }],
      commitHandler: async () => {
        commits += 1;
        return { ok: true };
      },
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  const first = claimPendingBatchResult("batch-race", "r1", "visual");
  assert.ok(first);
  assert.equal(claimPendingBatchResult("batch-race", "r1", "nelflow-timeout"), null);
  finalizePendingBatchResult("batch-race", "r1", "committed");
  assert.equal(await handleSaveBatchImpact({
    transactionId: "batch-race",
    resultId: "r1",
    source: "visual",
    senderUserId: "gm1",
  }), false);
  assert.equal(commits, 0);
});

test("45-46. Broadcast failure and timeout commit remaining once", async () => {
  installMinimalGame();
  const triggers = [];
  armPendingSaveBatch(
    {
      transactionId: "batch-fail",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [
        { resultId: "r1" },
        { resultId: "r2" },
      ],
      commitHandler: async ({ trigger, resultId }) => {
        triggers.push(`${resultId}:${trigger}`);
        return { ok: true };
      },
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  await broadcastAuthoritativeSaveBatch({
    payload: { transactionId: "batch-fail" },
    broadcast: async () => {
      throw new Error("boom");
    },
    impactTimeoutMs: 12000,
    transactionId: "batch-fail",
  });
  assert.equal(triggers.length, 2);
  assert.ok(triggers.every((entry) => entry.endsWith(":broadcast-failure")));

  clearPendingSaveBatches();
  const timed = [];
  armPendingSaveBatch(
    {
      transactionId: "batch-timeout",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [{ resultId: "r9" }],
      commitHandler: async ({ trigger }) => {
        timed.push(trigger);
        return { ok: true };
      },
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  await commitRemainingPreparedResults("batch-timeout", SAVE_BATCH_COMMIT_TRIGGERS.TIMEOUT);
  assert.deepEqual(timed, ["nelflow-timeout"]);
});

test("51-56. Authority and payload fields ignored for mechanics", async () => {
  installMinimalGame({ isGM: false, userId: "player1" });
  armPendingSaveBatch(
    {
      transactionId: "batch-auth",
      processingUserId: "gm1",
      impactTimeoutMs: 12000,
      results: [{ resultId: "r1" }],
      commitHandler: async () => ({ ok: true }),
    },
    { onEmergency: () => {}, setTimeoutFn: () => 1 },
  );
  assert.equal(await commitPendingBatchResult("batch-auth", "r1", "visual"), false);

  installMinimalGame({ isGM: true, userId: "gm1" });
  const ids = lifecycleIdsFromSaveBatchImpact({
    transactionId: "batch-auth",
    resultId: "r1",
    source: "visual",
    targetTokenUuid: "Scene.x.Token.forged",
    appliedTotal: 999,
    timestamp: Date.now(),
  });
  assert.equal(ids.transactionId, "batch-auth");
  assert.equal(ids.resultId, "r1");
  assert.equal(await handleSaveBatchImpact({ transactionId: "forged", resultId: "r1" }), false);
  assert.equal(await handleSaveBatchImpact({ transactionId: "batch-auth", resultId: "forged" }), false);
});

test("emergency timeout is later than NelCine impact budget", () => {
  assert.equal(computeSaveBatchEmergencyTimeoutMs(12000), 14000);
});

test("Toolbelt path prepares before HP and guards awaiting-impact controls", () => {
  const toolbelt = source("scripts/toolbelt-basic-save-service.js");
  const guard = source("scripts/toolbelt-control-guard.js");
  const model = source("scripts/toolbelt-basic-save-model.js");
  assert.match(toolbelt, /AWAITING_IMPACT/);
  assert.match(toolbelt, /tryDelayToolbeltBatchForNelcine/);
  assert.match(model, /AWAITING_IMPACT:\s*"awaiting-impact"/);
  assert.match(guard, /AWAITING_IMPACT/);
  assert.match(toolbelt, /reload-during-awaiting-impact/);
});

test("Legacy resolver remains immediate / ordinary presentation when not delayed", () => {
  const legacy = source("scripts/save-resolver-service.js");
  assert.match(legacy, /tryEmitLegacySaveBatch/);
  assert.doesNotMatch(legacy, /tryDelayToolbeltBatchForNelcine|armPendingSaveBatch/);
});

test("Regression: strike impact sync and ordinary batch bridge remain", () => {
  assert.match(source("scripts/nelcine-impact-bridge.js"), /armPendingImpactCommit/);
  assert.match(source("scripts/nelcine-save-batch-bridge.js"), /nelflow\.basicSaveBatchResolved/);
  assert.match(source("scripts/nelcine-strike-delivery.js"), /nelflow\.strikeResolved/);
});

test("Public diagnostics and watchers are installed", () => {
  const impact = source("scripts/nelcine-save-batch-impact.js");
  assert.match(impact, /getPendingImpactStatus/);
  assert.match(impact, /getPendingImpactBatch/);
  assert.match(impact, /watchSaveBatchImpactCommits/);
  assert.match(source("scripts/nelcine-strike-delivery.js"), /installSaveBatchImpactPublicApi/);
});

test("Localization and setting keys exist", () => {
  const lang = JSON.parse(source("lang/en.json"));
  assert.equal(
    lang["Nelflow.Settings.NelcineSaveBatchImpactSync.Name"],
    "Synchronize Basic-Save Damage with NelCine Impacts",
  );
  assert.equal(lang["Nelflow.Toolbelt.State.awaiting-impact"], "Waiting for cinematic impact");
});

test("0.14.13 metadata prepares download URL", () => {
  const module = JSON.parse(source("module.json"));
  const packageMetadata = JSON.parse(source("package.json"));
  assert.equal(module.id, "nelflow");
  assert.equal(module.version, "0.14.13");
  assert.equal(packageMetadata.version, "0.14.13");
  assert.equal(
    module.download,
    "https://github.com/nelthegm/NelFlow/releases/download/v0.14.13/nelflow.zip",
  );
});
