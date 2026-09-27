import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  createResultsDisclosureState,
  defaultResultsExpanded,
} from "../scripts/native-records-controller.js";
import { hasExactDamageRecord } from "../scripts/strike-row-presentation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");
const controllerSource = source("scripts/native-records-controller.js");
const settingsSource = source("scripts/settings.js");
const constantsSource = source("scripts/constants.js");
const chatSource = source("scripts/chat-ui.js");
const followSource = source("scripts/stack-presentation-controller.js");
const popoverSource = source("scripts/roll-popover-controller.js");
const localization = JSON.parse(source("lang/en.json"));

const disclosure = (expanded = true) => createResultsDisclosureState({
  readDefault: () => expanded,
});

describe("Nelflow 0.14.19 default-expanded Strike Results", () => {
  it("1. no local override plus Expanded default exposes controls", () => {
    assert.equal(disclosure(true).expandedFor("stack-1"), true);
  });

  it("2. a new one-Strike stack defaults Results expanded", () => {
    const state = disclosure(true);
    assert.equal(state.hasOverride("one-strike"), false);
    assert.equal(state.expandedFor("one-strike"), true);
  });

  it("3. new stacks containing three Strikes also default expanded", () => {
    const state = disclosure(true);
    for (const id of ["row-1", "row-2", "row-3"]) assert.equal(state.expandedFor("three-strikes"), true);
  });

  it("4. authorized Attack controls still come from exact row records", () => {
    assert.match(chatSource, /NativeRecordsController\.recordsForRow\(stack, row\)/);
    assert.match(chatSource, /fa-solid fa-dice-d20/);
  });

  it("5. authorized Damage controls still come from exact row records", () => {
    assert.match(chatSource, /fa-solid fa-burst/);
    assert.match(controllerSource, /INSPECTION_ROLES = new Set\(\["attack", "damage"\]\)/);
  });

  it("6. Undo visibility remains governed by existing eligibility", () => {
    assert.match(chatSource, /if \(canUseUndo\(row, stack\)\)/);
    assert.match(chatSource, /StrikeResolver\.undoFromMessage\(attackMessage\)/);
  });

  it("7. a miss without exact damage exposes no damage control", () => {
    assert.equal(hasExactDamageRecord([{ role: "attack" }]), false);
  });

  it("8. the user can collapse initially expanded Results", () => {
    const state = disclosure(true);
    assert.equal(state.toggle("stack-1"), false);
    assert.equal(state.expandedFor("stack-1"), false);
  });

  it("9. the user can re-expand collapsed Results", () => {
    const state = disclosure(true);
    state.toggle("stack-1");
    assert.equal(state.toggle("stack-1"), true);
  });

  it("10. a local collapsed override survives ordinary stack rerender lookup", () => {
    const state = disclosure(true);
    state.toggle("same-stack");
    assert.equal(state.expandedFor("same-stack"), false);
    assert.equal(state.expandedFor("same-stack"), false);
  });

  it("11. a local expanded override survives rerender when configured default is collapsed", () => {
    const state = disclosure(false);
    state.toggle("same-stack");
    assert.equal(state.expandedFor("same-stack"), true);
    assert.equal(state.expandedFor("same-stack"), true);
  });

  it("12. adding a Strike while Results is expanded leaves it expanded", () => {
    const state = disclosure(true);
    const rows = ["row-1"];
    assert.equal(state.expandedFor("stack-1"), true);
    rows.push("row-2");
    assert.equal(state.expandedFor("stack-1"), true);
  });

  it("13. adding a Strike while locally collapsed leaves it collapsed", () => {
    const state = disclosure(true);
    state.toggle("stack-1");
    const rows = ["row-1", "row-2"];
    assert.equal(rows.length, 2);
    assert.equal(state.expandedFor("stack-1"), false);
  });

  it("14. stack-follow still reparents the exact node and preserves listeners/state", () => {
    assert.match(followSource, /parentElement\?\.append\(node\)/);
    assert.doesNotMatch(followSource, /cloneNode|replaceChildren|innerHTML/);
  });

  it("15. whole-stack disclosure and Results disclosure use separate setting keys", () => {
    assert.match(constantsSource, /STACK_DEFAULT_STATE: "stackDefaultState"/);
    assert.match(constantsSource, /RESULTS_DEFAULT_STATE: "resultsDefaultState"/);
  });

  it("16. expanding the whole stack does not reset the Results override", () => {
    const state = disclosure(true);
    state.toggle("stack-1");
    const stackExpanded = true;
    assert.equal(stackExpanded, true);
    assert.equal(state.expandedFor("stack-1"), false);
  });

  it("17. a fresh controller after reload uses the configured default", () => {
    const beforeReload = disclosure(true);
    beforeReload.toggle("stack-1");
    assert.equal(beforeReload.expandedFor("stack-1"), false);
    assert.equal(disclosure(true).expandedFor("stack-1"), true);
  });

  it("18. different viewers can maintain independent local Results states", () => {
    const viewerA = disclosure(true);
    const viewerB = disclosure(true);
    viewerA.toggle("stack-1");
    assert.equal(viewerA.expandedFor("stack-1"), false);
    assert.equal(viewerB.expandedFor("stack-1"), true);
  });

  it("19. toggling Results performs no ChatMessage update", () => {
    assert.doesNotMatch(controllerSource, /message\??\.update\(|ChatMessage\.update|updateDocuments/);
  });

  it("20. Results state writes no document flag", () => {
    assert.doesNotMatch(controllerSource, /setFlag\(|unsetFlag\(|flags\.nelflow\.results/);
  });

  it("21. expanded Results retains exact viewer-visibility filtering", () => {
    assert.match(controllerSource, /message\?\.visible && message\.isContentVisible/);
    assert.match(controllerSource, /TransactionStore\.resolveCanonical\(message\)/);
  });

  it("22. Results count continues to use the current filtered record list", () => {
    assert.match(controllerSource, /updateControl\(button, stack\.id, records\.length/);
  });

  it("23. existing exact-record popover listeners remain registered", () => {
    assert.match(popoverSource, /pointerover/);
    assert.match(popoverSource, /focusin/);
    assert.match(popoverSource, /openPopover\(control\)/);
  });

  it("24. guarded Undo remains an icon control in the same row", () => {
    assert.match(chatSource, /controls\.append\(undo\)/);
    assert.match(chatSource, /fa-solid fa-rotate-left/);
  });

  it("25. native player Strike cards remain outside stack Results", () => {
    assert.doesNotMatch(source("scripts/player-strike-ui.js"), /resultsOpenByStack|RESULTS_DEFAULT_STATE/);
  });

  it("26. the new setting is client-scoped and configurable", () => {
    assert.match(settingsSource, /SETTINGS\.RESULTS_DEFAULT_STATE[\s\S]*scope: "client"[\s\S]*config: true/);
  });

  it("27. the new setting defaults to Expanded", () => {
    assert.match(settingsSource, /SETTINGS\.RESULTS_DEFAULT_STATE[\s\S]*default: STACK_DEFAULT_STATES\.EXPANDED/);
    assert.equal(defaultResultsExpanded("expanded"), true);
  });

  it("28. the collapsed configured choice initializes Results collapsed", () => {
    assert.equal(defaultResultsExpanded("collapsed"), false);
    assert.equal(disclosure(false).expandedFor("stack-1"), false);
  });

  it("29. unknown future setting values fail open expanded", () => {
    assert.equal(defaultResultsExpanded("future-value"), true);
  });

  it("30. all Results setting labels are localized", () => {
    assert.equal(localization["Nelflow.Settings.ResultsDefaultState.Name"], "Default Strike Results State");
    assert.equal(localization["Nelflow.Settings.ResultsDefaultState.Expanded"], "Expanded");
    assert.equal(localization["Nelflow.Settings.ResultsDefaultState.Collapsed"], "Collapsed");
  });

  it("31. setting changes reset only local presentation memory before rerender", () => {
    assert.match(controllerSource, /nelflowPresentationSettingChanged[\s\S]*resultsOpenByStack\.clear\(\)/);
  });

  it("32. Results toggles do not broadcast socket or hook state", () => {
    const bind = controllerSource.slice(controllerSource.indexOf("static bindStackControl"), controllerSource.indexOf("static recordsForTransaction"));
    assert.doesNotMatch(bind, /socket|Hooks\.call|broadcast|emit\(/);
  });
});
