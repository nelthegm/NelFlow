import { MODULE_ID } from "./constants.js";

function pf2eFlags(message) {
  return message?.flags?.pf2e ?? message?._source?.flags?.pf2e ?? {};
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function termName(term) {
  return term?.constructor?.name ?? term?.class ?? term?.type ?? "";
}

function activeDieValue(die) {
  const active = (die?.results ?? []).filter(
    (result) => result?.active !== false && result?.discarded !== true && Number.isFinite(result?.result),
  );
  if (active.length === 1) return active[0].result;
  return finite(die?.total);
}

function projectDie(die) {
  const faces = finite(die?.faces);
  if (!faces) return null;
  const results = (die.results ?? [])
    .filter((result) => Number.isFinite(result?.result))
    .map((result) => ({
      value: result.result,
      active: result.active !== false && result.discarded !== true,
    }));
  return {
    faces,
    number: finite(die.number) ?? results.length,
    results,
    total: finite(die.total),
    kept: activeDieValue(die),
    flavor: cleanText(die.options?.flavor ?? die.flavor),
  };
}

function collectDice(value) {
  const projected = [];
  const seen = new Set();
  const visit = (candidate) => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const die = projectDie(candidate);
    if (die) projected.push(die);
    for (const child of candidate.dice ?? []) visit(child);
    for (const child of candidate.terms ?? []) visit(child);
    if (candidate.roll) visit(candidate.roll);
  };
  visit(value);
  return projected;
}

function collectStaticTerms(value) {
  const terms = [];
  const seen = new Set();
  const visit = (candidate) => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const name = termName(candidate);
    const numeric = finite(candidate.number ?? candidate.value);
    if (/NumericTerm/i.test(name) && numeric != null) {
      terms.push({
        value: numeric,
        label: cleanText(candidate.options?.flavor ?? candidate.flavor),
      });
    }
    for (const child of candidate.terms ?? []) visit(child);
    if (candidate.roll) visit(candidate.roll);
  };
  visit(value);
  return terms;
}

function attackRoll(message) {
  return message?.rolls?.find((roll) => roll?.options?.type === "attack-roll") ??
    message?.rolls?.find((roll) => roll?.isCheckRoll) ??
    null;
}

function damageRoll(message) {
  return message?.rolls?.find((roll) => Array.isArray(roll?.instances)) ?? null;
}

function formulaOf(roll) {
  return cleanText(roll?.formula ?? roll?._formula);
}

function modifierProjection(message) {
  const modifiers = pf2eFlags(message).modifiers;
  if (!Array.isArray(modifiers)) return [];
  return modifiers
    .filter((modifier) =>
      modifier &&
      modifier.enabled !== false &&
      modifier.ignored !== true &&
      Number.isFinite(modifier.modifier))
    .map((modifier) => ({
      label: cleanText(modifier.label ?? modifier.name ?? modifier.slug ?? modifier.type) ?? "Modifier",
      slug: cleanText(modifier.slug),
      type: cleanText(modifier.type),
      value: modifier.modifier,
    }));
}

function targetOutcomeProjection(transaction, { canInspectTarget, targetLabel, hiddenTargetLabel }) {
  if (transaction?.transactionType !== "multi-target-strike") return [];
  return [...(transaction.targets ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((target, index) => {
      const authorized = canInspectTarget?.(target) === true;
      return {
        order: target.order ?? index,
        label: authorized ? targetLabel?.(target) ?? hiddenTargetLabel : hiddenTargetLabel,
        ac: authorized ? finite(target.ac) : null,
        outcome: authorized ? cleanText(target.outcome) : null,
        review: target.state === "review",
        private: !authorized,
        flatCheck: authorized && target.flatCheck
          ? {
              dc: finite(target.flatCheck.dc),
              total: finite(target.flatCheck.total),
              passed: target.flatCheck.passed === true,
              review: target.flatCheck.state === "review",
            }
          : null,
      };
    });
}

export function inspectionKind(record, transaction = record?.transaction) {
  if (record?.role === "attack") return "attack";
  if (record?.role !== "damage") return null;
  const marker = record.message?.getFlag?.(MODULE_ID, "transaction") ?? record.marker;
  const critical = marker?.damageGroup === "critical" ||
    transaction?.snapshot?.damageVariant === "critical" ||
    (transaction?.transactionType !== "multi-target-strike" && transaction?.snapshot?.outcome === "criticalSuccess");
  return critical ? "criticalDamage" : "damage";
}

export function buildAttackRollInspection({
  message,
  transaction,
  canInspectTarget = () => false,
  targetLabel = () => null,
  hiddenTargetLabel = "Hidden Target",
} = {}) {
  const roll = attackRoll(message);
  if (!roll) return { kind: "attack", available: false };
  const flags = pf2eFlags(message);
  const context = flags.context ?? {};
  const dice = collectDice(roll);
  const d20 = dice.find((die) => die.faces === 20) ?? null;
  const natural = d20?.kept ?? null;
  const total = finite(roll.total);
  const modifiers = modifierProjection(message);
  const map = modifiers.find((modifier) => modifier.slug === "multiple-attack-penalty");
  const singleTargetAuthorized = transaction?.transactionType !== "multi-target-strike" &&
    canInspectTarget?.({
      tokenUuid: transaction?.snapshot?.targetTokenUuid,
      actorUuid: transaction?.snapshot?.targetActorUuid,
    }) === true;
  const targetResults = targetOutcomeProjection(transaction, {
    canInspectTarget,
    targetLabel,
    hiddenTargetLabel,
  });
  return {
    kind: "attack",
    available: total != null || Boolean(formulaOf(roll)) || dice.length > 0,
    shared: transaction?.transactionType === "multi-target-strike",
    itemName: cleanText(transaction?.snapshot?.strikeName),
    formula: formulaOf(roll),
    dice,
    natural,
    fortune: cleanText(roll.options?.rollTwice ?? context.rollTwice) ??
      (d20?.results.length > 1 ? "multiple" : null),
    substitutions: Array.isArray(roll.options?.substitutions ?? context.substitutions)
      ? (roll.options?.substitutions ?? context.substitutions)
          .map((entry) => cleanText(entry?.label ?? entry?.slug ?? entry))
          .filter(Boolean)
      : [],
    modifiers,
    mapPenalty: finite(map?.value ?? transaction?.snapshot?.mapPenalty),
    finalModifier: total != null && natural != null ? total - natural : null,
    total,
    target: transaction?.transactionType === "multi-target-strike"
      ? null
      : {
          label: singleTargetAuthorized
            ? targetLabel?.({
                tokenUuid: transaction?.snapshot?.targetTokenUuid,
                actorUuid: transaction?.snapshot?.targetActorUuid,
              }) ?? hiddenTargetLabel
            : hiddenTargetLabel,
          ac: singleTargetAuthorized ? finite(context.dc?.value) : null,
          outcome: singleTargetAuthorized
            ? cleanText(transaction?.snapshot?.outcome ?? context.outcome)
            : null,
          private: !singleTargetAuthorized,
        },
    targetResults,
    naturalAdjustment: natural === 20 ? "natural20" : natural === 1 ? "natural1" : null,
    degreeAdjustments: singleTargetAuthorized && context.dosAdjustments &&
      typeof context.dosAdjustments === "object"
      ? Object.values(context.dosAdjustments)
          .map((entry) => cleanText(entry?.label))
          .filter(Boolean)
      : [],
  };
}

function instanceProjection(instance) {
  const dice = collectDice(instance);
  const staticTerms = collectStaticTerms(instance);
  return {
    type: cleanText(instance?.type),
    category: cleanText(instance?.category),
    persistent: instance?.persistent === true || instance?.category === "persistent",
    splash: instance?.category === "splash",
    precision: instance?.category === "precision",
    formula: formulaOf(instance?.roll ?? instance),
    total: finite(instance?.total),
    dice,
    staticTerms,
  };
}

export function buildDamageRollInspection({ message, transaction, kind = "damage" } = {}) {
  const roll = damageRoll(message);
  if (!roll) return { kind, available: false };
  const instances = (roll.instances ?? []).map(instanceProjection);
  const dice = collectDice(roll);
  const staticTerms = collectStaticTerms(roll);
  const labels = [...new Set([
    ...dice.map((die) => die.flavor),
    ...instances.flatMap((instance) => instance.dice.map((die) => die.flavor)),
  ].filter((label) => /fatal|deadly|splash|precision|persistent/i.test(label ?? "")))];
  return {
    kind,
    available: Number.isFinite(roll.total) || Boolean(formulaOf(roll)) || dice.length > 0,
    itemName: cleanText(transaction?.snapshot?.strikeName),
    formula: formulaOf(roll),
    total: finite(roll.total),
    dice,
    staticTerms,
    instances,
    specialLabels: labels,
  };
}

export function buildRollInspection(record, options = {}) {
  const transaction = options.transaction ?? record?.transaction;
  const kind = inspectionKind(record, transaction);
  if (kind === "attack") {
    return buildAttackRollInspection({ message: record.message, transaction, ...options });
  }
  if (kind === "damage" || kind === "criticalDamage") {
    return buildDamageRollInspection({ message: record.message, transaction, kind });
  }
  return { kind: null, available: false };
}
