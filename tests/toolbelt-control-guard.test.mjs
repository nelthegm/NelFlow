import assert from "node:assert/strict";
import test from "node:test";
import {
  guardIdentityMatches,
  isConclusiveGuardRecord,
  isDamageApplicationControl,
  recordProvesPriorApplication,
  shouldGuardDamageControls,
} from "../scripts/toolbelt-control-guard.js";
import { TOOLBELT_TARGET_STATES as S } from "../scripts/toolbelt-basic-save-model.js";

const record = (state, extra = {}) => ({ state, applicationId: "app-a", ...extra });
const appliedProof = { preApplicationHp: 30, postApplicationHp: 20, applicationId: "app-a" };
const identity = {
  messageId: "m1",
  targetKey: "target-a",
  tokenUuid: "Scene.s.Token.a",
  actorUuid: "Actor.a",
  rollIndex: 0,
  applicationId: "app-a",
};

test("Damage is recognized", () => assert.equal(isDamageApplicationControl("target-applyDamage", 1), true));
test("Half is recognized", () => assert.equal(isDamageApplicationControl("target-applyDamage", 0.5), true));
test("Double is recognized", () => assert.equal(isDamageApplicationControl("target-applyDamage", 2), true));
test("Triple is recognized", () => assert.equal(isDamageApplicationControl("target-applyDamage", 3), true));
test("string multiplier is normalized", () => assert.equal(isDamageApplicationControl("target-applyDamage", "0.5"), true));
test("zero multiplier is not a damage control", () => assert.equal(isDamageApplicationControl("target-applyDamage", 0), false));
test("unknown multiplier fails open", () => assert.equal(isDamageApplicationControl("target-applyDamage", 4), false));
test("Shield Block remains enabled", () => assert.equal(isDamageApplicationControl("target-shieldBlock", 1), false));
test("save control remains enabled", () => assert.equal(isDamageApplicationControl("roll-save", 1), false));
test("reroll control remains enabled", () => assert.equal(isDamageApplicationControl("reroll-save", 1), false));
test("ping control remains enabled", () => assert.equal(isDamageApplicationControl("ping-target", 1), false));
test("details control remains enabled", () => assert.equal(isDamageApplicationControl("show-details", 1), false));

test("applied target is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.APPLIED)), true));
test("critical success no damage is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.NO_DAMAGE)), true));
test("external application needs current Toolbelt marker", () => assert.equal(isConclusiveGuardRecord(record(S.EXTERNAL)), false));
test("external application with marker is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.EXTERNAL), { toolbeltApplied: true }), true));
test("result changed after application remains conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.RESULT_CHANGED)), true));
test("Undo Blocked with application proof is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.UNDO_BLOCKED, appliedProof)), true));
test("Undo Blocked without application proof fails open", () => assert.equal(isConclusiveGuardRecord(record(S.UNDO_BLOCKED)), false));
test("interrupted with application proof is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.INTERRUPTED, appliedProof)), true));
test("interrupted without application proof fails open", () => assert.equal(isConclusiveGuardRecord(record(S.INTERRUPTED)), false));
test("manual review with application proof is conclusive", () => assert.equal(isConclusiveGuardRecord(record(S.MANUAL, { ...appliedProof, reason: "manual-review-required" })), true));
test("ordinary manual state fails open", () => assert.equal(isConclusiveGuardRecord(record(S.MANUAL, appliedProof)), false));
test("pending save fails open", () => assert.equal(isConclusiveGuardRecord(record(S.PENDING_SAVE)), false));
test("ready target fails open", () => assert.equal(isConclusiveGuardRecord(record(S.READY)), false));
test("claimed target fails open", () => assert.equal(isConclusiveGuardRecord(record(S.CLAIMED)), false));
test("applying target fails open", () => assert.equal(isConclusiveGuardRecord(record(S.APPLYING)), false));
test("error target fails open", () => assert.equal(isConclusiveGuardRecord(record(S.ERROR)), false));
test("successful Undo restores controls", () => assert.equal(isConclusiveGuardRecord(record(S.UNDONE, appliedProof)), false));
test("missing record fails open", () => assert.equal(isConclusiveGuardRecord(null), false));

test("applied record is guarded by default", () => assert.equal(shouldGuardDamageControls(record(S.APPLIED)), true));
test("manual override releases an applied record", () => assert.equal(shouldGuardDamageControls(record(S.APPLIED, { manualControlsEnabled: true })), false));
test("re-guard restores an applied record", () => assert.equal(shouldGuardDamageControls(record(S.APPLIED, { manualControlsEnabled: false })), true));
test("legacy record without override field is guarded", () => assert.equal(shouldGuardDamageControls(record(S.APPLIED)), true));
test("application proof requires both snapshots", () => assert.equal(recordProvesPriorApplication({ preApplicationHp: 20, applicationId: "a" }), false));
test("application proof accepts zero HP", () => assert.equal(recordProvesPriorApplication({ preApplicationHp: 1, postApplicationHp: 0, applicationId: "a" }), true));

test("exact identity matches", () => assert.equal(guardIdentityMatches(identity, { ...identity }), true));
test("different message is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, messageId: "m2" }), false));
test("different target key is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, targetKey: "target-b" }), false));
test("same actor different token is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, tokenUuid: "Scene.s.Token.b" }), false));
test("different actor is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, actorUuid: "Actor.b" }), false));
test("different roll index is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, rollIndex: 1 }), false));
test("different application ID is isolated", () => assert.equal(guardIdentityMatches(identity, { ...identity, applicationId: "app-b" }), false));
test("numeric string roll index is equivalent", () => assert.equal(guardIdentityMatches({ ...identity, rollIndex: "0" }, identity), true));
test("missing identity fails open", () => assert.equal(guardIdentityMatches(null, identity), false));
