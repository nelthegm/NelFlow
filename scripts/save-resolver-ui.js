import { BASIC_SAVE_WORKFLOW_MODES, MODULE_ID, SETTINGS } from "./constants.js";
import { NativeCardCompactor } from "./native-card-compactor.js";
import {
  RESOLVER_PHASES,
  SAVE_MULTIPLIERS,
  activeOutcome,
  refreshResolverPhase,
} from "./save-resolver-model.js";
import { SaveResolverService } from "./save-resolver-service.js";
import { getSetting } from "./settings.js";
import { runNelflowBoundary } from "./nelflow-boundary.js";

const nativeVisibility = new Map();

function localize(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function button(label, className, iconClass) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.title = label;
  control.setAttribute("aria-label", label);
  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  control.append(icon, document.createTextNode(label));
  return control;
}

function run(operation) {
  void runNelflowBoundary({
    subsystem: "legacy-save-resolver-control",
    operation: "chat-control",
    transactionType: "legacy-save-resolver",
    task: operation,
  });
}

function visibleMessage(messageId) {
  const message = messageId ? game.messages.get(messageId) : null;
  return Boolean(message?.visible && message.isContentVisible);
}

function renderedMessage(messageId) {
  return Array.from(document.querySelectorAll("[data-message-id]")).find(
    (element) => element.dataset.messageId === messageId,
  );
}

function recordIds(resolver) {
  const ids = [
    resolver.sourceMessageId,
    ...resolver.targets.flatMap((target) => [
      ...(target.priorSaveMessageIds ?? []),
      target.saveMessageId,
      target.applicationMessageId,
    ]),
    resolver.damage?.messageId,
  ].filter((id) => visibleMessage(id));
  return [...new Set(ids)];
}

function updateNativeVisibility(resolver) {
  const show = nativeVisibility.get(resolver.resolverId) === true;
  const hasControl = Array.from(
    document.querySelectorAll(".nelflow-save__native-records"),
  ).some((control) => control.closest(".nelflow-save")?.dataset.resolverId === resolver.resolverId);
  const hide =
    hasControl &&
    getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS) &&
    getSetting(SETTINGS.STACK_FIRST_NATIVE_RECORDS) === "hide-behind-stack" &&
    !show;
  for (const id of recordIds(resolver)) {
    const element = renderedMessage(id);
    if (!element) continue;
    element.dataset.nelflowSaveResolverId = resolver.resolverId;
    element.classList.toggle("nelflow-save-native-hidden", hide);
  }
}

function registerNative(message, html, marker) {
  const resolverMessage = Array.from(game.messages).find(
    (candidate) => candidate.getFlag?.(MODULE_ID, "saveResolver")?.resolverId === marker.resolverId,
  );
  const resolver = resolverMessage?.getFlag(MODULE_ID, "saveResolver");
  if (!resolver || !recordIds(resolver).includes(message.id)) return;
  html.classList.add("nelflow-save-native");
  html.dataset.nelflowSaveResolverId = marker.resolverId;
  if (!html.querySelector(":scope > .nelflow-save-native-label")) {
    const target = resolver.targets.find(
      (entry) => entry.targetEntryId === marker.targetEntryId,
    );
    const roleLabel = {
      source: localize("Nelflow.SaveResolver.RecordSpell"),
      save: target
        ? format("Nelflow.SaveResolver.RecordSaveTarget", {
            target: target.targetDisplayName,
          })
        : localize("Nelflow.SaveResolver.RecordSave"),
      damage: localize("Nelflow.SaveResolver.RecordDamage"),
      application: target
        ? format("Nelflow.SaveResolver.RecordApplicationTarget", {
            target: target.targetDisplayName,
          })
        : localize("Nelflow.SaveResolver.RecordApplication"),
    }[marker.role];
    if (roleLabel) {
      const label = document.createElement("div");
      label.className = "nelflow-save-native-label";
      const text = document.createElement("span");
      text.textContent = roleLabel;
      label.append(text);
      if (getSetting(SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS)) {
        const toggle = button(
          localize("Nelflow.Native.ShowDetails"),
          "nelflow-save-native-toggle",
          "fa-solid fa-chevron-down",
        );
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => {
          const expanded = html.classList.toggle("nelflow-save-native-collapsed") === false;
          const nextLabel = localize(
            expanded ? "Nelflow.Native.HideDetails" : "Nelflow.Native.ShowDetails",
          );
          toggle.title = nextLabel;
          toggle.setAttribute("aria-label", nextLabel);
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.lastChild.textContent = nextLabel;
          const icon = toggle.querySelector("i");
          icon?.classList.toggle("fa-chevron-up", expanded);
          icon?.classList.toggle("fa-chevron-down", !expanded);
        });
        label.append(toggle);
        html.classList.add("nelflow-save-native-collapsed");
      }
      const header = Array.from(html.children).find((child) =>
        child.classList.contains("message-header"),
      );
      if (header) header.after(label);
      else html.prepend(label);
    }
  }
  updateNativeVisibility(resolver);
}

function outcomeLabel(outcome) {
  return localize(
    {
      criticalFailure: "Nelflow.Outcome.CriticalFailure",
      failure: "Nelflow.Outcome.Failure",
      success: "Nelflow.Outcome.Success",
      criticalSuccess: "Nelflow.Outcome.CriticalSuccess",
    }[outcome] ?? "Nelflow.SaveResolver.Pending",
  );
}

function phaseLabel(phase) {
  return localize(`Nelflow.SaveResolver.Phase.${phase}`);
}

function multiplierLabel(multiplier) {
  return localize(
    {
      0: "Nelflow.SaveResolver.NoDamage",
      0.5: "Nelflow.SaveResolver.Half",
      1: "Nelflow.SaveResolver.Full",
      2: "Nelflow.SaveResolver.Double",
    }[multiplier] ?? "Nelflow.SaveResolver.Pending",
  );
}

function applicationLabel(target) {
  if (target.applicationState === "applied") {
    return game.user.isGM || visibleMessage(target.applicationMessageId)
      ? format("Nelflow.SaveResolver.AppliedHp", { amount: target.appliedAmount ?? 0 })
      : localize("Nelflow.State.Applied");
  }
  return localize(
    {
      pending: "Nelflow.SaveResolver.Pending",
      "no-damage": "Nelflow.SaveResolver.NoDamage",
      "not-applied": "Nelflow.State.NotApplied",
      manual: "Nelflow.SaveResolver.Manual",
      undone: "Nelflow.State.Undone",
      "undo-blocked": "Nelflow.State.UndoBlocked",
    }[target.applicationState] ?? "Nelflow.State.Error",
  );
}

function reveal(messageId, resolver) {
  nativeVisibility.set(resolver.resolverId, true);
  updateNativeVisibility(resolver);
  const element = renderedMessage(messageId);
  if (!element) {
    ui.notifications.warn("Nelflow.Notification.NativeMessageNotRendered", { localize: true });
    return;
  }
  element.classList.remove("nelflow-save-native-hidden");
  element.classList.remove("nelflow-save-native-collapsed");
  const toggle = element.querySelector(":scope > .nelflow-save-native-label button");
  if (toggle) {
    const label = localize("Nelflow.Native.HideDetails");
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", "true");
    toggle.lastChild.textContent = label;
  }
  NativeCardCompactor.reveal(messageId);
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

function detailButton(messageId, resolver, label) {
  const control = button(label, "nelflow-save__record", "fa-solid fa-file-lines");
  control.disabled = !visibleMessage(messageId);
  control.addEventListener("click", () => reveal(messageId, resolver));
  return control;
}

function renderTarget(resolverMessage, resolver, target) {
  const row = document.createElement("li");
  row.className = `nelflow-save__target nelflow-save__target--${target.applicationState}`;
  row.dataset.targetEntryId = target.targetEntryId;
  const image = document.createElement("img");
  image.className = "nelflow-save__target-image";
  image.src = target.targetImage;
  image.alt = "";

  const body = document.createElement("div");
  body.className = "nelflow-save__target-body";
  const name = document.createElement("strong");
  name.textContent = target.targetDisplayName;
  const result = document.createElement("div");
  result.className = "nelflow-save__result";
  const outcome = activeOutcome(target);
  const outcomeVisible =
    game.user.isGM ||
    visibleMessage(target.saveMessageId) ||
    target.ownerUserIds.includes(game.user.id);
  const visibleOutcome = outcomeVisible ? outcome : null;
  const damageVisible = game.user.isGM || visibleMessage(resolver.damage?.messageId);
  const applicationText =
    resolver.damage?.messageId || target.applicationState !== "pending"
      ? applicationLabel(target)
      : null;
  result.append(
    document.createTextNode(
      [
        outcome
          ? visibleOutcome
            ? outcomeLabel(visibleOutcome)
            : localize("Nelflow.SaveResolver.SaveComplete")
          : outcomeLabel(null),
        visibleOutcome ? multiplierLabel(SAVE_MULTIPLIERS[visibleOutcome]) : null,
        damageVisible ? SaveResolverService.damageText(target.damageSummary) || null : null,
        applicationText,
        target.override?.outcome ? localize("Nelflow.SaveResolver.Adjusted") : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  body.append(name, result);

  const controls = document.createElement("div");
  controls.className = "nelflow-save__controls";
  const isAuthorGm = game.user.isGM && game.user.id === resolver.authoringUserId;
  const canGmRoll =
    isAuthorGm && (target.kind === "npc" || target.ownerUserIds.length === 0);
  const isOwner = !game.user.isGM && target.kind === "pc" && target.ownerUserIds.includes(game.user.id);
  if (
    target.saveState === "pending" &&
    ["collecting-saves", "ready"].includes(resolver.phase) &&
    (canGmRoll || isOwner)
  ) {
    const roll = button(
      canGmRoll ? localize("Nelflow.SaveResolver.GmRoll") : localize("Nelflow.SaveResolver.RollSave"),
      "nelflow-save__roll",
      "fa-solid fa-dice-d20",
    );
    roll.addEventListener("click", () => run(() => SaveResolverService.rollSave(resolverMessage, target.targetEntryId)));
    controls.append(roll);
  }
  if (isAuthorGm && target.saveState === "complete" && ["collecting-saves", "ready"].includes(resolver.phase)) {
    const select = document.createElement("select");
    select.className = "nelflow-save__override";
    select.setAttribute("aria-label", localize("Nelflow.SaveResolver.Override"));
    const values = [
      ["native", "Nelflow.SaveResolver.UseNative"],
      ["criticalSuccess", "Nelflow.Outcome.CriticalSuccess"],
      ["success", "Nelflow.Outcome.Success"],
      ["failure", "Nelflow.Outcome.Failure"],
      ["criticalFailure", "Nelflow.Outcome.CriticalFailure"],
    ];
    for (const [value, key] of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = localize(key);
      select.append(option);
    }
    select.value = target.override?.outcome ?? "native";
    const overrideReason = document.createElement("input");
    overrideReason.type = "text";
    overrideReason.className = "nelflow-save__override-reason";
    overrideReason.value = target.override?.reason ?? "";
    overrideReason.placeholder = localize("Nelflow.SaveResolver.OverrideReason");
    overrideReason.setAttribute(
      "aria-label",
      localize("Nelflow.SaveResolver.OverrideReason"),
    );
    select.addEventListener("change", () =>
      run(() => SaveResolverService.setOverride(
        resolverMessage,
        target.targetEntryId,
        select.value === "native" ? null : select.value,
        overrideReason.value,
      )),
    );
    overrideReason.addEventListener("change", () => {
      if (select.value !== "native") {
        run(() =>
          SaveResolverService.setOverride(
            resolverMessage,
            target.targetEntryId,
            select.value,
            overrideReason.value,
          ),
        );
      }
    });
    const reset = button(localize("Nelflow.SaveResolver.ResetSave"), "nelflow-save__reset", "fa-solid fa-rotate");
    reset.addEventListener("click", () => run(() => SaveResolverService.resetSave(resolverMessage, target.targetEntryId)));
    controls.append(select, overrideReason, reset);
  }
  if (
    isAuthorGm &&
    getSetting(SETTINGS.ENABLE_UNDO) &&
    target.applicationState === "applied" &&
    !target.undoBlocked
  ) {
    const undo = button(localize("Nelflow.Status.Undo"), "nelflow-save__undo", "fa-solid fa-rotate-left");
    undo.addEventListener("click", () => run(() => SaveResolverService.undo(resolverMessage, target.targetEntryId)));
    controls.append(undo);
  }

  const details = document.createElement("details");
  details.className = "nelflow-save__details";
  const summary = document.createElement("summary");
  summary.textContent = localize("Nelflow.Stack.Details");
  details.append(summary);
  if (target.saveMessageId) {
    details.append(detailButton(target.saveMessageId, resolver, localize("Nelflow.SaveResolver.RecordSave")));
  }
  if (target.applicationMessageId) {
    details.append(detailButton(target.applicationMessageId, resolver, localize("Nelflow.SaveResolver.RecordApplication")));
  }
  if (details.childElementCount > 1) controls.append(details);
  row.append(image, body, controls);
  return row;
}

function renderResolver(message, html, resolver) {
  const content = html.querySelector(".message-content") ?? html;
  const article = document.createElement("article");
  article.className = "nelflow-save";
  article.dataset.resolverId = resolver.resolverId;
  const header = document.createElement("header");
  header.className = "nelflow-save__header";
  const image = document.createElement("img");
  image.src = resolver.spellImage;
  image.alt = "";
  const title = document.createElement("div");
  const showDc = game.user.isGM || game.pf2e?.settings?.metagame?.dcs === true;
  title.innerHTML = `<strong></strong><small></small>`;
  title.querySelector("strong").textContent = resolver.spellName;
  title.querySelector("small").textContent = format("Nelflow.SaveResolver.Header", {
    dc: showDc ? resolver.save.dc : "?",
    save: localize(`Nelflow.SaveResolver.Save.${resolver.save.type}`),
  });
  const nativeIds = recordIds(resolver);
  const records = button(
    format("Nelflow.Stack.NativeRecords", { count: nativeIds.length }),
    "nelflow-save__native-records",
    "fa-solid fa-box-archive",
  );
  records.setAttribute("aria-expanded", String(nativeVisibility.get(resolver.resolverId) === true));
  records.addEventListener("click", () => {
    nativeVisibility.set(resolver.resolverId, nativeVisibility.get(resolver.resolverId) !== true);
    records.setAttribute("aria-expanded", String(nativeVisibility.get(resolver.resolverId) === true));
    updateNativeVisibility(resolver);
  });
  header.append(image, title, records);

  const progress = document.createElement("div");
  progress.className = "nelflow-save__progress";
  const complete = resolver.targets.filter((target) => target.saveState === "complete").length;
  progress.textContent = `${format("Nelflow.SaveResolver.Progress", {
    complete,
    total: resolver.targets.length,
  })} · ${phaseLabel(resolver.phase)}`;

  const rows = document.createElement("ol");
  rows.className = "nelflow-save__targets";
  rows.setAttribute("aria-label", localize("Nelflow.SaveResolver.TargetsAria"));
  for (const target of resolver.targets) rows.append(renderTarget(message, resolver, target));

  const footer = document.createElement("footer");
  footer.className = "nelflow-save__footer";
  const isAuthorGm = game.user.isGM && game.user.id === resolver.authoringUserId;
  if (isAuthorGm && resolver.phase === RESOLVER_PHASES.COLLECTING) {
    const batch = button(localize("Nelflow.SaveResolver.RollPendingNpc"), "nelflow-save__batch", "fa-solid fa-dice");
    batch.addEventListener("click", () => run(() => SaveResolverService.rollPendingNpcSaves(message)));
    footer.append(batch);
  }
  const sourceItem = game.messages.get(resolver.sourceMessageId)?.item;
  const sourceResolvable =
    sourceItem?.isOfType?.("spell") && sourceItem.uuid === resolver.spellItemUuid;
  if (
    isAuthorGm &&
    refreshResolverPhase(resolver) === RESOLVER_PHASES.READY &&
    !resolver.damage.messageId &&
    sourceResolvable
  ) {
    const resolve = button(localize("Nelflow.SaveResolver.ResolveDamage"), "nelflow-save__resolve", "fa-solid fa-burst");
    resolve.addEventListener("click", () => run(() => SaveResolverService.resolveDamage(message)));
    footer.append(resolve);
  }
  if (isAuthorGm && ["collecting-saves", "ready"].includes(resolver.phase)) {
    const cancel = button(localize("Nelflow.SaveResolver.Cancel"), "nelflow-save__cancel", "fa-solid fa-ban");
    cancel.addEventListener("click", () => run(() => SaveResolverService.cancel(message)));
    footer.append(cancel);
  }
  if (resolver.damage.messageId) {
    footer.append(detailButton(resolver.damage.messageId, resolver, localize("Nelflow.SaveResolver.RecordDamage")));
  }
  article.append(header, progress, rows, footer);
  content.replaceChildren(article);
  html.classList.add("nelflow-save-message");
  updateNativeVisibility(resolver);
}

function renderSource(message, html, source) {
  if (!source?.eligible || !message.visible || !message.isContentVisible) return;
  if (getSetting(SETTINGS.BASIC_SAVE_WORKFLOW) !== BASIC_SAVE_WORKFLOW_MODES.LEGACY) return;
  if (source.resolverMessageId) return;
  if (!game.user.isGM || message.author?.id !== game.user.id) return;
  if (html.querySelector(".nelflow-save-start")) return;
  const start = button(
    localize("Nelflow.SaveResolver.Start"),
    "nelflow-save-start",
    "fa-solid fa-list-check",
  );
  start.addEventListener("click", () => run(() => SaveResolverService.start(message)));
  const host = html.querySelector(".card-buttons") ?? html.querySelector(".message-content") ?? html;
  host.append(start);
}

export function renderSaveResolverChat(message, html) {
  const resolver = SaveResolverService.getResolver(message);
  if (resolver) {
    if (
      resolver.schemaVersion !== 1 ||
      !Array.isArray(resolver.targets) ||
      resolver.targets.length === 0 ||
      !resolver.resolverId
    ) return true;
    if (message.visible && message.isContentVisible) renderResolver(message, html, resolver);
    return true;
  }
  const marker = message.getFlag?.(MODULE_ID, "saveResolverNative");
  if (marker) registerNative(message, html, marker);
  renderSource(message, html, SaveResolverService.getSource(message));
  return false;
}

export function failOpenSaveResolver(resolverId) {
  if (!resolverId) return;
  for (const element of document.querySelectorAll("[data-nelflow-save-resolver-id]")) {
    if (element.dataset.nelflowSaveResolverId === resolverId) {
      element.classList.remove("nelflow-save-native-hidden");
    }
  }
}
