export const AUTO_DAMAGE_ROLL_STATES = Object.freeze({
  OBSERVED: "observed",
  AWAITING_TARGETS: "awaiting-toolbelt-targets",
  ELIGIBLE: "eligible",
  CLAIMED: "claimed",
  ROLLING: "rolling",
  COMPLETED: "completed",
  EXTERNAL: "external-roll-detected",
  AMBIGUOUS: "ambiguous",
  MANUAL: "manual",
  INTERRUPTED: "interrupted",
  ERROR: "error",
  ABANDONED: "abandoned",
});

const TERMINAL_STATES = new Set([
  AUTO_DAMAGE_ROLL_STATES.COMPLETED,
  AUTO_DAMAGE_ROLL_STATES.EXTERNAL,
  AUTO_DAMAGE_ROLL_STATES.AMBIGUOUS,
  AUTO_DAMAGE_ROLL_STATES.MANUAL,
  AUTO_DAMAGE_ROLL_STATES.INTERRUPTED,
  AUTO_DAMAGE_ROLL_STATES.ERROR,
  AUTO_DAMAGE_ROLL_STATES.ABANDONED,
]);

export function isTerminalAutoDamageState(state) {
  return TERMINAL_STATES.has(state);
}

export function liveInvocationAllowed({ live, state, currentUserId, rollingUserId }) {
  return Boolean(
    live &&
      state === AUTO_DAMAGE_ROLL_STATES.CLAIMED &&
      currentUserId &&
      currentUserId === rollingUserId,
  );
}

export function shouldGuardSourceDamageControl(draft, currentSessionId = null) {
  if (
    draft?.guardSourceControl !== true ||
    draft.manualRollEnabled === true ||
    draft.damageActionId !== "spell-damage"
  ) return false;
  if ([AUTO_DAMAGE_ROLL_STATES.COMPLETED, AUTO_DAMAGE_ROLL_STATES.EXTERNAL].includes(draft.state)) {
    return Boolean(draft.damageMessageId);
  }
  return Boolean(
    [AUTO_DAMAGE_ROLL_STATES.CLAIMED, AUTO_DAMAGE_ROLL_STATES.ROLLING].includes(draft.state) &&
      currentSessionId &&
      draft.activeOperation?.sessionId === currentSessionId,
  );
}

export class AutoDamageMessageClaimRegistry {
  constructor() {
    this.claims = new Map();
  }

  owner(messageId) {
    return this.claims.get(messageId) ?? null;
  }

  claim(messageId, integrationId) {
    const owner = this.owner(messageId);
    if (owner && owner !== integrationId) return false;
    this.claims.set(messageId, integrationId);
    return true;
  }

  restore(messageId, integrationId) {
    if (!messageId || !integrationId) return false;
    return this.claim(messageId, integrationId);
  }
}
