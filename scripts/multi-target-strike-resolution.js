import { MODULE_ID } from "./constants.js";
import { logger } from "./logger.js";
import { degreeOfSuccess, mergeDegreeAdjustments } from "./multi-target-strike-model.js";
import { PF2eAdapter } from "./pf2e-adapter.js";
import { getRuntimeSessionId } from "./runtime-session.js";

export function authorTargetSetMatches(author, capture) {
  if (!author?.targets || typeof author.targets[Symbol.iterator] !== "function") return false;
  const current = new Set(
    Array.from(author.targets, (target) => target?.document?.uuid ?? target?.uuid).filter(Boolean),
  );
  const captured = new Set(capture.targets.map((target) => target.tokenUuid));
  return current.size === captured.size && [...captured].every((uuid) => current.has(uuid));
}

export function sharedAttackTotal(strike) {
  return Number.isFinite(strike.roll?.total) ? strike.roll.total : null;
}

export function sharedDieValue(strike) {
  const die = strike.roll?.dice?.find?.((candidate) => candidate?.faces === 20);
  if (Number.isFinite(die?.total)) return die.total;
  if (strike.roll?.isDeterministic) {
    const numeric = strike.roll?.terms?.find?.((term) =>
      term?.constructor?.name === "NumericTerm" && Number.isFinite(term.total),
    );
    return Number.isFinite(numeric?.total) ? numeric.total : null;
  }
  return null;
}

function sourceRollOptions(strike, targetActor) {
  const options = new Set(
    (strike.context?.options ?? []).filter((option) => !/^(?:target)(?::|$)/.test(option)),
  );
  for (const option of strike.actor.getRollOptions?.(strike.context?.domains ?? []) ?? []) options.add(option);
  for (const option of targetActor.getSelfRollOptions?.("target") ?? []) options.add(option);
  if (strike.actor.alliance && targetActor.alliance) {
    options.add(`target:${strike.actor.alliance === targetActor.alliance ? "ally" : "enemy"}`);
  }
  const total = sharedAttackTotal(strike);
  const natural = sharedDieValue(strike);
  if (Number.isFinite(total)) options.add(`check:total:${total}`);
  if (Number.isFinite(natural)) {
    options.add(`check:total:natural:${natural}`);
    options.add(`check:roll:total:natural:${natural}`);
  }
  return options;
}

function sourceDegreeAdjustments(strike) {
  const synthetics = strike.actor?.synthetics?.degreeOfSuccessAdjustments ?? {};
  return (strike.context?.domains ?? []).flatMap((domain) => synthetics[domain] ?? []);
}

function targetArmorClass(strike, targetActor, options) {
  const statistic = targetActor?.armorClass;
  if (!statistic) return null;
  try {
    const prepared = statistic.withRollOptions?.({
      origin: strike.actor,
      target: targetActor,
      item: strike.item,
      extraRollOptions: [...options],
    }) ?? statistic;
    const value = prepared.dc?.value ?? prepared.value;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function concealmentDc(options) {
  if (options.has("target:condition:hidden")) return 11;
  if (options.has("target:condition:concealed")) return 5;
  return null;
}

async function rollTargetFlatCheck({ strike, targetToken, dc }) {
  if (!dc) return null;
  const Check = game.pf2e?.Check;
  const CheckModifier = game.pf2e?.CheckModifier;
  if (typeof Check?.roll !== "function" || typeof CheckModifier !== "function") {
    return { state: "review", dc, total: null, passed: false, reason: "flat-check-unavailable" };
  }
  try {
    const check = new CheckModifier("nelflow-target-flat-check", { modifiers: [] });
    const sourceToken = strike.sourceTokenUuid ? await PF2eAdapter.resolveToken(strike.sourceTokenUuid) : null;
    const roll = await Check.roll(check, {
      actor: strike.actor,
      token: sourceToken?.document ?? null,
      target: {
        actor: targetToken.actor,
        token: targetToken.document,
        statistic: null,
        self: false,
        item: null,
      },
      item: strike.item,
      type: "flat-check",
      dc: { value: dc },
      title: game.i18n.localize("Nelflow.MultiTarget.FlatCheck"),
      createMessage: false,
      skipDialog: true,
    });
    const total = Number.isFinite(roll?.total) ? roll.total : null;
    return total == null
      ? { state: "review", dc, total: null, passed: false, reason: "flat-check-unavailable" }
      : { state: "resolved", dc, total, passed: total >= dc, reason: null };
  } catch (error) {
    logger.debug("Target flat check unavailable", {
      stage: "batch-flat-check",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { state: "review", dc, total: null, passed: false, reason: "flat-check-unavailable" };
  }
}

export async function resolveMultiTargetChildren(capture, strike) {
  const children = [];
  for (const captured of capture.targets) {
    const document = await fromUuid(captured.tokenUuid);
    const token = document?.object ?? null;
    const actor = token?.actor;
    const base = {
      ...captured,
      key: `${captured.order + 1}`,
      damageCategory: "none",
      damageMessageId: null,
      applicationMessageId: null,
      damageSummary: null,
      preApplication: null,
      postApplication: null,
      appliedAmount: null,
      undoBlocked: false,
      flatCheck: null,
      flatCheckFailed: false,
    };
    if (
      !token ||
      actor?.uuid !== captured.actorUuid ||
      document.uuid !== captured.tokenUuid ||
      document.parent?.id !== captured.sceneId
    ) {
      children.push({ ...base, ac: null, outcome: null, state: "review", reviewReason: "target-unavailable" });
      continue;
    }
    const options = sourceRollOptions(strike, actor);
    const primary = captured.tokenUuid === strike.targetTokenUuid && captured.actorUuid === strike.targetActorUuid;
    const ac = primary && Number.isFinite(strike.context?.dc?.value)
      ? strike.context.dc.value
      : targetArmorClass(strike, actor, options);
    if (!Number.isFinite(ac)) {
      children.push({ ...base, ac: null, outcome: null, state: "review", reviewReason: "defense-unavailable" });
      continue;
    }
    const adjustments = primary && strike.context?.dosAdjustments && !Array.isArray(strike.context.dosAdjustments)
      ? strike.context.dosAdjustments
      : mergeDegreeAdjustments(sourceDegreeAdjustments(strike), options);
    const resolved = primary
      ? { outcome: strike.outcome, unadjustedOutcome: strike.context?.unadjustedOutcome ?? strike.outcome }
      : degreeOfSuccess({ total: sharedAttackTotal(strike), dc: ac, dieValue: sharedDieValue(strike), adjustments });
    if (!resolved) {
      children.push({ ...base, ac, outcome: null, state: "review", reviewReason: "degree-unavailable" });
      continue;
    }
    const flatCheck = await rollTargetFlatCheck({ strike, targetToken: token, dc: concealmentDc(options) });
    const flatCheckFailed = flatCheck?.state === "review" || flatCheck?.passed === false;
    const hit = ["success", "criticalSuccess"].includes(resolved.outcome) && !flatCheckFailed;
    children.push({
      ...base,
      ac,
      outcome: resolved.outcome,
      unadjustedOutcome: resolved.unadjustedOutcome,
      flatCheck,
      flatCheckFailed,
      damageCategory: hit ? (resolved.outcome === "criticalSuccess" ? "critical" : "normal") : "none",
      state: flatCheck?.state === "review" ? "review" : hit ? "resolving" : "miss",
      reviewReason: flatCheck?.state === "review" ? flatCheck.reason : null,
    });
  }
  return children.sort((left, right) => left.order - right.order);
}

export function makeMultiTargetSnapshot(message, strike, capture, authorUserId) {
  return {
    sourceActorUuid: strike.actor.uuid,
    sourceTokenUuid: strike.sourceTokenUuid,
    sourceItemUuid: strike.item.uuid,
    strikeIdentifier: strike.identifier,
    strikeName: strike.item.name,
    strikeIcon: strike.item.img,
    sourceName: message.token?.name ?? strike.actor.name,
    sourceIcon: message.token?.texture?.src ?? strike.actor.img,
    actorType: strike.actorType,
    attackMessageId: message.id,
    attackCreatedAt: message._stats?.createdTime ?? Date.now(),
    outcome: strike.outcome,
    attackTotal: sharedAttackTotal(strike),
    naturalDie: sharedDieValue(strike),
    mapIncreases: strike.mapIncreases,
    mapPenalty: strike.mapPenalty,
    authoringUserId: authorUserId,
    processingUserId: game.user.id,
    autoApplyRequested: true,
    capturedAt: capture.capturedAt,
    timestamp: Date.now(),
    sessionId: getRuntimeSessionId(),
  };
}
