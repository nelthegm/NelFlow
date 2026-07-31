const localDetections = new Map();

const EXCLUDED_ACTIONS = new Set([
  "strike-attack",
  "strike-attack2",
  "strike-attack3",
  "strike-damage",
  "revert-damage",
  "roll-mode",
]);

function cleanLabel(value) {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim();
  return label && label.length <= 120 ? label : null;
}

function structuredAwareness(strike) {
  const additionalEffects = Array.isArray(strike.attack?.additionalEffects)
    ? strike.attack.additionalEffects
    : [];
  if (additionalEffects.length) {
    const labels = additionalEffects
      .map((effect) => cleanLabel(effect?.label))
      .filter(Boolean);
    return {
      schemaVersion: 1,
      count: additionalEffects.length,
      labels,
      detectionSource: "pf2e-strike-additional-effects",
      availabilityUnknown: true,
      visibility: "gm",
    };
  }

  const itemEffects = Array.isArray(strike.item?.attackEffects)
    ? strike.item.attackEffects
    : Array.isArray(strike.item?.system?.attackEffects?.value)
      ? strike.item.system.attackEffects.value
      : [];
  if (!itemEffects.length) return null;

  const labels = itemEffects
    .map((tag) => {
      const configured = typeof tag === "string" ? CONFIG.PF2E?.attackEffects?.[tag] : null;
      return cleanLabel(configured);
    })
    .filter(Boolean);
  return {
    schemaVersion: 1,
    count: itemEffects.length,
    labels,
    detectionSource: "pf2e-melee-attack-effects",
    availabilityUnknown: true,
    visibility: "gm",
  };
}

function controlLabel(control) {
  const label =
    control.querySelector?.(".label")?.textContent ??
    control.getAttribute("aria-label") ??
    control.getAttribute("title") ??
    control.closest("li.roll-note")?.querySelector(":scope > strong")?.textContent ??
    control.textContent;
  return cleanLabel(label);
}

function visibleRollNoteControl(control) {
  if (!(control instanceof HTMLElement) || control.closest('[aria-hidden="true"]')) return false;
  if (control.closest('[data-visibility="gm"]') && !game.user.isGM) return false;
  const action = control.dataset.action;
  return !action || !EXCLUDED_ACTIONS.has(action);
}

/**
 * Presentation-only awareness for PF2e Strike riders. Structured prepared
 * Strike data is persisted; DOM fallback is local and is limited to actual
 * controls inside visible roll notes on the exact linked attack message.
 */
export class SupplementalActionAwareness {
  static fromStrike(strike) {
    return structuredAwareness(strike);
  }

  static forRow(row) {
    return row.supplementalActions ?? localDetections.get(row.attackMessageId) ?? null;
  }

  static visibleToCurrentUser(awareness) {
    return Boolean(
      awareness?.count > 0 && (awareness.visibility !== "gm" || game.user.isGM),
    );
  }

  static localizedLabels(awareness) {
    if (!this.visibleToCurrentUser(awareness)) return [];
    return (awareness.labels ?? [])
      .map((label) => cleanLabel(game.i18n.localize(label)))
      .filter(Boolean);
  }

  static inspectLinkedAttackDom(message, content, transaction) {
    if (transaction.snapshot?.supplementalActions || !message.visible || !message.isContentVisible) {
      return;
    }

    const controls = Array.from(
      content.querySelectorAll(
        [
          "li.roll-note a[data-pf2-action]",
          "li.roll-note span[data-pf2-action]",
          "li.roll-note a.inline-check[data-pf2-check]",
          "li.roll-note button[data-action]",
        ].join(","),
      ),
    ).filter(visibleRollNoteControl);

    if (!controls.length) {
      localDetections.delete(message.id);
      return;
    }

    localDetections.set(message.id, {
      schemaVersion: 1,
      count: controls.length,
      labels: controls.map(controlLabel).filter(Boolean),
      detectionSource: "linked-attack-dom",
      availabilityUnknown: true,
      visibility: "viewer",
    });
  }
}
