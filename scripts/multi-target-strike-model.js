import {
  DEGREE_OF_SUCCESS,
  MULTI_TARGET_STRIKE_MODES,
  MULTI_TARGET_STRIKE_SCHEMA_VERSION,
} from "./constants.js";

export const MULTI_TARGET_STRIKE_TRANSACTION_TYPE = "multi-target-strike";
export const MULTI_TARGET_CAPTURE_FLAG = "multiTargetStrikeCapture";
export const MULTI_TARGET_CAPTURE_MAX_AGE_MS = 30_000;

const OUTCOME_INDEX = new Map(DEGREE_OF_SUCCESS.map((outcome, index) => [outcome, index]));
const HIT_OUTCOMES = new Set(["success", "criticalSuccess"]);

export function multiTargetModeAllows(mode, actorType) {
  if (mode === MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES) {
    return actorType === "npc" || actorType === "character";
  }
  return mode === MULTI_TARGET_STRIKE_MODES.NPC_STRIKES && actorType === "npc";
}

export function deduplicateTargetSnapshots(targets) {
  const unique = [];
  const seen = new Set();
  for (const target of targets ?? []) {
    const document = target?.document ?? target;
    const actor = target?.actor ?? document?.actor;
    if (!document?.uuid || !actor?.uuid || seen.has(document.uuid)) continue;
    seen.add(document.uuid);
    unique.push({
      order: unique.length,
      tokenUuid: document.uuid,
      actorUuid: actor.uuid,
      sceneId: document.parent?.id ?? null,
      disposition: Number.isFinite(document.disposition) ? document.disposition : null,
    });
  }
  return unique;
}

function clampDegree(value) {
  return Math.max(0, Math.min(3, value));
}

function applyDegreeAmount(degree, amount) {
  if (OUTCOME_INDEX.has(amount)) return OUTCOME_INDEX.get(amount);
  return Number.isFinite(amount) ? clampDegree(degree + amount) : degree;
}

/** Pure mirror of PF2e 8.3's documented DegreeOfSuccess ordering. */
export function degreeOfSuccess({ total, dc, dieValue, adjustments = null }) {
  if (![total, dc, dieValue].every(Number.isFinite)) return null;
  let degree = total - dc >= 10 ? 3 : dc - total >= 10 ? 0 : total >= dc ? 2 : 1;
  degree = dieValue === 20 ? clampDegree(degree + 1) : dieValue === 1 ? clampDegree(degree - 1) : degree;
  const unadjusted = DEGREE_OF_SUCCESS[degree];
  for (const key of ["all", ...DEGREE_OF_SUCCESS]) {
    const adjustment = adjustments?.[key];
    if (!adjustment || (key !== "all" && key !== unadjusted)) continue;
    degree = applyDegreeAmount(degree, adjustment.amount);
    break;
  }
  return { outcome: DEGREE_OF_SUCCESS[degree], unadjustedOutcome: unadjusted };
}

export function mergeDegreeAdjustments(adjustments, rollOptions) {
  const record = {};
  for (const adjustment of adjustments ?? []) {
    if (adjustment?.predicate?.test?.(rollOptions) === false) continue;
    for (const key of ["all", ...DEGREE_OF_SUCCESS]) {
      if (adjustment?.adjustments?.[key]) record[key] = structuredClone(adjustment.adjustments[key]);
    }
  }
  return record;
}

export function groupTargetOutcomes(children) {
  return {
    normal: (children ?? []).filter((child) => child.outcome === "success" && !child.flatCheckFailed),
    critical: (children ?? []).filter(
      (child) => child.outcome === "criticalSuccess" && !child.flatCheckFailed,
    ),
  };
}

export function batchState(children) {
  const states = new Set((children ?? []).map((child) => child.state));
  if (states.has("resolving") || states.has("applying")) return "processing";
  if (states.has("review")) return "manual";
  if (states.has("applied")) return "applied";
  if (states.has("damage-rolled")) return "damage-rolled";
  if (states.size && [...states].every((state) => ["miss", "undone", "undo-blocked"].includes(state))) {
    return states.has("undo-blocked") ? "manual" : states.has("undone") ? "undone" : "skipped";
  }
  return "failed";
}

export function canUndoBatchChild(child) {
  return Boolean(
    child?.state === "applied" &&
      child.undoBlocked !== true &&
      child.undoEligible === true &&
      child.preApplication &&
      child.postApplication,
  );
}

export function makeBatchTransaction({ attackMessageId, snapshot, targets, createdAt = Date.now() }) {
  const id = `nelflow-${attackMessageId}`;
  return {
    id,
    role: "attack",
    transactionType: MULTI_TARGET_STRIKE_TRANSACTION_TYPE,
    schemaVersion: MULTI_TARGET_STRIKE_SCHEMA_VERSION,
    state: "processing",
    attackMessageId,
    damageMessageId: null,
    applicationMessageId: null,
    stackRef: null,
    snapshot: { ...snapshot, targets: targets.map((target) => ({ ...target })) },
    targets: targets.map((target, index) => ({
      key: `${index + 1}`,
      order: index,
      ...target,
      ac: null,
      outcome: null,
      unadjustedOutcome: null,
      flatCheck: null,
      flatCheckFailed: false,
      damageCategory: "none",
      damageMessageId: null,
      applicationMessageId: null,
      damageSummary: null,
      preApplication: null,
      postApplication: null,
      appliedAmount: null,
      appliedSequence: null,
      state: "resolving",
      undoBlocked: false,
      undoEligible: false,
      reviewReason: null,
    })),
    damageGroups: {
      normal: { state: "pending", damageMessageId: null, damageSummary: null },
      critical: { state: "pending", damageMessageId: null, damageSummary: null },
    },
    linkedMessageIds: [attackMessageId],
    activeOperation: {
      ownerUserId: snapshot.processingUserId,
      enteredRevision: 1,
      sessionId: snapshot.sessionId ?? null,
    },
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  };
}

export function targetIsHit(child) {
  return HIT_OUTCOMES.has(child?.outcome) && !child.flatCheckFailed;
}

export function multiTargetPresentationHost(transaction, canViewMessage) {
  return (transaction?.linkedMessageIds ?? []).find((messageId) => canViewMessage(messageId)) ?? null;
}

export function validCapture(capture, { now = Date.now() } = {}) {
  const targets = Array.isArray(capture?.targets) ? capture.targets : [];
  const tokenUuids = new Set(targets.map((target) => target?.tokenUuid));
  const exactTargets = targets.every((target, index) =>
    target?.order === index &&
    typeof target.tokenUuid === "string" &&
    target.tokenUuid.length > 0 &&
    typeof target.actorUuid === "string" &&
    target.actorUuid.length > 0 &&
    (target.sceneId === null || typeof target.sceneId === "string"),
  );
  return Boolean(
    capture?.schemaVersion === MULTI_TARGET_STRIKE_SCHEMA_VERSION &&
      targets.length >= 2 &&
      tokenUuids.size === targets.length &&
      exactTargets &&
      Number.isFinite(capture.capturedAt) &&
      now - capture.capturedAt <= MULTI_TARGET_CAPTURE_MAX_AGE_MS,
  );
}
