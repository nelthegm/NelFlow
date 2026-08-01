export const SAVE_OUTCOMES = Object.freeze([
  "criticalFailure",
  "failure",
  "success",
  "criticalSuccess",
]);

export const SAVE_MULTIPLIERS = Object.freeze({
  criticalFailure: 2,
  failure: 1,
  success: 0.5,
  criticalSuccess: 0,
});

export const RESOLVER_PHASES = Object.freeze({
  COLLECTING: "collecting-saves",
  READY: "ready",
  ROLLING_DAMAGE: "rolling-damage",
  APPLYING_DAMAGE: "applying-damage",
  COMPLETE: "complete",
  PARTIAL: "partial",
  CANCELLED: "cancelled",
  ERROR: "error",
  INTERRUPTED: "interrupted",
  MANUAL: "manual",
  ABANDONED: "abandoned",
});

export const TERMINAL_APPLICATION_STATES = new Set([
  "applied",
  "no-damage",
  "not-applied",
  "manual",
  "undone",
  "undo-blocked",
]);

function safePart(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function resolverIdFor(sourceMessageId) {
  return `nelflow-save-${safePart(sourceMessageId)}`;
}

export function targetEntryIdFor(resolverId, tokenUuid, sequence) {
  return `${safePart(resolverId)}-target-${sequence}-${safePart(tokenUuid)}`;
}

export function applicationIdFor(resolverId, targetEntryId) {
  return `${safePart(resolverId)}-application-${safePart(targetEntryId)}`;
}

export function deduplicateTargetSnapshots(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target?.targetTokenUuid || seen.has(target.targetTokenUuid)) return false;
    seen.add(target.targetTokenUuid);
    return true;
  });
}

export function activeOutcome(target) {
  return SAVE_OUTCOMES.includes(target?.override?.outcome)
    ? target.override.outcome
    : SAVE_OUTCOMES.includes(target?.finalizedDegreeOfSuccess)
      ? target.finalizedDegreeOfSuccess
      : null;
}

export function refreshResolverPhase(resolver) {
  if (
    [RESOLVER_PHASES.CANCELLED, RESOLVER_PHASES.ROLLING_DAMAGE,
      RESOLVER_PHASES.APPLYING_DAMAGE, RESOLVER_PHASES.COMPLETE,
      RESOLVER_PHASES.PARTIAL, RESOLVER_PHASES.ERROR,
      RESOLVER_PHASES.INTERRUPTED, RESOLVER_PHASES.MANUAL,
      RESOLVER_PHASES.ABANDONED].includes(resolver.phase)
  ) {
    return resolver.phase;
  }
  if (!resolver.targets.length) return RESOLVER_PHASES.COLLECTING;
  return resolver.targets.every((target) => Boolean(activeOutcome(target)))
    ? RESOLVER_PHASES.READY
    : RESOLVER_PHASES.COLLECTING;
}

export function canResolveDamage(resolver, userId) {
  return Boolean(
    resolver?.authoringUserId === userId &&
      resolver.processingUserId === userId &&
      refreshResolverPhase(resolver) === RESOLVER_PHASES.READY &&
      !resolver.damage?.messageId,
  );
}

export function canRollTarget(target, { userId, isGM, authoringUserId, ownsActor }) {
  if (target?.saveState !== "pending" || !target.saveAttempt?.id) return false;
  if (isGM) {
    return (
      userId === authoringUserId &&
      (target.kind === "npc" || target.ownerUserIds?.length === 0)
    );
  }
  return target.kind === "pc" && ownsActor === true;
}

export function canResetSave(resolver, target, userId) {
  return Boolean(
    resolver?.authoringUserId === userId &&
      ["collecting-saves", "ready"].includes(resolver.phase) &&
      target?.saveState === "complete",
  );
}

export function resetTargetSave(target, attemptId) {
  return {
    ...target,
    saveAttempt: {
      id: attemptId,
      number: (target.saveAttempt?.number ?? 0) + 1,
      rollingUserId: null,
      correlationOption: null,
      state: "pending",
    },
    saveMessageId: null,
    rawDegreeOfSuccess: null,
    finalizedDegreeOfSuccess: null,
    outcomeSource: null,
    override: null,
    saveState: "pending",
    damageMultiplier: null,
  };
}

export function applyOutcomeOverride(target, outcome, reason = null) {
  if (!SAVE_OUTCOMES.includes(outcome)) {
    return {
      ...target,
      override: null,
      damageMultiplier: SAVE_MULTIPLIERS[target.finalizedDegreeOfSuccess] ?? null,
    };
  }
  return {
    ...target,
    override: { outcome, reason: reason?.trim() || null },
    damageMultiplier: SAVE_MULTIPLIERS[outcome],
  };
}

export function targetDamageProjection(target, summary, autoApply) {
  const outcome = activeOutcome(target);
  const multiplier = SAVE_MULTIPLIERS[outcome];
  if (outcome === "criticalSuccess") {
    return { multiplier, summary: null, applicationState: "no-damage" };
  }
  return {
    multiplier,
    summary,
    applicationState: autoApply ? "pending" : "not-applied",
  };
}

export function finalParentPhase(targets) {
  return targets.some((target) => ["manual", "error"].includes(target.applicationState))
    ? RESOLVER_PHASES.PARTIAL
    : RESOLVER_PHASES.COMPLETE;
}

export function isPersistentDamageSummary(summary) {
  return Boolean(summary?.components?.some((component) => component.persistent === true));
}

export function mayApplyTarget(target) {
  return !TERMINAL_APPLICATION_STATES.has(target.applicationState);
}
