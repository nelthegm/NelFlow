import { TOOLBELT_TARGET_STATES } from "./toolbelt-basic-save-model.js";

const COMPLETE_TARGET_STATES = new Set([
  TOOLBELT_TARGET_STATES.APPLIED,
  TOOLBELT_TARGET_STATES.NO_DAMAGE,
  TOOLBELT_TARGET_STATES.EXTERNAL,
  TOOLBELT_TARGET_STATES.UNDONE,
  TOOLBELT_TARGET_STATES.MANUAL,
  TOOLBELT_TARGET_STATES.ERROR,
  TOOLBELT_TARGET_STATES.RESULT_CHANGED,
]);

/** Pure structured reconciliation: it never reads HTML, rolls, or actor HP. */
export function reconcileToolbeltTransaction(draft, normalized) {
  if (!draft || !normalized?.ok) {
    return { status: normalized?.reason?.includes?.("ambiguous") ? "ambiguous" : "unsupported", reason: normalized?.reason ?? "target-state-missing" };
  }
  if (
    draft.damageMessageId !== normalized.message?.id ||
    draft.sourceActorUuid !== normalized.sourceActorUuid ||
    draft.sourceItemUuid !== normalized.sourceItemUuid ||
    draft.rollIndex !== normalized.rollIndex ||
    draft.saveType !== normalized.saveType
  ) {
    return { status: "ambiguous", reason: "damage-origin-mismatch" };
  }
  if (draft.targetFingerprint !== normalized.targetFingerprint) {
    return { status: "ambiguous", reason: "target-fingerprint-changed" };
  }
  const normalizedOrder = normalized.targets.map((target) => target.toolbeltTargetKey);
  if (JSON.stringify(draft.targetOrder) !== JSON.stringify(normalizedOrder)) {
    return { status: "ambiguous", reason: "target-state-ambiguous" };
  }
  for (const target of normalized.targets) {
    const record = draft.targets?.[target.toolbeltTargetKey];
    if (
      !record ||
      record.tokenUuid !== target.tokenUuid ||
      record.actorUuid !== target.actorUuid ||
      Number(record.rollIndex) !== Number(draft.rollIndex)
    ) {
      return { status: "ambiguous", reason: "target-state-ambiguous" };
    }
  }
  const records = Object.values(draft.targets);
  if (records.every((record) => COMPLETE_TARGET_STATES.has(record.state))) {
    return { status: "already-complete", reason: null };
  }
  if (normalized.targets.some((target) => target.saveState !== "resolved")) {
    return { status: "waiting-for-saves", reason: "save-outcome-incomplete" };
  }
  return { status: "ready-for-application", reason: null };
}

export function guardSupportedByTransaction({ phase, state, hasConclusiveRecord, currentSessionOwned }) {
  if (["manual", "abandoned", "interrupted", "error", "failed"].includes(phase ?? state)) return false;
  return hasConclusiveRecord === true || currentSessionOwned === true;
}
