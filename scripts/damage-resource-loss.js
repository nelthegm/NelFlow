/**
 * Canonical damage resource-loss accounting (0.14.21).
 *
 * NelFlow observes PF2e's authoritative application result. It does not
 * redistribute incoming damage across HP / Temporary HP / Stamina.
 *
 * PF2e paths (audited against installed pf2e.mjs calculateHealthDelta):
 * - HP:      system.attributes.hp.value
 * - Temp HP: system.attributes.hp.temp
 * - Stamina: system.attributes.hp.sp.value (only when variants.stamina enabled)
 */

export const DAMAGE_RESOURCE_PATHS = Object.freeze({
  hp: "system.attributes.hp.value",
  tempHp: "system.attributes.hp.temp",
  stamina: "system.attributes.hp.sp.value",
});

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function lossBetween(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  return Math.max(0, before - after);
}

/** True when the PF2e Stamina variant setting is enabled. */
export function isStaminaVariantEnabled(settings = globalThis.game?.pf2e?.settings) {
  try {
    if (settings?.variants?.stamina === true) return true;
    if (settings?.variants?.stamina === false) return false;
  } catch {
    /* ignore */
  }
  try {
    return globalThis.game?.settings?.get?.("pf2e", "staminaVariant") === true;
  } catch {
    return false;
  }
}

/**
 * Read current stamina points when the variant is active; otherwise 0.
 * Missing / malformed fields fail safe to 0 (never NaN).
 */
export function readStaminaValue(actor, { staminaEnabled = isStaminaVariantEnabled() } = {}) {
  if (!staminaEnabled) return 0;
  try {
    const value = actor?.system?.attributes?.hp?.sp?.value;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  } catch {
    return 0;
  }
}

/**
 * Normalize component losses into the durable resourceLoss shape.
 * @returns {{ hpLoss: number, tempHpLoss: number, staminaLoss: number, totalApplied: number }}
 */
export function normalizeResourceLoss(input = {}) {
  const hpLoss = finiteNonNegative(input.hpLoss ?? input.hp);
  const tempHpLoss = finiteNonNegative(input.tempHpLoss ?? input.tempHp);
  const staminaLoss = finiteNonNegative(input.staminaLoss ?? input.stamina);
  return {
    hpLoss,
    tempHpLoss,
    staminaLoss,
    totalApplied: hpLoss + tempHpLoss + staminaLoss,
  };
}

/** Derive losses from NelFlow pre/post health snapshots. */
export function deriveResourceLossFromSnapshots(preApplication, postApplication) {
  if (!preApplication || !postApplication) return null;
  const beforeHp = Number(preApplication.hp);
  const beforeTemp = Number(preApplication.tempHp);
  const afterHp = Number(postApplication.hp);
  const afterTemp = Number(postApplication.tempHp);
  if (![beforeHp, beforeTemp, afterHp, afterTemp].every((value) => Number.isFinite(value))) {
    return null;
  }
  const beforeStamina = Number.isFinite(Number(preApplication.stamina))
    ? Number(preApplication.stamina)
    : 0;
  const afterStamina = Number.isFinite(Number(postApplication.stamina))
    ? Number(postApplication.stamina)
    : 0;
  return normalizeResourceLoss({
    hpLoss: lossBetween(beforeHp, afterHp),
    tempHpLoss: lossBetween(beforeTemp, afterTemp),
    staminaLoss: lossBetween(beforeStamina, afterStamina),
  });
}

/**
 * Derive losses from PF2e AppliedDamageFlag.updates when present.
 * Each update.value is (pre - post) for that path.
 */
export function deriveResourceLossFromAppliedDamage(appliedDamage) {
  const updates = appliedDamage?.updates;
  if (!Array.isArray(updates) || !updates.length) return null;
  let hpLoss = 0;
  let tempHpLoss = 0;
  let staminaLoss = 0;
  let sawRelevant = false;
  for (const entry of updates) {
    const path = typeof entry?.path === "string" ? entry.path : null;
    const value = Number(entry?.value);
    if (!path || !Number.isFinite(value)) continue;
    const loss = Math.max(0, value);
    if (path === DAMAGE_RESOURCE_PATHS.hp) {
      hpLoss = loss;
      sawRelevant = true;
    } else if (path === DAMAGE_RESOURCE_PATHS.tempHp) {
      tempHpLoss = loss;
      sawRelevant = true;
    } else if (path === DAMAGE_RESOURCE_PATHS.stamina) {
      staminaLoss = loss;
      sawRelevant = true;
    }
  }
  if (!sawRelevant) return null;
  return normalizeResourceLoss({ hpLoss, tempHpLoss, staminaLoss });
}

/**
 * Prefer AppliedDamageFlag deltas when they identify HP/Temp/SP; else snapshots.
 */
export function deriveResourceLoss({ preApplication, postApplication, appliedDamage } = {}) {
  return (
    deriveResourceLossFromAppliedDamage(appliedDamage) ??
    deriveResourceLossFromSnapshots(preApplication, postApplication)
  );
}

/** True when Temp HP or Stamina participated (breakdown should render). */
export function resourceLossNeedsBreakdown(loss) {
  if (!loss) return false;
  return finiteNonNegative(loss.tempHpLoss) > 0 || finiteNonNegative(loss.staminaLoss) > 0;
}

/**
 * Ordered non-zero breakdown parts for UI (omit zeros).
 * Mixed pools include HP; HP-only callers should skip calling this.
 */
export function resourceLossBreakdownParts(loss, localize = (key, data) => key) {
  const normalized = normalizeResourceLoss(loss ?? {});
  if (!resourceLossNeedsBreakdown(normalized)) return [];
  const parts = [];
  if (normalized.tempHpLoss > 0) {
    parts.push(localize("Nelflow.Application.Breakdown.TempHp", { amount: normalized.tempHpLoss }));
  }
  if (normalized.staminaLoss > 0) {
    parts.push(localize("Nelflow.Application.Breakdown.Stamina", { amount: normalized.staminaLoss }));
  }
  if (normalized.hpLoss > 0) {
    parts.push(localize("Nelflow.Application.Breakdown.Hp", { amount: normalized.hpLoss }));
  }
  return parts;
}

export function formatResourceLossBreakdown(loss, localize = (key, data) => key) {
  return resourceLossBreakdownParts(loss, localize).join(" · ");
}

/** Plain JSON-safe projection for persistence / integration payloads. */
export function projectResourceLoss(loss) {
  if (!loss) return null;
  const normalized = normalizeResourceLoss(loss);
  return {
    hp: normalized.hpLoss,
    tempHp: normalized.tempHpLoss,
    stamina: normalized.staminaLoss,
    total: normalized.totalApplied,
  };
}
