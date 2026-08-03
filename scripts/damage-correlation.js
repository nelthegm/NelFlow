export const DAMAGE_CORRELATION_REASONS = Object.freeze({
  MISSING: "damage-message-missing",
  AMBIGUOUS: "damage-message-ambiguous",
  ALREADY_CLAIMED: "damage-message-already-claimed",
  CONTEXT_MISMATCH: "damage-message-context-mismatch",
  INVALID_ROLL: "damage-message-invalid-roll",
  NATIVE_CALL_FAILED: "native-damage-call-failed",
  TRANSACTION_INELIGIBLE: "transaction-no-longer-eligible",
});

function safeOptionPart(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function buildDamageCorrelationOption(transactionId, sequence) {
  return `nelflow:damage-correlation:${sequence}:${safeOptionPart(transactionId)}`;
}

/**
 * Compare only structured message metadata. Names, prose, flavor, timestamps,
 * and rendered chat HTML are deliberately absent from this validator.
 */
export function validateDamageCandidate(
  scope,
  candidate,
  { requireCorrelationOption = true } = {},
) {
  if (
    !candidate?.isChatMessage ||
    typeof candidate.messageId !== "string" ||
    !candidate.messageId ||
    (requireCorrelationOption && candidate.correlationOption !== scope.correlationOption) ||
    candidate.authorUserId !== scope.processingUserId ||
    candidate.visible !== true ||
    candidate.contextType !== "damage-roll"
  ) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  if (!candidate.isDamageRoll || !candidate.hasNativeDamageRoll) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.INVALID_ROLL };
  }
  if (
    candidate.sourceActorUuid !== scope.sourceActorUuid ||
    candidate.itemUuid !== scope.itemUuid ||
    candidate.targetActorUuid !== scope.targetActorUuid ||
    candidate.targetTokenUuid !== scope.targetTokenUuid ||
    candidate.outcome !== scope.expectedOutcome
  ) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  if (
    scope.sourceTokenUuid &&
    candidate.sourceTokenUuid &&
    candidate.sourceTokenUuid !== scope.sourceTokenUuid
  ) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  const expectedDegree = scope.expectedOutcome === "criticalSuccess" ? 3 : 2;
  if (
    Number.isInteger(candidate.degreeOfSuccess) &&
    candidate.degreeOfSuccess !== expectedDegree
  ) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.CONTEXT_MISMATCH };
  }
  if (
    candidate.existingTransactionId &&
    candidate.existingTransactionId !== scope.transactionId
  ) {
    return { ok: false, reason: DAMAGE_CORRELATION_REASONS.ALREADY_CLAIMED };
  }
  return { ok: true, reason: null };
}

/**
 * Session-local atomic claim cache. Persisted transaction links remain the
 * authority: the injected owner resolver is consulted before every new claim.
 */
export class DamageMessageClaimRegistry {
  constructor({ persistedOwner = () => null } = {}) {
    this.claims = new Map();
    this.persistedOwner = persistedOwner;
  }

  owner(messageId) {
    return this.claims.get(messageId)?.transactionId ?? this.persistedOwner(messageId) ?? null;
  }

  claim(messageId, transactionId) {
    const owner = this.owner(messageId);
    if (owner && owner !== transactionId) {
      return {
        ok: false,
        owner,
        reason: DAMAGE_CORRELATION_REASONS.ALREADY_CLAIMED,
      };
    }
    const existing = this.claims.get(messageId);
    this.claims.set(messageId, {
      transactionId,
      persisted: existing?.persisted === true || owner === transactionId,
    });
    return { ok: true, owner: transactionId, reason: null };
  }

  restore(messageId, transactionId) {
    if (!messageId || !transactionId) return;
    const owner = this.claims.get(messageId)?.transactionId ?? null;
    if (!owner || owner === transactionId) {
      this.claims.set(messageId, { transactionId, persisted: true });
    }
  }

  markPersisted(messageId, transactionId) {
    const claim = this.claims.get(messageId);
    const owner = claim?.transactionId ?? this.persistedOwner(messageId) ?? null;
    if (owner !== transactionId) return false;
    this.claims.set(messageId, { transactionId, persisted: true });
    return true;
  }

  release(messageId, transactionId) {
    const claim = this.claims.get(messageId);
    if (!claim || claim.transactionId !== transactionId || claim.persisted) return false;
    this.claims.delete(messageId);
    return true;
  }

  forgetDeletedMessage(messageId) {
    return this.claims.delete(messageId);
  }

  releaseTransaction(transactionId) {
    for (const [messageId, claim] of this.claims) {
      if (claim.transactionId === transactionId && !claim.persisted) {
        this.claims.delete(messageId);
      }
    }
  }
}

/**
 * Multiple scopes may be active simultaneously. The namespaced PF2e roll
 * option selects the exact scope in O(1), while the claim registry guarantees
 * that one native message cannot satisfy two transactions.
 */
export class DamageCaptureRegistry {
  constructor({
    claims = new DamageMessageClaimRegistry(),
    now = () => Date.now(),
    report = () => undefined,
  } = {}) {
    this.claims = claims;
    this.now = now;
    this.report = report;
    this.sequence = 0;
    this.byTransaction = new Map();
    this.byOption = new Map();
  }

  begin(scope) {
    if (this.byTransaction.has(scope.transactionId)) {
      throw new Error(`Damage correlation already active for ${scope.transactionId}`);
    }
    const sequence = ++this.sequence;
    const correlationOption = buildDamageCorrelationOption(scope.transactionId, sequence);
    const capture = {
      ...scope,
      sequence,
      correlationOption,
      startedAt: this.now(),
      startState: scope.startState,
      state: "capturing",
      resolvedDamageMessageId: null,
      candidates: [],
      rejections: [],
    };
    this.byTransaction.set(scope.transactionId, capture);
    this.byOption.set(correlationOption, capture);
    this.report("damage-correlation-started", capture, {});
    return capture;
  }

  getByOption(correlationOption) {
    return this.byOption.get(correlationOption) ?? null;
  }

  observe(candidate) {
    const capture = this.getByOption(candidate?.correlationOption);
    if (!capture || capture.state !== "capturing") return { accepted: false, ignored: true };

    const validation = validateDamageCandidate(capture, candidate);
    if (!validation.ok) {
      capture.rejections.push({ messageId: candidate?.messageId ?? null, reason: validation.reason });
      this.report("candidate-rejected", capture, {
        candidateMessageId: candidate?.messageId ?? null,
        reason: validation.reason,
      });
      return { accepted: false, ignored: false, reason: validation.reason };
    }
    if (!capture.candidates.some((entry) => entry.messageId === candidate.messageId)) {
      capture.candidates.push(candidate);
      this.report("candidate-observed", capture, {
        candidateMessageId: candidate.messageId,
      });
    }
    return { accepted: true, ignored: false };
  }

  finish(transactionId, { directCandidate = null } = {}) {
    const capture = this.byTransaction.get(transactionId);
    if (!capture) {
      return { ok: false, reason: DAMAGE_CORRELATION_REASONS.MISSING };
    }

    let candidates = capture.candidates;
    let strategy = "scoped-roll-option";
    if (directCandidate) {
      const validation = validateDamageCandidate(capture, directCandidate, {
        requireCorrelationOption: false,
      });
      if (validation.ok) {
        candidates = [directCandidate];
        strategy = "direct-return";
      } else {
        capture.rejections.push({
          messageId: directCandidate.messageId ?? null,
          reason: validation.reason,
        });
      }
    }

    let result;
    if (candidates.length > 1) {
      capture.state = "ambiguous";
      result = {
        ok: false,
        reason: DAMAGE_CORRELATION_REASONS.AMBIGUOUS,
        strategy,
        candidateCount: candidates.length,
      };
      this.report("correlation-ambiguous", capture, result);
    } else if (candidates.length === 0) {
      capture.state = "missing";
      const reason =
        capture.rejections.at(-1)?.reason ?? DAMAGE_CORRELATION_REASONS.MISSING;
      result = { ok: false, reason, strategy, candidateCount: 0 };
      this.report("correlation-missing", capture, result);
    } else {
      const candidate = candidates[0];
      const claim = this.claims.claim(candidate.messageId, transactionId);
      if (!claim.ok) {
        capture.state = "conflict";
        result = {
          ok: false,
          reason: claim.reason,
          strategy,
          candidateCount: 1,
          candidateMessageId: candidate.messageId,
        };
        this.report("candidate-conflict", capture, result);
      } else {
        capture.state = "claimed";
        capture.resolvedDamageMessageId = candidate.messageId;
        result = {
          ok: true,
          reason: null,
          strategy,
          candidateCount: 1,
          candidate,
          candidateMessageId: candidate.messageId,
        };
        this.report("candidate-claimed", capture, result);
        this.report("correlation-complete", capture, result);
      }
    }

    this.close(capture);
    return {
      ...result,
      sequence: capture.sequence,
      correlationOption: capture.correlationOption,
      startedAt: capture.startedAt,
      elapsedMs: Math.max(0, this.now() - capture.startedAt),
    };
  }

  fail(transactionId, reason = DAMAGE_CORRELATION_REASONS.NATIVE_CALL_FAILED) {
    const capture = this.byTransaction.get(transactionId);
    if (!capture) return;
    capture.state = "failed";
    this.report("correlation-missing", capture, { reason });
    this.close(capture);
    this.claims.releaseTransaction(transactionId);
  }

  close(capture) {
    capture.closedAt = this.now();
    this.byTransaction.delete(capture.transactionId);
    this.byOption.delete(capture.correlationOption);
  }
}
