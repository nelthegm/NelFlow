/**
 * NelCine impact commit bridge tests (Slice 1D-B).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  COMMIT_TRIGGERS,
  armPendingImpactCommit,
  claimPendingImpactCommit,
  clampImpactTimeoutMs,
  clearAllPendingImpactCommits,
  computeEmergencyCommitTimeoutMs,
  evaluateNelcineImpactEligibility,
  hasPendingImpactCommit,
  transactionIdFromImpact,
} from "../scripts/nelcine-impact-bridge.js";

describe("nelcine impact bridge", () => {
  beforeEach(() => {
    clearAllPendingImpactCommits();
  });

  it("clamps impact timeout to 500–15000", () => {
    assert.equal(clampImpactTimeoutMs(100), 500);
    assert.equal(clampImpactTimeoutMs(20000), 15000);
    assert.equal(clampImpactTimeoutMs(5000), 5000);
  });

  it("computes emergency timeout as impact + 1500 within 2000–18000", () => {
    assert.equal(computeEmergencyCommitTimeoutMs(500), 2000);
    assert.equal(computeEmergencyCommitTimeoutMs(5000), 6500);
    assert.equal(computeEmergencyCommitTimeoutMs(15000), 16500);
  });

  it("requires every eligibility gate", () => {
    const base = {
      settingEnabled: true,
      isGM: true,
      nelcineActive: true,
      hasBroadcastApi: true,
      hasImpactContract: true,
      isPrimaryGM: true,
      nelcineClientEnabled: true,
      presentationMode: "full",
      canvasReady: true,
      activeSceneId: "sc1",
      targetSceneId: "sc1",
      outcome: "success",
      hasAuthoritativeDamage: true,
      damageTotal: 18,
      supportsDelayedCommit: true,
    };
    assert.equal(evaluateNelcineImpactEligibility(base).eligible, true);
    assert.equal(evaluateNelcineImpactEligibility({ ...base, settingEnabled: false }).reason, "setting-disabled");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, presentationMode: "off" }).reason, "presentation-off");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, isPrimaryGM: false }).reason, "not-primary-gm");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, nelcineActive: false }).reason, "nelcine-inactive");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, outcome: "failure" }).reason, "non-hit-outcome");
    assert.equal(evaluateNelcineImpactEligibility({ ...base, damageTotal: NaN }).reason, "non-finite-damage-total");
    assert.equal(
      evaluateNelcineImpactEligibility({ ...base, activeSceneId: "other" }).reason,
      "scene-mismatch",
    );
  });

  it("claims pending commits exactly once", () => {
    const emergencies = [];
    armPendingImpactCommit(
      {
        transactionId: "nelflow-msg1",
        attackMessageId: "msg1",
        damageMessageId: "dmg1",
        targetTokenUuid: "Scene.sc1.Token.t1",
        preApplication: { hp: 40, tempHp: 0 },
        impactTimeoutMs: 1000,
      },
      {
        onEmergency: (id) => emergencies.push(id),
        setTimeoutFn: () => 1,
      },
    );
    assert.equal(hasPendingImpactCommit("nelflow-msg1"), true);
    const first = claimPendingImpactCommit("nelflow-msg1", COMMIT_TRIGGERS.IMPACT);
    const second = claimPendingImpactCommit("nelflow-msg1", COMMIT_TRIGGERS.TIMEOUT);
    assert.equal(first.triggerSource, COMMIT_TRIGGERS.IMPACT);
    assert.equal(second, null);
    assert.equal(hasPendingImpactCommit("nelflow-msg1"), false);
    assert.equal(emergencies.length, 0);
  });

  it("emergency timer invokes timeout callback when not claimed", () => {
    const emergencies = [];
    const timers = [];
    armPendingImpactCommit(
      {
        transactionId: "nelflow-msg2",
        attackMessageId: "msg2",
        damageMessageId: "dmg2",
        targetTokenUuid: "Scene.sc1.Token.t1",
        preApplication: { hp: 10, tempHp: 0 },
        impactTimeoutMs: 500,
      },
      {
        onEmergency: (id) => emergencies.push(id),
        setTimeoutFn: (fn) => {
          timers.push(fn);
          return 99;
        },
      },
    );
    assert.equal(timers.length, 1);
    timers[0]();
    assert.deepEqual(emergencies, ["nelflow-msg2"]);
  });

  it("reads only transactionId from impact payloads", () => {
    assert.equal(
      transactionIdFromImpact({
        transactionId: "nelflow-x",
        presentation: { damageTotal: 999 },
      }),
      "nelflow-x",
    );
    assert.equal(transactionIdFromImpact({ presentation: { damageTotal: 1 } }), null);
  });
});
