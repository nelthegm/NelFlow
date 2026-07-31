function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function damageTypeLabel(type) {
  const configured = CONFIG.PF2E?.damageTypes?.[type];
  if (typeof configured === "string") return localize(configured);
  if (typeof configured?.label === "string") return localize(configured.label);
  return type.replaceAll("-", " ");
}

/** Format only the structured DamageRoll summary persisted by Slice 2. */
export function formatDamageSummary(summary) {
  if (!Number.isFinite(summary?.total)) return "";
  const components = (summary.components ?? []).filter(
    (component) => component.type && Number.isFinite(component.total),
  );
  if (components.length === 1 && components[0].total === summary.total) {
    const persistent = components[0].persistent
      ? `${localize("Nelflow.Stack.Persistent")} `
      : "";
    return `${summary.total} ${persistent}${damageTypeLabel(components[0].type)}`;
  }
  if (!components.length) return String(summary.total);
  const details = components
    .map((component) => {
      const persistent = component.persistent
        ? `${localize("Nelflow.Stack.Persistent")} `
        : "";
      return `${component.total} ${persistent}${damageTypeLabel(component.type)}`;
    })
    .join(", ");
  return `${summary.total} (${details})`;
}

/** Map persisted PF2e Strike outcomes to Strike-specific presentation labels. */
export function strikeOutcomeLabel(outcome) {
  const keys = {
    criticalFailure: "Nelflow.StrikeOutcome.CriticalMiss",
    failure: "Nelflow.StrikeOutcome.Miss",
    success: "Nelflow.StrikeOutcome.Hit",
    criticalSuccess: "Nelflow.StrikeOutcome.CriticalHit",
  };
  return localize(keys[outcome] ?? "Nelflow.State.Error");
}

/** Format the structured MAP value already projected into a row. */
export function formatMap(row) {
  if (!row.mapIncreases) return "";
  if (!Number.isFinite(row.mapPenalty)) {
    return format("Nelflow.Stack.MapStep", { step: row.mapIncreases });
  }
  const penalty = new Intl.NumberFormat(game.i18n.lang, { signDisplay: "always" }).format(
    row.mapPenalty,
  );
  return format("Nelflow.Stack.Map", { penalty });
}
