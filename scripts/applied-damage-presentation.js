/**
 * Shared Applied Damage presentation helpers (0.14.21).
 * Primary line uses totalApplied; breakdown only when Temp HP or Stamina participated.
 */

import {
  formatResourceLossBreakdown,
  normalizeResourceLoss,
  resourceLossNeedsBreakdown,
} from "./damage-resource-loss.js";

function localize(key, data = null) {
  try {
    if (data) return globalThis.game?.i18n?.format?.(key, data) ?? key;
    return globalThis.game?.i18n?.localize?.(key) ?? key;
  } catch {
    return key;
  }
}

/** Resolve durable resourceLoss from a transaction / row / toolbelt record. */
export function resourceLossFromRecord(record) {
  if (!record || typeof record !== "object") return null;
  if (record.resourceLoss && typeof record.resourceLoss === "object") {
    return normalizeResourceLoss(record.resourceLoss);
  }
  if (
    Number.isFinite(record.preApplicationHp) &&
    Number.isFinite(record.postApplicationHp)
  ) {
    return normalizeResourceLoss({
      hpLoss: Math.max(0, record.preApplicationHp - record.postApplicationHp),
      tempHpLoss: Math.max(
        0,
        Number(record.preApplicationTempHp ?? 0) - Number(record.postApplicationTempHp ?? 0),
      ),
      staminaLoss: Math.max(
        0,
        Number(record.preApplicationStamina ?? 0) - Number(record.postApplicationStamina ?? 0),
      ),
    });
  }
  if (record.preApplication && record.postApplication) {
    return normalizeResourceLoss({
      hpLoss: Math.max(0, Number(record.preApplication.hp) - Number(record.postApplication.hp)),
      tempHpLoss: Math.max(
        0,
        Number(record.preApplication.tempHp ?? 0) - Number(record.postApplication.tempHp ?? 0),
      ),
      staminaLoss: Math.max(
        0,
        Number(record.preApplication.stamina ?? 0) - Number(record.postApplication.stamina ?? 0),
      ),
    });
  }
  if (Number.isFinite(record.appliedAmount)) {
    return normalizeResourceLoss({ hpLoss: record.appliedAmount, tempHpLoss: 0, staminaLoss: 0 });
  }
  if (Number.isFinite(record.actualHpDelta)) {
    return normalizeResourceLoss({ hpLoss: record.actualHpDelta, tempHpLoss: 0, staminaLoss: 0 });
  }
  return null;
}

export function appliedDamagePrimaryText(total, { target = null } = {}) {
  if (target) {
    return localize("Nelflow.Application.AppliedDamageToTarget", {
      amount: total,
      target,
    });
  }
  return localize("Nelflow.Application.AppliedDamage", { amount: total });
}

export function appliedDamageBreakdownText(loss) {
  if (!resourceLossNeedsBreakdown(loss)) return "";
  return formatResourceLossBreakdown(loss, localize);
}

/**
 * Build primary + optional breakdown for application footers.
 * @returns {{ primary: string, breakdown: string, total: number, resourceLoss: object|null }}
 */
export function buildAppliedDamagePresentation(record, { target = null, showAmount = true } = {}) {
  const resourceLoss = resourceLossFromRecord(record);
  const total = resourceLoss?.totalApplied ?? (Number.isFinite(record?.appliedAmount)
    ? record.appliedAmount
    : Number.isFinite(record?.actualHpDelta)
      ? record.actualHpDelta
      : null);
  if (!showAmount || total == null) {
    return {
      primary: target
        ? localize("Nelflow.PlayerStrike.Application.AppliedUnknown", { target })
        : localize("Nelflow.Status.Applied"),
      breakdown: "",
      total: null,
      resourceLoss,
    };
  }
  return {
    primary: appliedDamagePrimaryText(total, { target }),
    breakdown: appliedDamageBreakdownText(resourceLoss),
    total,
    resourceLoss,
  };
}
