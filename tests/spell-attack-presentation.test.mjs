import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSpellAttackSnapshot } from "../scripts/spell-attack-model.js";
import {
  getStrikePresentationMode,
  STRIKE_PRESENTATION_MODES,
  usesNativeAugmentedStrikePresentation,
} from "../scripts/strike-presentation-mode.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

describe("0.14.20 spell-attack native presentation", () => {
  it("1. spell-attack selects native-augmented presentation like character Strikes", () => {
    const transaction = { transactionType: "spell-attack", snapshot: { actionName: "Ray of Frost" } };
    assert.equal(getStrikePresentationMode(transaction), STRIKE_PRESENTATION_MODES.NATIVE_AUGMENTED);
    assert.equal(usesNativeAugmentedStrikePresentation(transaction), true);
  });

  it("2. NPC Strikes remain canonical-stack", () => {
    assert.equal(
      getStrikePresentationMode({ transactionType: "strike", snapshot: { actorType: "npc" } }),
      STRIKE_PRESENTATION_MODES.CANONICAL_STACK,
    );
  });

  it("3. compact summary prefers actionName when strikeName is absent", () => {
    const compactor = source("scripts/native-card-compactor.js");
    assert.match(compactor, /function actionLabel\(transaction\)/);
    assert.match(compactor, /snapshot\?\.strikeName/);
    assert.match(compactor, /snapshot\?\.actionName/);
    assert.match(compactor, /Nelflow\.Stack\.UnknownStrike/);
  });

  it("4. spell-attack snapshot retains actionName and targetName", () => {
    const snapshot = buildSpellAttackSnapshot(
      {
        contextType: "attack-roll",
        isStrike: false,
        isSpell: true,
        isSpellAttack: true,
        sourceActorUuid: "Actor.caster",
        sourceItemUuid: "Actor.caster.Item.ray",
        actionName: "Ray of Frost",
        attackMessageId: "atk1",
        targetActorUuid: "Actor.goblin",
        targetTokenUuid: "Scene.s1.Token.goblin",
        targetName: "Bog Mummy",
        targetCount: 1,
        outcome: "criticalSuccess",
        authorUserId: "u1",
        authorActive: true,
        authorOwnsSource: true,
      },
      { processingUserId: "gm", sessionId: "s" },
    );
    assert.equal(snapshot.actionName, "Ray of Frost");
    assert.equal(snapshot.targetName, "Bog Mummy");
  });

  it("5. spell-attack UI reuses native damage-host application footer", () => {
    const ui = source("scripts/spell-attack-ui.js");
    assert.match(ui, /usesNativeAugmentedStrikePresentation/);
    assert.match(ui, /isPlayerStrikePresentationHost/);
    assert.match(ui, /Nelflow\.PlayerStrike\.Application\.Applied/);
    assert.match(ui, /nelflow-player-strike-application/);
    assert.doesNotMatch(ui, /Unknown Strike/);
  });

  it("6. presentation-mode documents spell-attack native surface", () => {
    const mode = source("scripts/strike-presentation-mode.js");
    assert.match(mode, /spell attacks/);
    assert.match(mode, /transactionType === "spell-attack"/);
  });

  it("7. version metadata is 0.14.20", () => {
    assert.equal(JSON.parse(source("module.json")).version, "0.14.20");
    assert.equal(JSON.parse(source("package.json")).version, "0.14.20");
  });
});
