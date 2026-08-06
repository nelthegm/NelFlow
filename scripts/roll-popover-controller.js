const descriptors = new WeakMap();
let initialized = false;
let activeControl = null;
let popover = null;
let popoverSequence = 0;

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function outcomeLabel(outcome) {
  const key = {
    criticalFailure: "CriticalMiss",
    failure: "Miss",
    success: "Hit",
    criticalSuccess: "CriticalHit",
  }[outcome];
  return key ? localize(`Nelflow.StrikeOutcome.${key}`) : localize("Nelflow.Roll.PrivateResult");
}

function signed(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value}` : "";
}

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function appendLine(container, label, value, { strong = false } = {}) {
  if (value == null || value === "") return;
  const line = document.createElement("div");
  line.className = `nelflow-roll-popover__line${strong ? " nelflow-roll-popover__line--total" : ""}`;
  line.append(
    textElement("span", "nelflow-roll-popover__label", label),
    textElement("span", "nelflow-roll-popover__value", value),
  );
  container.append(line);
}

function dieText(die) {
  const values = (die.results ?? []).map((result) =>
    result.active ? String(result.value) : `(${result.value})`);
  const count = Number.isFinite(die.number) && die.number > 0 ? die.number : values.length || 1;
  const result = values.length ? ` [${values.join(", ")}]` : "";
  return `${count}d${die.faces}${result}`;
}

function renderDice(container, dice) {
  for (const die of dice ?? []) {
    appendLine(
      container,
      die.flavor || localize("Nelflow.Roll.Die"),
      dieText(die),
    );
  }
}

function renderAttack(container, model) {
  if (model.formula) appendLine(container, localize("Nelflow.Roll.Formula"), model.formula);
  renderDice(container, model.dice);
  if (model.fortune) {
    appendLine(
      container,
      localize("Nelflow.Roll.Fortune"),
      model.fortune === "multiple" ? localize("Nelflow.Roll.MultipleDice") : model.fortune,
    );
  }
  for (const substitution of model.substitutions ?? []) {
    appendLine(container, localize("Nelflow.Roll.Substitution"), substitution);
  }
  for (const modifier of model.modifiers ?? []) {
    appendLine(container, modifier.label, signed(modifier.value));
  }
  if (Number.isFinite(model.mapPenalty) && !model.modifiers?.some(
    (modifier) => modifier.slug === "multiple-attack-penalty")) {
    appendLine(container, localize("Nelflow.Roll.Map"), signed(model.mapPenalty));
  }
  appendLine(container, localize("Nelflow.Roll.FinalModifier"), signed(model.finalModifier));
  appendLine(container, localize("Nelflow.Roll.Total"), model.total, { strong: true });

  if (model.target) {
    const target = document.createElement("section");
    target.className = "nelflow-roll-popover__section";
    target.append(textElement("strong", "nelflow-roll-popover__section-title", model.target.label));
    if (model.target.private) {
      appendLine(target, localize("Nelflow.Roll.Defense"), localize("Nelflow.Roll.UnknownDefense"));
    } else {
      appendLine(target, localize("Nelflow.Roll.ArmorClass"), model.target.ac);
    }
    appendLine(
      target,
      localize("Nelflow.Roll.Result"),
      model.target.outcome ? outcomeLabel(model.target.outcome) : localize("Nelflow.Roll.PrivateResult"),
    );
    container.append(target);
  }

  if (model.naturalAdjustment) {
    appendLine(
      container,
      localize("Nelflow.Roll.DegreeAdjustment"),
      localize(model.naturalAdjustment === "natural20"
        ? "Nelflow.Roll.Natural20Adjustment"
        : "Nelflow.Roll.Natural1Adjustment"),
    );
  }
  for (const adjustment of model.degreeAdjustments ?? []) {
    appendLine(container, localize("Nelflow.Roll.DegreeAdjustment"), adjustment);
  }

  if (model.targetResults?.length) {
    const targets = document.createElement("section");
    targets.className = "nelflow-roll-popover__section";
    targets.append(textElement("strong", "nelflow-roll-popover__section-title", localize("Nelflow.Roll.TargetResults")));
    for (const result of model.targetResults) {
      const parts = [result.label];
      if (result.private) {
        parts.push(localize("Nelflow.Roll.PrivateResult"));
      } else if (result.review) {
        parts.push(localize("Nelflow.MultiTarget.Review"));
      } else {
        if (Number.isFinite(result.ac)) parts.push(format("Nelflow.Roll.ArmorClassValue", { value: result.ac }));
        parts.push(result.outcome ? outcomeLabel(result.outcome) : localize("Nelflow.Roll.PrivateResult"));
      }
      targets.append(textElement("div", "nelflow-roll-popover__target", parts.join(" — ")));
      if (result.flatCheck) {
        const check = result.flatCheck.review
          ? localize("Nelflow.MultiTarget.Review")
          : format("Nelflow.Roll.FlatCheckValue", {
              total: result.flatCheck.total ?? "?",
              dc: result.flatCheck.dc ?? "?",
            });
        appendLine(targets, localize("Nelflow.Roll.FlatCheck"), check);
      }
    }
    container.append(targets);
  }
}

function renderDamageInstance(container, instance) {
  const labels = [instance.type, instance.category].filter(Boolean);
  if (instance.persistent && !labels.includes("persistent")) labels.push("persistent");
  const section = document.createElement("section");
  section.className = "nelflow-roll-popover__section";
  if (labels.length) {
    section.append(textElement("strong", "nelflow-roll-popover__section-title", labels.join(" · ")));
  }
  if (instance.formula) appendLine(section, localize("Nelflow.Roll.Formula"), instance.formula);
  renderDice(section, instance.dice);
  for (const term of instance.staticTerms ?? []) {
    appendLine(section, term.label || localize("Nelflow.Roll.StaticModifier"), signed(term.value));
  }
  appendLine(section, localize("Nelflow.Roll.Subtotal"), instance.total);
  container.append(section);
}

function renderDamage(container, model) {
  if (model.formula) appendLine(container, localize("Nelflow.Roll.Formula"), model.formula);
  if (model.instances?.length) {
    for (const instance of model.instances) renderDamageInstance(container, instance);
  } else {
    renderDice(container, model.dice);
    for (const term of model.staticTerms ?? []) {
      appendLine(container, term.label || localize("Nelflow.Roll.StaticModifier"), signed(term.value));
    }
  }
  for (const label of model.specialLabels ?? []) {
    appendLine(container, localize("Nelflow.Roll.Special"), label);
  }
  appendLine(container, localize("Nelflow.Roll.Total"), model.total, { strong: true });
}

function createPopover(model) {
  const element = document.createElement("aside");
  element.id = `nelflow-roll-popover-${++popoverSequence}`;
  element.className = "nelflow-roll-popover";
  element.setAttribute("role", "tooltip");
  const headingKey = model.shared
    ? "Nelflow.Roll.SharedAttackHeading"
    : model.kind === "attack"
      ? "Nelflow.Roll.AttackHeading"
      : model.kind === "criticalDamage"
        ? "Nelflow.Roll.CriticalDamageHeading"
        : "Nelflow.Roll.DamageHeading";
  element.append(textElement("strong", "nelflow-roll-popover__heading", localize(headingKey)));
  if (model.itemName) element.append(textElement("div", "nelflow-roll-popover__item", model.itemName));
  if (!model.available) {
    element.append(textElement("div", "nelflow-roll-popover__fallback", localize("Nelflow.Roll.Unavailable")));
  } else if (model.kind === "attack") {
    renderAttack(element, model);
  } else {
    renderDamage(element, model);
  }
  return element;
}

function closePopover() {
  if (activeControl) activeControl.removeAttribute("aria-describedby");
  activeControl = null;
  popover?.remove();
  popover = null;
}

function positionPopover(control, element) {
  const anchor = control.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - bounds.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);
  const below = anchor.bottom + 6;
  const above = anchor.top - bounds.height - 6;
  const top = below + bounds.height <= window.innerHeight - margin
    ? below
    : Math.max(margin, above);
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function openPopover(control) {
  const factory = descriptors.get(control);
  if (!factory) return;
  closePopover();
  let model;
  try {
    model = factory();
  } catch {
    model = { kind: control.dataset.nelflowRollKind ?? "attack", available: false };
  }
  popover = createPopover(model);
  activeControl = control;
  document.body.append(popover);
  control.setAttribute("aria-describedby", popover.id);
  positionPopover(control, popover);
}

function inspectionControl(target) {
  return target instanceof Element ? target.closest(".nelflow-roll-inspect") : null;
}

export class RollPopoverController {
  static initialize() {
    if (initialized) return;
    initialized = true;
    document.addEventListener("pointerover", (event) => {
      const control = inspectionControl(event.target);
      if (control && control !== activeControl) openPopover(control);
    });
    document.addEventListener("pointerout", (event) => {
      const control = inspectionControl(event.target);
      if (control && control === activeControl && !control.contains(event.relatedTarget)) closePopover();
    });
    document.addEventListener("focusin", (event) => {
      const control = inspectionControl(event.target);
      if (control) openPopover(control);
    });
    document.addEventListener("focusout", (event) => {
      const control = inspectionControl(event.target);
      if (control && control === activeControl) closePopover();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeControl) closePopover();
    });
    Hooks.on("updateChatMessage", closePopover);
    Hooks.on("deleteChatMessage", closePopover);
    window.addEventListener("blur", closePopover);
    window.addEventListener("resize", closePopover, { passive: true });
  }

  static register(control, factory, kind) {
    if (!control || typeof factory !== "function") return control;
    control.classList.add("nelflow-roll-inspect");
    control.dataset.nelflowRollKind = kind;
    control.setAttribute("aria-haspopup", "true");
    descriptors.set(control, factory);
    return control;
  }
}
