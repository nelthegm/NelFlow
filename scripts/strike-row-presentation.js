/**
 * Derive compact Strike-row presentation from exact, already-authorized native
 * records. This module is deliberately Foundry-agnostic so rendering can never
 * become a second source of mechanical truth.
 */

export function exactRecordForRole(records, role) {
  return (records ?? []).find((record) => record?.role === role) ?? null;
}

export function attackTotalFromExactRecord(records, inspectAttack) {
  const record = exactRecordForRole(records, "attack");
  if (!record || typeof inspectAttack !== "function") return null;
  try {
    const inspection = inspectAttack(record);
    return inspection?.kind === "attack" && Number.isFinite(inspection.total)
      ? inspection.total
      : null;
  } catch {
    return null;
  }
}

export function hasExactDamageRecord(records) {
  return Boolean(exactRecordForRole(records, "damage"));
}

export function buildStrikeRowPresentation({
  row,
  records,
  inspectAttack,
  formatDamage,
} = {}) {
  const showDamage = hasExactDamageRecord(records);
  return {
    outcome: row?.outcome ?? null,
    attackTotal: attackTotalFromExactRecord(records, inspectAttack),
    showDamage,
    damage: showDamage && typeof formatDamage === "function"
      ? formatDamage(row?.damageSummary)
      : "",
  };
}
