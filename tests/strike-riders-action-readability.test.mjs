import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const {
  RIDER_KINDS,
  plainNoteText,
  noteVisibleToCurrentUser,
  isDamageComponentNoiseNote,
  classifyRiderKind,
  normalizeRiderFromNote,
  collectStrikeRiders,
  shouldExpandStrikeRiders,
} = await import("../scripts/strike-riders.js");

const {
  resolveActionTargetDisplay,
  detectActionImmunity,
  detectApplyEffectsControl,
  inspectActionResultPresentation,
} = await import("../scripts/action-result-presentation.js");

function installGame(user = { isGM: true, isOwner: false }) {
  globalThis.game = {
    user,
    i18n: {
      localize: (key) => {
        const map = {
          "PF2E.Actor.Creature.CriticalSpecialization": "Critical Specialization",
          "PF2E.Item.Weapon.CriticalSpecialization.sword":
            "The target is made off-guard until the start of your next turn.",
          "PF2E.Item.Weapon.CriticalSpecialization.hammer":
            "The target is knocked @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}.",
          "Nelflow.Roll.HiddenTarget": "Hidden Target",
          "Nelflow.Native.Target": "Target",
          "Nelflow.Outcome.Success": "Success",
          "Nelflow.Outcome.Failure": "Failure",
          "Nelflow.Action.Immune": "Immune",
          "Nelflow.Action.NoEffect": "No effect",
        };
        return map[key] ?? key;
      },
      format: (key, data) => `${key}:${JSON.stringify(data ?? {})}`,
    },
    pf2e: { settings: { tokens: { nameVisibility: true } } },
    messages: { get: () => null },
    modules: { get: () => null },
  };
}

test("version is 0.14.6", () => {
  assert.match(source("module.json"), /"version": "0.14.6"/);
  assert.match(source("package.json"), /"version": "0.14.6"/);
});

test("1. Critical Strike with no riders shows no empty Rider section", () => {
  installGame();
  const riders = collectStrikeRiders({
    attackMessage: { flags: { pf2e: { context: { notes: [] } } } },
    damageMessage: { flags: { pf2e: { context: { notes: [] } } } },
    outcome: "criticalSuccess",
  });
  assert.equal(riders.length, 0);
  assert.equal(shouldExpandStrikeRiders({ outcome: "criticalSuccess", riders }), false);
  assert.match(source("scripts/chat-ui.js"), /if \(!riders\.length\) return null/);
});

test("2. Authoritative critical specialization appears as rider", () => {
  installGame();
  const note = {
    title: "PF2E.Actor.Creature.CriticalSpecialization",
    text: "PF2E.Item.Weapon.CriticalSpecialization.hammer",
    outcome: ["criticalSuccess"],
    visibility: null,
  };
  const rider = normalizeRiderFromNote(note, "damage-context-notes", 0);
  assert.ok(rider);
  assert.equal(rider.kind, RIDER_KINDS.CRITICAL_SPECIALIZATION);
  assert.match(rider.label, /Critical Specialization/i);
  assert.match(rider.detail ?? "", /Prone/i);
});

test("3. Crit rider auto-expands", () => {
  assert.equal(
    shouldExpandStrikeRiders({
      outcome: "criticalSuccess",
      riders: [{ kind: "note", actionable: false }],
    }),
    true,
  );
});

test("4. Normal hit rider is preserved", () => {
  installGame();
  const riders = collectStrikeRiders({
    attackMessage: {
      flags: {
        pf2e: {
          context: {
            notes: [
              {
                title: "Grab",
                text: "The target is @UUID[x]{Grabbed}.",
                outcome: ["success"],
              },
            ],
          },
        },
      },
    },
    outcome: "success",
  });
  assert.equal(riders.length, 1);
  assert.equal(riders[0].kind, RIDER_KINDS.CONDITION);
});

test("5-7. Deadly/Fatal/bonus damage alone do not create fake riders", () => {
  assert.equal(isDamageComponentNoiseNote({ title: "Deadly", text: "deadly" }), true);
  assert.equal(isDamageComponentNoiseNote({ title: "Fatal", text: "fatal d12" }), true);
  assert.equal(isDamageComponentNoiseNote({ title: "Sneak Attack", text: "2d6" }), true);
  assert.equal(
    isDamageComponentNoiseNote({
      title: "PF2E.Actor.Creature.CriticalSpecialization",
      text: "PF2E.Item.Weapon.CriticalSpecialization.sword",
    }),
    false,
  );
});

test("8. persistent-damage effect rider is preserved when authoritative", () => {
  installGame();
  const rider = normalizeRiderFromNote(
    { title: "Persistent Damage", text: "1d6 persistent fire", outcome: ["success"] },
    "damage-context-notes",
  );
  assert.equal(rider.kind, RIDER_KINDS.PERSISTENT_DAMAGE);
});

test("9. condition rider preserved when authoritative", () => {
  assert.equal(
    classifyRiderKind({ title: "Effect", text: "The target is clumsy 1" }),
    RIDER_KINDS.CONDITION,
  );
});

test("10. save/follow-up rider preserved when authoritative", () => {
  assert.equal(
    classifyRiderKind({
      title: "Critical Specialization",
      text: "The target must succeed at a @Check[type:fortitude] save",
    }),
    RIDER_KINDS.CRITICAL_SPECIALIZATION,
  );
  assert.equal(
    classifyRiderKind({ title: "Follow-Up", text: "Roll a @Check[type:reflex] save" }),
    RIDER_KINDS.SAVE,
  );
});

test("11-12. actionable native control remains accessible; card not irretrievably hidden", () => {
  const ui = source("scripts/chat-ui.js");
  const compactor = source("scripts/native-card-compactor.js");
  assert.match(ui, /OpenRiderDetails|nelflow-stack__rider-details/);
  assert.match(ui, /NativeCardCompactor\.reveal/);
  assert.match(compactor, /nelflow-native-record-hidden/);
  assert.match(compactor, /Rider \/ Details navigation must be able to recover/);
});

test("13. hidden GM-only note not shown to player", () => {
  installGame({ isGM: false, isOwner: false });
  assert.equal(noteVisibleToCurrentUser({ visibility: "gm", text: "secret" }), false);
  assert.equal(
    normalizeRiderFromNote(
      {
        title: "PF2E.Actor.Creature.CriticalSpecialization",
        text: "PF2E.Item.Weapon.CriticalSpecialization.sword",
        visibility: "gm",
      },
      "damage-context-notes",
    ),
    null,
  );
});

test("14. player-visible RollNote remains visible", () => {
  installGame({ isGM: false, isOwner: false });
  assert.ok(
    normalizeRiderFromNote(
      {
        title: "PF2E.Actor.Creature.CriticalSpecialization",
        text: "PF2E.Item.Weapon.CriticalSpecialization.sword",
        visibility: null,
      },
      "damage-context-notes",
    ),
  );
});

test("15. rider extraction does not mutate mechanics", () => {
  const riders = source("scripts/strike-riders.js");
  assert.doesNotMatch(riders, /applyDamage|createEmbeddedDocuments|updateEmbeddedDocuments/);
  assert.doesNotMatch(riders, /\.defeated\s*=/);
});

test("16. no hard-coded PF2e critical-specialization rules table", () => {
  const riders = source("scripts/strike-riders.js");
  assert.doesNotMatch(riders, /hammer\s*→|sword\s*→|spear\s*→|group === \"hammer\"/);
  assert.doesNotMatch(riders, /criticalSpecializationEffects\s*=/);
});

test("17-19. crit-spec access follows authoritative notes only", () => {
  installGame();
  assert.equal(
    collectStrikeRiders({
      damageMessage: { flags: { pf2e: { context: { notes: [] } } } },
      outcome: "criticalSuccess",
    }).length,
    0,
  );
  assert.equal(
    collectStrikeRiders({
      damageMessage: {
        flags: {
          pf2e: {
            context: {
              notes: [
                {
                  title: "PF2E.Actor.Creature.CriticalSpecialization",
                  text: "PF2E.Item.Weapon.CriticalSpecialization.sword",
                  outcome: ["criticalSuccess"],
                },
              ],
            },
          },
        },
      },
      outcome: "criticalSuccess",
    }).length,
    1,
  );
});

test("20. structured visible target resolves correct display name", () => {
  installGame({ isGM: true });
  globalThis.fromUuidSync = (uuid) => {
    if (uuid === "Token.abc") return { name: "Cyclops Zombie", playersCanSeeName: false, actor: { isOwner: false } };
    return null;
  };
  const resolved = resolveActionTargetDisplay({ tokenUuid: "Token.abc" });
  assert.equal(resolved.name, "Cyclops Zombie");
  assert.equal(resolved.visible, true);
});

test("21. hidden target does not leak", () => {
  installGame({ isGM: false, isOwner: false });
  globalThis.fromUuidSync = () => ({
    name: "Cyclops Zombie",
    playersCanSeeName: false,
    actor: { isOwner: false },
  });
  const resolved = resolveActionTargetDisplay({ tokenUuid: "Token.abc" });
  assert.equal(resolved.name, "Hidden Target");
  assert.equal(resolved.visible, false);
  assert.doesNotMatch(resolved.name, /Cyclops/);
});

test("22. literal Unknown string is not blindly replaced without authority", () => {
  const src = source("scripts/action-result-presentation.js");
  assert.doesNotMatch(src, /replace\(.*Unknown/);
  assert.match(src, /Never blindly replaces the literal string \"Unknown\"/);
});

test("23. target UUID/doc objects do not leak into rendered output", () => {
  installGame({ isGM: true });
  globalThis.fromUuidSync = () => ({ name: "Bandit", playersCanSeeName: true, actor: {} });
  const resolved = resolveActionTargetDisplay({ tokenUuid: "Token.xyz" });
  assert.equal(typeof resolved.name, "string");
  assert.equal(resolved.name, "Bandit");
});

test("24-27. authoritative mental immunity renders IMMUNE / MENTAL", () => {
  installGame();
  const message = {
    id: "m1",
    content: "<p>Immune to MENTAL</p>",
    flags: {
      pf2e: { context: { notes: [], options: ["action:demoralize"], outcome: "success", type: "skill-check" } },
      demoralize: { immune: true, trait: "mental" },
    },
  };
  const immunity = detectActionImmunity(message);
  assert.equal(immunity.immune, true);
  assert.ok(immunity.traits.includes("MENTAL"));
  const src = source("scripts/action-result-presentation.js");
  assert.doesNotMatch(src, /if \(slug === \"demoralize\"\) return \{ immune: true/);
});

test("28-32. required apply-effects control remains accessible and is not auto-clicked", () => {
  const control = detectApplyEffectsControl({
    content: '<hr>@Compendium[xdy-pf2e-workbench.asymonous-benefactor-macros.abc]{Click to apply effects and immunity}',
  });
  assert.equal(control.present, true);
  assert.equal(control.owner, "xdy-pf2e-workbench");
  const src = source("scripts/action-result-presentation.js");
  assert.match(src, /never auto-clicks|Never auto-clicks|never auto-click/i);
  assert.doesNotMatch(src, /\.click\(\)|dispatchEvent\(new MouseEvent\(\"click\"/);
  assert.match(src, /nelflow-action-details|ShowDetails/);
  assert.match(src, /controlPreserved:\s*true/);
});

test("33-36. safe action card compacts with Details link; no duplicate mechanical controls", () => {
  const src = source("scripts/action-result-presentation.js");
  assert.match(src, /nelflow-action-summary/);
  assert.match(src, /nelflow-action-native-detail/);
  assert.match(source("scripts/chat-ui.js"), /renderActionResultPresentation/);
  assert.doesNotMatch(src, /applyFrightened|createCondition|Actor\.createEmbeddedDocuments/);
});

test("plainNoteText strips enrichment safely", () => {
  installGame();
  assert.equal(
    plainNoteText("The target is @UUID[Compendium.pf2e.conditionitems.Item.x]{Prone}."),
    "The target is Prone.",
  );
});

test("regression: no new HP/condition application engine; Toolbelt & bridges preserved", () => {
  const riders = source("scripts/strike-riders.js");
  const actions = source("scripts/action-result-presentation.js");
  assert.doesNotMatch(riders + actions, /system\.attributes\.hp/);
  assert.match(source("scripts/nelcine-defeated-bridge.js"), /broadcastDefeated/);
  assert.match(source("scripts/nelcine-impact-bridge.js"), /strikeImpact|impact/i);
  assert.match(source("scripts/toolbelt-target-helper-adapter.js"), /3\.53/);
});

test("diagnostics APIs are installed", () => {
  assert.match(source("scripts/strike-riders.js"), /installStrikeRidersPublicApi/);
  assert.match(source("scripts/strike-riders.js"), /inspectStrikeRidersMessage/);
  assert.match(source("scripts/strike-riders.js"), /watchStrikeRiders/);
  assert.match(source("scripts/main.js"), /installStrikeRidersPublicApi/);
  assert.match(source("scripts/main.js"), /installActionResultPresentationApi/);
});
