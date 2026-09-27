import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAttackRollInspection,
  buildDamageRollInspection,
  inspectionKind,
} from "../scripts/strike-roll-inspection.js";
import {
  createStackPresentationController,
  defaultStackExpanded,
  hasStackRowProjectionChange,
  isActiveCombatStack,
  repositionRenderedStack,
  stackRenderRevision,
} from "../scripts/stack-presentation-controller.js";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

class NumericTerm {
  constructor(number, flavor = null) {
    this.number = number;
    this.options = { flavor };
  }
}

const die = (faces, values, flavor = null) => ({
  faces,
  number: values.length,
  results: values.map((value) => ({ result: Math.abs(value), active: value >= 0 })),
  total: Math.max(...values.map(Math.abs)),
  options: { flavor },
});

const attackMessage = (changes = {}) => ({
  flags: {
    pf2e: {
      context: { dc: { value: 23 }, outcome: "success" },
      modifiers: [
        { label: "Strength", slug: "strength", type: "ability", modifier: 4, enabled: true },
        { label: "Multiple Attack Penalty", slug: "multiple-attack-penalty", type: "untyped", modifier: -5, enabled: true },
      ],
    },
  },
  rolls: [{
    options: { type: "attack-roll", action: "strike" },
    formula: "1d20 + 9",
    total: 25,
    dice: [die(20, [16])],
  }],
  ...changes,
});

const transaction = (changes = {}) => ({
  transactionType: "strike",
  snapshot: {
    strikeName: "Shortsword",
    outcome: "success",
    mapPenalty: -5,
    targetTokenUuid: "Scene.s.Token.target",
    targetActorUuid: "Actor.target",
  },
  ...changes,
});

const attack = (message = attackMessage(), current = transaction(), changes = {}) =>
  buildAttackRollInspection({
    message,
    transaction: current,
    canInspectTarget: () => true,
    targetLabel: () => "Grim",
    hiddenTargetLabel: "Hidden Target",
    ...changes,
  });

test("attack inspection reads the exact evaluated d20", () => assert.equal(attack().natural, 16));
test("attack inspection reads the final total", () => assert.equal(attack().total, 25));
test("attack inspection derives the evaluated final modifier", () => assert.equal(attack().finalModifier, 9));
test("attack inspection preserves the exact MAP modifier", () => assert.equal(attack().mapPenalty, -5));
test("attack inspection retains named structured modifiers", () => assert.deepEqual(attack().modifiers.map((entry) => entry.label), ["Strength", "Multiple Attack Penalty"]));
test("attack inspection retains modifier types", () => assert.equal(attack().modifiers[0].type, "ability"));
test("attack inspection retains the evaluated formula", () => assert.equal(attack().formula, "1d20 + 9"));
test("attack inspection exposes authorized target AC", () => assert.equal(attack().target.ac, 23));
test("attack inspection exposes authorized degree", () => assert.equal(attack().target.outcome, "success"));
test("attack inspection neutralizes unauthorized target name", () => {
  const model = attack(attackMessage(), transaction(), { canInspectTarget: () => false });
  assert.equal(model.target.label, "Hidden Target");
});
test("attack inspection hides unauthorized target AC", () => assert.equal(attack(attackMessage(), transaction(), { canInspectTarget: () => false }).target.ac, null));
test("attack inspection hides unauthorized target degree", () => assert.equal(attack(attackMessage(), transaction(), { canInspectTarget: () => false }).target.outcome, null));
test("natural 20 adjustment remains explicit", () => {
  const message = attackMessage();
  message.rolls[0].dice = [die(20, [20])];
  message.rolls[0].total = 29;
  assert.equal(attack(message).naturalAdjustment, "natural20");
});
test("natural 1 adjustment remains explicit", () => {
  const message = attackMessage();
  message.rolls[0].dice = [die(20, [1])];
  message.rolls[0].total = 10;
  assert.equal(attack(message).naturalAdjustment, "natural1");
});
test("fortune and misfortune retain every d20 face", () => {
  const message = attackMessage();
  message.rolls[0].dice = [die(20, [-4, 17])];
  const model = attack(message);
  assert.deepEqual(model.dice[0].results, [{ value: 4, active: false }, { value: 17, active: true }]);
  assert.equal(model.fortune, "multiple");
});
test("missing attack roll fails safely", () => assert.equal(attack({ rolls: [] }).available, false));
test("missing modifier context falls back to formula and total", () => {
  const message = attackMessage({ flags: { pf2e: { context: {} } } });
  const model = attack(message);
  assert.equal(model.modifiers.length, 0);
  assert.equal(model.formula, "1d20 + 9");
  assert.equal(model.total, 25);
});

const shared = transaction({
  transactionType: "multi-target-strike",
  targets: [
    { order: 0, tokenUuid: "a", ac: 28, outcome: "success", state: "applied" },
    { order: 1, tokenUuid: "b", ac: 22, outcome: "criticalSuccess", state: "applied" },
    { order: 2, tokenUuid: "c", ac: 34, outcome: "failure", state: "miss" },
  ],
});

test("shared-roll inspection marks one attack as shared", () => assert.equal(attack(attackMessage(), shared).shared, true));
test("shared-roll targets preserve capture order", () => assert.deepEqual(attack(attackMessage(), shared).targetResults.map((entry) => entry.order), [0, 1, 2]));
test("shared-roll targets preserve independent outcomes", () => assert.deepEqual(attack(attackMessage(), shared).targetResults.map((entry) => entry.outcome), ["success", "criticalSuccess", "failure"]));
test("shared-roll unauthorized targets are neutralized", () => {
  const model = attack(attackMessage(), shared, { canInspectTarget: () => false });
  assert.equal(model.targetResults.every((entry) => entry.label === "Hidden Target" && entry.ac === null && entry.outcome === null), true);
});
test("shared-roll Review remains explicit", () => {
  const review = { ...shared, targets: [{ ...shared.targets[0], state: "review" }] };
  assert.equal(attack(attackMessage(), review).targetResults[0].review, true);
});

const damageMessage = () => ({
  rolls: [{
    formula: "1d6 + 4",
    total: 8,
    instances: [{
      type: "piercing",
      category: null,
      total: 8,
      roll: {
        formula: "1d6 + 4",
        dice: [die(6, [4], "Weapon")],
        terms: [new NumericTerm(4, "Strength")],
      },
    }],
  }],
});

test("damage inspection reads the exact formula", () => assert.equal(buildDamageRollInspection({ message: damageMessage() }).formula, "1d6 + 4"));
test("damage inspection reads individual die faces", () => assert.deepEqual(buildDamageRollInspection({ message: damageMessage() }).instances[0].dice[0].results.map((entry) => entry.value), [4]));
test("damage inspection reads static modifiers", () => assert.equal(buildDamageRollInspection({ message: damageMessage() }).instances[0].staticTerms[0].value, 4));
test("damage inspection reads damage type", () => assert.equal(buildDamageRollInspection({ message: damageMessage() }).instances[0].type, "piercing"));
test("damage inspection reads final rolled total", () => assert.equal(buildDamageRollInspection({ message: damageMessage() }).total, 8));
test("critical inspection preserves its separate formula", () => {
  const message = damageMessage();
  message.rolls[0].formula = "2d10 + 8 + 1d10";
  message.rolls[0].total = 29;
  const model = buildDamageRollInspection({ message, kind: "criticalDamage" });
  assert.equal(model.kind, "criticalDamage");
  assert.equal(model.formula, "2d10 + 8 + 1d10");
});
test("fatal labels are retained from evaluated terms", () => {
  const message = damageMessage();
  message.rolls[0].instances[0].roll.dice.push(die(10, [7], "Fatal"));
  assert.deepEqual(buildDamageRollInspection({ message }).specialLabels, ["Fatal"]);
});
test("deadly labels are retained from evaluated terms", () => {
  const message = damageMessage();
  message.rolls[0].instances[0].roll.dice.push(die(8, [5], "Deadly"));
  assert.deepEqual(buildDamageRollInspection({ message }).specialLabels, ["Deadly"]);
});
test("missing damage roll fails safely", () => assert.equal(buildDamageRollInspection({ message: { rolls: [] } }).available, false));

test("attack records are classified as Attack", () => assert.equal(inspectionKind({ role: "attack" }), "attack"));
test("ordinary damage records are classified as Damage", () => assert.equal(inspectionKind({ role: "damage", marker: { damageGroup: "normal" } }, shared), "damage"));
test("critical group records are classified as Critical Damage", () => assert.equal(inspectionKind({ role: "damage", marker: { damageGroup: "critical" } }, shared), "criticalDamage"));

test("stack header renders actor and no Round label", () => {
  const chat = source("scripts/chat-ui.js");
  assert.match(chat, /nelflow-stack__actor/);
  assert.doesNotMatch(chat, /Nelflow\.Stack\.Round/);
});
test("durable fallback contains no Round label", () => assert.doesNotMatch(source("scripts/stack-fallback.js"), /Nelflow\.Stack\.Round/));
test("round remains part of internal stack partitioning", () => assert.match(source("scripts/turn-stack-service.js"), /identity\.round/));
test("viewer localization contains no Native Records label", () => assert.doesNotMatch(source("lang/en.json"), /Native Records/));
test("Results count is calculated after role and visibility filtering", () => {
  const controller = source("scripts/native-records-controller.js");
  assert.match(controller, /visibleMessage\(message\)/);
  assert.match(controller, /INSPECTION_ROLES\.has\(record\.role\)/);
});
test("application records remain linked internally", () => assert.match(source("scripts/native-records-controller.js"), /applicationMessageId/));
test("application records are excluded from Results", () => assert.match(source("scripts/native-records-controller.js"), /INSPECTION_ROLES = new Set\(\["attack", "damage"\]\)/));
test("single-target stack renders no Application control", () => assert.doesNotMatch(source("scripts/chat-ui.js"), /Stack\.ApplicationMessage/));
test("multi-target summary renders no Application control", () => assert.doesNotMatch(source("scripts/multi-target-strike-ui.js"), /Stack\.ApplicationMessage/));
test("player summary renders no Application control", () => assert.doesNotMatch(source("scripts/player-strike-ui.js"), /Stack\.ApplicationMessage/));
test("legacy save Results excludes application controls and counts", () => {
  const ui = source("scripts/save-resolver-ui.js");
  assert.doesNotMatch(ui, /detailButton\(target\.applicationMessageId/);
  assert.match(ui, /const nativeIds = resultRecordIds\(resolver\)/);
});
test("Toolbelt Review rows expose no application-record button", () => {
  assert.doesNotMatch(source("scripts/toolbelt-basic-save-ui.js"), /nativeRecordButton|Toolbelt\.ApplicationRecord/);
});
test("save application messages remain internally linked and suppressed independently", () => {
  const ui = source("scripts/save-resolver-ui.js");
  assert.match(ui, /target\.applicationMessageId/);
  assert.match(ui, /applicationRecordIds\(resolver\)/);
});
test("developer linked-card visibility setting remains honored", () => {
  assert.match(source("scripts/native-card-compactor.js"), /shouldSuppressLinkedCards\(\)/);
});
test("exact application proof remains required by per-target Undo", () => assert.match(source("scripts/multi-target-strike-undo.js"), /multiTargetApplicationProof/));
test("exact application proof remains required by single-target Undo", () => assert.match(source("scripts/strike-resolver.js"), /preApplication[\s\S]*postApplication/));
test("linked native messages are hidden only during rendering", () => {
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(compactor, /nelflow-native-record-hidden/);
  assert.doesNotMatch(compactor, /message\.update\(|message\.delete\(|deleteChatMessage/);
});
test("unlinked messages fail open", () => assert.match(source("scripts/native-card-compactor.js"), /if \(!linked \|\| !message\.visible/));
test("canonical-host failure preserves the native recovery surface", () => assert.match(source("scripts/native-card-compactor.js"), /only safe recovery surface/));
test("popover data uses structured rolls and PF2e flags", () => {
  const inspection = source("scripts/strike-roll-inspection.js");
  assert.match(inspection, /message\?\.rolls/);
  assert.match(inspection, /flags\?\.pf2e|flags\.pf2e/);
  assert.doesNotMatch(inspection, /message\.(?:content|flavor)|innerHTML|querySelector/);
});
test("popover manager installs one delegated listener set", () => assert.match(source("scripts/roll-popover-controller.js"), /if \(initialized\) return/));
test("popover supports hover, focus, blur, and Escape", () => {
  const controller = source("scripts/roll-popover-controller.js");
  for (const event of ["pointerover", "pointerout", "focusin", "focusout", "keydown"]) assert.match(controller, new RegExp(event));
  assert.match(controller, /event\.key === "Escape"/);
});
test("popover is viewport clamped and non-interactive", () => {
  assert.match(source("scripts/roll-popover-controller.js"), /window\.innerWidth[\s\S]*window\.innerHeight/);
  assert.match(source("styles/nelflow.css"), /nelflow-roll-popover[\s\S]*pointer-events:\s*none/);
});
test("native suppression persists through exact durable flags", () => {
  const controller = source("scripts/native-records-controller.js");
  assert.match(controller, /getFlag\(MODULE_ID, "stack"\)/);
  assert.match(controller, /TransactionStore\.resolveCanonical/);
});
test("Results is omitted when no inspection records exist", () => {
  assert.match(source("scripts/chat-ui.js"), /if \(!records\.length\) return null/);
  assert.doesNotMatch(source("scripts/player-strike-ui.js"), /Results|recordsForTransaction|RollPopoverController/);
  assert.match(source("scripts/save-resolver-ui.js"), /if \(nativeIds\.length\)/);
});
test("version is 0.14.19", () => {
  const manifest = JSON.parse(source("module.json"));
  assert.equal(manifest.id, "nelflow");
  assert.equal(manifest.version, "0.14.19");
});

const activeStack = (changes = {}) => ({
  id: "stack-1",
  kind: "combat-turn",
  updatedAt: 200,
  rows: [{ id: "row-1" }],
  identity: {
    combatId: "combat-1",
    round: 3,
    combatantId: "combatant-1",
    turnIndex: 2,
    turnMarkerId: "marker-1",
  },
  ...changes,
});

const activeCombat = (changes = {}) => ({
  id: "combat-1",
  started: true,
  round: 3,
  turn: 2,
  combatant: { id: "combatant-1" },
  getFlag: () => ({ markerId: "marker-1" }),
  ...changes,
});

function disclosureView(messageId = "stack-message") {
  const classes = new Set();
  const attributes = new Map();
  let click = null;
  return {
    messageId,
    article: { classList: { toggle: (name, force) => force ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) } },
    rows: { hidden: false },
    button: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      addEventListener: (type, listener) => { if (type === "click") click = listener; },
      click: () => click?.(),
    },
    chevron: { className: "" },
  };
}

function presentationHarness({ keep = true, compact = "npc-strikes", stack = activeStack(), nodes = [] } = {}) {
  const frames = [];
  const scrolls = [];
  const debug = [];
  const root = { contains: (node) => nodes.includes(node) };
  const chat = { element: root, scrollBottom: (options) => scrolls.push(options) };
  const controller = createStackPresentationController({
    settings: (key) => ({
      keepActiveStackAtBottom: keep,
      compactTurnStacks: compact,
      stackDefaultState: "expanded",
    })[key],
    combat: () => activeCombat(),
    chat: () => chat,
    documentRef: () => ({ querySelectorAll: () => nodes }),
    scheduleFrame: (callback) => frames.push(callback),
    debug: (message, data) => debug.push({ message, data }),
  });
  const message = {
    id: "message-1",
    visible: true,
    isContentVisible: true,
    getFlag: () => stack,
  };
  const flush = (limit = 25) => {
    for (let index = 0; frames.length && index < limit; index += 1) frames.shift()();
  };
  return { controller, message, frames, scrolls, debug, flush };
}

test("stack follow recognizes nested row projections", () => assert.equal(hasStackRowProjectionChange({ flags: { nelflow: { stack: { rows: [] } } } }), true));
test("stack follow recognizes flattened row projections", () => assert.equal(hasStackRowProjectionChange({ "flags.nelflow.stack.rows.0.state": "applied" }), true));
test("stack follow ignores unrelated message updates", () => assert.equal(hasStackRowProjectionChange({ content: "ordinary update" }), false));
test("active turn identity accepts its current canonical stack", () => assert.equal(isActiveCombatStack(activeStack(), activeCombat()), true));
test("standalone stacks never follow the combat turn", () => assert.equal(isActiveCombatStack(activeStack({ kind: "standalone" }), activeCombat()), false));
test("earlier-round stacks never follow", () => assert.equal(isActiveCombatStack(activeStack({ identity: { ...activeStack().identity, round: 2 } }), activeCombat()), false));
test("another combatant's stack never follows", () => assert.equal(isActiveCombatStack(activeStack({ identity: { ...activeStack().identity, combatantId: "other" } }), activeCombat()), false));
test("turnIndex-only drift still follows when durable marker matches", () => assert.equal(isActiveCombatStack(activeStack({ identity: { ...activeStack().identity, turnIndex: 1 } }), activeCombat()), true));
test("a stale durable turn marker never follows", () => assert.equal(isActiveCombatStack(activeStack({ identity: { ...activeStack().identity, turnMarkerId: "old" } }), activeCombat()), false));
test("expanded is the default disclosure state", () => assert.equal(defaultStackExpanded("expanded"), true));
test("collapsed is an explicit disclosure state", () => assert.equal(defaultStackExpanded("collapsed"), false));
test("unknown stored disclosure values fail open expanded", () => assert.equal(defaultStackExpanded("future-value"), true));
test("stack render revision is derived from durable projection data", () => assert.match(stackRenderRevision(activeStack()), /^200:[a-z0-9]+$/));
test("same-millisecond row changes have distinct render revisions", () => {
  assert.notEqual(stackRenderRevision(activeStack()), stackRenderRevision(activeStack({ rows: [{ id: "row-1", state: "applied" }] })));
});

function withGameI18n(task) {
  const prior = globalThis.game;
  globalThis.game = { i18n: { localize: (key) => key } };
  try { task(); } finally { globalThis.game = prior; }
}

test("collapsed disclosure hides only the row body", () => withGameI18n(() => {
  const controller = createStackPresentationController({ settings: () => "collapsed" });
  const view = disclosureView();
  controller.enhanceDisclosure(view);
  assert.equal(view.rows.hidden, true);
  assert.equal(view.button.getAttribute("aria-expanded"), "false");
  assert.equal(view.article.classList.contains("nelflow-stack--collapsed"), true);
}));

test("expanded disclosure exposes the row body", () => withGameI18n(() => {
  const controller = createStackPresentationController({ settings: () => "expanded" });
  const view = disclosureView();
  controller.enhanceDisclosure(view);
  assert.equal(view.rows.hidden, false);
  assert.equal(view.button.getAttribute("aria-expanded"), "true");
}));

test("disclosure toggles are keyboard-button click compatible", () => withGameI18n(() => {
  const controller = createStackPresentationController({ settings: () => "expanded" });
  const view = disclosureView();
  controller.enhanceDisclosure(view);
  view.button.click();
  assert.equal(view.rows.hidden, true);
  view.button.click();
  assert.equal(view.rows.hidden, false);
}));

test("collapsed preference survives the same stack rerender", () => withGameI18n(() => {
  const controller = createStackPresentationController({ settings: () => "expanded" });
  const first = disclosureView("same");
  controller.enhanceDisclosure(first);
  first.button.click();
  const rerender = disclosureView("same");
  controller.enhanceDisclosure(rerender);
  assert.equal(rerender.rows.hidden, true);
}));

test("per-viewer disclosure memory is not shared between controllers", () => withGameI18n(() => {
  const first = createStackPresentationController({ settings: () => "expanded" });
  const second = createStackPresentationController({ settings: () => "expanded" });
  const changed = disclosureView("same");
  first.enhanceDisclosure(changed);
  changed.button.click();
  const independent = disclosureView("same");
  second.enhanceDisclosure(independent);
  assert.equal(independent.rows.hidden, false);
}));

test("forget clears only the deleted stack's local disclosure override", () => withGameI18n(() => {
  const controller = createStackPresentationController({ settings: () => "expanded" });
  const changed = disclosureView("forgotten");
  controller.enhanceDisclosure(changed);
  changed.button.click();
  controller.forget("forgotten");
  const rerender = disclosureView("forgotten");
  controller.enhanceDisclosure(rerender);
  assert.equal(rerender.rows.hidden, false);
}));

function renderedNode(id = "message-1", revision = stackRenderRevision(activeStack())) {
  const parent = {
    children: [],
    append(node) {
      this.children = this.children.filter((entry) => entry !== node);
      this.children.push(node);
    },
  };
  const listener = () => "preserved";
  const node = {
    dataset: { nelflowStackId: id, nelflowStackRevision: revision },
    parentElement: parent,
    listener,
  };
  parent.children = [{ id: "newer-message" }, node, { id: "latest-message" }];
  return { node, parent, listener };
}

test("reposition moves the exact existing stack node to its container end", () => {
  const { node, parent } = renderedNode();
  const root = { contains: (candidate) => candidate === node };
  assert.equal(repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(activeStack()) }), 1);
  assert.equal(parent.children.at(-1), node);
});

test("reposition leaves unrelated stack nodes untouched", () => {
  const { node, parent } = renderedNode("other-message");
  const before = [...parent.children];
  const root = { contains: () => true };
  assert.equal(repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(activeStack()) }), 0);
  assert.deepEqual(parent.children, before);
});

test("reposition requires the newly rendered projection revision", () => {
  const { node } = renderedNode("message-1", "199");
  const root = { contains: () => true };
  assert.equal(repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(activeStack()) }), 0);
});

test("DOM reparenting preserves the node and its listeners", () => {
  const { node, listener } = renderedNode();
  const root = { contains: () => true };
  repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(activeStack()) });
  assert.equal(node.listener, listener);
});

test("a live active stack update follows to the bottom and scrolls", () => {
  const { node, parent } = renderedNode();
  const harness = presentationHarness({ nodes: [node] });
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { flags: { nelflow: { stack: { rows: activeStack().rows, updatedAt: 200 } } } }), true);
  harness.flush();
  assert.equal(parent.children.at(-1), node);
  assert.equal(harness.scrolls.length, 1);
  assert.deepEqual(harness.scrolls[0].scrollOptions, { behavior: "smooth", block: "end" });
});

test("follow setting off schedules no DOM work", () => {
  const harness = presentationHarness({ keep: false });
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }), false);
  assert.equal(harness.frames.length, 0);
});

test("compact stacks off schedules no DOM work", () => {
  const harness = presentationHarness({ compact: "off" });
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }), false);
  assert.equal(harness.frames.length, 0);
});

test("historical stack updates schedule no DOM work", () => {
  const stack = activeStack({ identity: { ...activeStack().identity, round: 2 } });
  const harness = presentationHarness({ stack });
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }), false);
  assert.equal(harness.frames.length, 0);
});

test("invisible private stacks schedule no DOM work", () => {
  const harness = presentationHarness();
  harness.message.visible = false;
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }), false);
});

test("empty stack projections schedule no DOM work", () => {
  const harness = presentationHarness({ stack: activeStack({ rows: [] }) });
  assert.equal(harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }), false);
});

test("render hydration alone never follows historical stacks", () => withGameI18n(() => {
  const harness = presentationHarness();
  harness.controller.enhanceDisclosure(disclosureView());
  assert.equal(harness.frames.length, 0);
}));

test("a fresh controller can follow the next live update after reload", () => {
  const { node, parent } = renderedNode();
  const harness = presentationHarness({ nodes: [node] });
  harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.updatedAt": 200 });
  harness.flush();
  assert.equal(parent.children.at(-1), node);
});

test("following works while the viewer keeps the stack collapsed", () => withGameI18n(() => {
  const { node, parent } = renderedNode();
  const harness = presentationHarness({ nodes: [node] });
  const view = disclosureView("message-1");
  harness.controller.enhanceDisclosure(view);
  view.button.click();
  harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] });
  harness.flush();
  const rerender = disclosureView("message-1");
  harness.controller.enhanceDisclosure(rerender);
  assert.equal(parent.children.at(-1), node);
  assert.equal(rerender.rows.hidden, true);
}));

test("missing rendered nodes fail open without throwing", () => {
  const harness = presentationHarness();
  assert.doesNotThrow(() => harness.controller.handleChatMessageUpdate(harness.message, { "flags.nelflow.stack.rows": [] }));
  harness.flush();
  assert.equal(harness.debug.length, 1);
});

test("stack presentation controller contains no document mutation API", () => {
  const controller = source("scripts/stack-presentation-controller.js");
  assert.doesNotMatch(controller, /message\??\.update\(|message\??\.setFlag\(|message\??\.delete\(|ChatMessage\.create|createDocuments|deleteDocuments/);
  assert.match(controller, /parentElement\?\.append\(node\)/);
});

test("stack header keeps Results as a sibling of the disclosure button", () => {
  const chat = source("scripts/chat-ui.js");
  assert.match(chat, /header\.append\(disclosure\)[\s\S]*header\.append\(nativeRecordsButton\)/);
});

test("stack disclosure is a real button with ARIA wiring", () => {
  const chat = source("scripts/chat-ui.js");
  assert.match(chat, /disclosure\.type = "button"/);
  assert.match(chat, /aria-controls/);
  assert.match(source("scripts/stack-presentation-controller.js"), /aria-expanded/);
});

test("new presentation settings are client scoped and independently configured", () => {
  const settings = source("scripts/settings.js");
  assert.match(settings, /KEEP_ACTIVE_STACK_AT_BOTTOM[\s\S]*scope: "client"[\s\S]*config: true[\s\S]*default: true/);
  assert.match(settings, /STACK_DEFAULT_STATE[\s\S]*scope: "client"[\s\S]*config: true[\s\S]*STACK_DEFAULT_STATES\.EXPANDED/);
});

test("reposition preserves stack message ID and durable flags", () => {
  const { node } = renderedNode();
  const stack = activeStack();
  const before = JSON.stringify(stack);
  const root = { contains: () => true };
  repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(stack) });
  assert.equal(node.dataset.nelflowStackId, "message-1");
  assert.equal(JSON.stringify(stack), before);
});

test("collapsed heading remains rendered and Results remains outside hidden rows", () => {
  const chat = source("scripts/chat-ui.js");
  assert.match(chat, /article\.append\(header, rows\)/);
  assert.match(chat, /header\.append\(nativeRecordsButton\)/);
  assert.match(source("scripts/stack-presentation-controller.js"), /view\.rows\.hidden = !expanded/);
});

test("Undo and Results handlers survive exact-node reparenting", () => {
  const { node } = renderedNode();
  node.undoHandler = () => "undo";
  node.resultsHandler = () => "results";
  const root = { contains: () => true };
  repositionRenderedStack({ documentRef: { querySelectorAll: () => [node] }, chat: { element: root }, messageId: "message-1", revision: stackRenderRevision(activeStack()) });
  assert.equal(node.undoHandler(), "undo");
  assert.equal(node.resultsHandler(), "results");
});

test("linked suppression, player cards, and Toolbelt/save renderers remain separate", () => {
  const main = source("scripts/main.js");
  const controller = source("scripts/stack-presentation-controller.js");
  assert.match(source("scripts/chat-ui.js"), /NativeCardCompactor\.render/);
  assert.doesNotMatch(controller, /NativeCardCompactor|renderPlayerStrike|renderToolbeltBasicSave|renderSaveResolverChat/);
  assert.match(main, /ToolbeltBasicSaveService\.handleMessage/);
});

test("localized setting labels match the requested Configure Settings text", () => {
  const localization = source("lang/en.json");
  assert.match(localization, /Keep Active Turn Stack at Bottom/);
  assert.match(localization, /Default Turn Stack State/);
});
