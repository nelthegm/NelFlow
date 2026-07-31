export const TOOLBELT_TARGET_STATES = Object.freeze({
  PENDING_SAVE: "pending-save",
  READY: "ready",
  CLAIMED: "claimed",
  APPLYING: "applying",
  APPLIED: "applied",
  NO_DAMAGE: "no-damage",
  MANUAL: "manual",
  INTERRUPTED: "interrupted",
  ERROR: "error",
  UNDONE: "undone",
  UNDO_BLOCKED: "undo-blocked",
  EXTERNAL: "external-application-detected",
  RESULT_CHANGED: "result-changed-after-application",
});

export const TERMINAL_TOOLBELT_STATES = new Set([
  TOOLBELT_TARGET_STATES.APPLIED,
  TOOLBELT_TARGET_STATES.NO_DAMAGE,
  TOOLBELT_TARGET_STATES.MANUAL,
  TOOLBELT_TARGET_STATES.INTERRUPTED,
  TOOLBELT_TARGET_STATES.ERROR,
  TOOLBELT_TARGET_STATES.UNDONE,
  TOOLBELT_TARGET_STATES.UNDO_BLOCKED,
  TOOLBELT_TARGET_STATES.EXTERNAL,
  TOOLBELT_TARGET_STATES.RESULT_CHANGED,
]);

export function outcomeMultiplier(outcome) {
  return {
    criticalSuccess: 0,
    success: 0.5,
    failure: 1,
    criticalFailure: 2,
  }[outcome] ?? null;
}

export function applicationId(integrationId, toolbeltTargetKey) {
  return `${integrationId}:target:${toolbeltTargetKey}`;
}

export function integrationId(messageId) {
  return `toolbelt-basic-save:${messageId}`;
}

export function allPrimarySavesResolved(targets) {
  return targets.length > 0 && targets.every((target) => target.saveState === "resolved");
}

export function eligibleTargetKeys(targets, mode) {
  if (mode === "off" || mode === "gm-confirm") return [];
  if (mode === "all-resolved" && !allPrimarySavesResolved(targets)) return [];
  return targets.filter((target) => target.saveState === "resolved").map((target) => target.toolbeltTargetKey);
}

export function targetResultChanged(record, normalized) {
  return Boolean(
    record?.toolbeltStateFingerprint &&
      normalized?.saveFingerprint &&
      record.toolbeltStateFingerprint !== normalized.saveFingerprint,
  );
}

export function isReplaySafe(record) {
  return !record || (!TERMINAL_TOOLBELT_STATES.has(record.state) && record.state !== "applying");
}

export function createTargetRecord(integration, target) {
  const multiplier = outcomeMultiplier(target.degreeOfSuccess);
  return {
    applicationId: applicationId(integration.integrationId, target.toolbeltTargetKey),
    toolbeltTargetKey: target.toolbeltTargetKey,
    actorUuid: target.actorUuid,
    tokenUuid: target.tokenUuid,
    sceneId: target.sceneId,
    saveType: target.saveType,
    nativeOutcome: target.degreeOfSuccess,
    effectiveOutcome: target.degreeOfSuccess,
    multiplier,
    state: target.toolbeltAppliedState
      ? TOOLBELT_TARGET_STATES.EXTERNAL
      : target.saveState === "resolved"
        ? TOOLBELT_TARGET_STATES.READY
        : TOOLBELT_TARGET_STATES.PENDING_SAVE,
    preApplicationHp: null,
    preApplicationTempHp: null,
    postApplicationHp: null,
    postApplicationTempHp: null,
    actualHpDelta: null,
    applicationMessageId: null,
    undoState: null,
    reason: target.toolbeltAppliedState ? "toolbelt-already-applied" : null,
    toolbeltStateFingerprint: target.saveFingerprint,
  };
}
