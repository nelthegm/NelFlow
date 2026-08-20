/**
 * Audited PF2e Toolbelt 3.54.1 durable Target Helper fixture.
 *
 * Source: official reonZ/pf2e-toolbelt tag 3.54.1 (158d26b). The schema,
 * save/reroll writers, damage projection, and message-update lifecycle below
 * are byte-identical to official tag 3.54.0 (dbbfe2e).
 */

export const TOOLBELT_3541_AUDIT = Object.freeze({
  tag: "3.54.1",
  commit: "158d26ba7394b26f945c7807545e675822855eb4",
  comparedTag: "3.54.0",
  comparedCommit: "dbbfe2e30e8ac22388057e6edd8dfd95be9df440",
  schemaCompatibility: "3.54.1-audited",
  unrelatedChanges: Object.freeze([
    "target-helper color-blind palette setting and CSS",
    "Foundry/PF2e compatibility metadata",
    "localization",
    "release notes",
  ]),
  identicalContractBlobs: Object.freeze({
    "src/tools/target-helper/data/save-instance.ts": "459a61ef062d931e3b6348b892b61b51cc0ba68c",
    "src/tools/target-helper/data/targets-data.ts": "90eafc3c8524a385980003cd7bf4513bfcd92101",
    "src/tools/target-helper/data/target-helper.ts": "106e1f7ffc78c8e905205a742004f42db436cefe",
    "src/tools/target-helper/tool/_saves.ts": "f8a66b3b486537e91658cde70a552bf0eb56ccc0",
    "src/tools/target-helper/tool/damage.ts": "f74e6d618dc46222b3ee6aced1abc60876a7550d",
  }),
});

export function createToolbelt3541TargetHelperFlag() {
  return {
    type: "damage",
    author: "Actor.caster",
    item: "Item.fireball",
    targets: [
      "Scene.encounter.Token.tokA",
      "Scene.encounter.Token.tokB",
      "Scene.encounter.Token.tokC",
    ],
    splashTargets: [],
    splashIndex: -1,
    applied: {},
    area: null,
    expended: 0,
    isRegen: false,
    options: [],
    private: false,
    traits: ["fire"],
    saveVariants: {
      null: {
        basic: true,
        dc: 36,
        statistic: "reflex",
        saves: {
          tokA: {
            die: 14,
            value: 36,
            success: "success",
            modifiers: [
              { excluded: false, label: "Dexterity", modifier: 7, slug: "dex" },
              { excluded: false, label: "Master", modifier: 15, slug: "proficiency" },
            ],
            notes: [],
            private: false,
            roll: '{"class":"CheckRoll","total":36,"die":14}',
            significantModifiers: [],
            statistic: "reflex",
            unadjustedOutcome: "success",
          },
          tokB: {
            die: 7,
            value: 28,
            success: "failure",
            modifiers: [
              { excluded: false, label: "Dexterity", modifier: 6, slug: "dex" },
              { excluded: false, label: "Expert", modifier: 15, slug: "proficiency" },
            ],
            notes: [],
            private: false,
            rerolled: "hero",
            roll: '{"class":"CheckRoll","total":28,"die":7,"reroll":"hero"}',
            significantModifiers: [],
            statistic: "reflex",
            unadjustedOutcome: "failure",
          },
          tokC: {
            die: 20,
            value: 41,
            success: "criticalSuccess",
            modifiers: [
              { excluded: false, label: "Dexterity", modifier: 6, slug: "dex" },
              { excluded: false, label: "Expert", modifier: 15, slug: "proficiency" },
            ],
            notes: [],
            private: true,
            roll: '{"class":"CheckRoll","total":41,"die":20}',
            significantModifiers: [],
            statistic: "reflex",
            unadjustedOutcome: "criticalSuccess",
          },
        },
      },
    },
  };
}

export function createToolbelt3541DamageMessage() {
  const spell = {
    uuid: "Item.fireball",
    type: "spell",
    slug: "fireball",
    isOfType: (type) => type === "spell",
  };
  return {
    id: "toolbelt-3541-damage",
    isDamageRoll: true,
    author: { id: "gm1" },
    user: { id: "gm1" },
    item: spell,
    actor: { uuid: "Actor.caster", type: "character" },
    rolls: [
      {
        total: 30,
        instances: [{ type: "fire" }],
        options: {},
        kinds: { has: () => false },
        alter() {},
      },
    ],
    flags: {
      "pf2e-toolbelt": { targetHelper: createToolbelt3541TargetHelperFlag() },
      pf2e: {
        context: { type: "damage-roll", messageMode: "public" },
        origin: {
          type: "spell",
          actor: "Actor.caster",
          uuid: "Item.fireball",
          castRank: 3,
        },
      },
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
  };
}

export function tokenFor3541Fixture(uuid) {
  const id = String(uuid).split(".").at(-1);
  if (!["tokA", "tokB", "tokC"].includes(id)) return null;
  return {
    id,
    uuid,
    parent: { id: "encounter" },
    actor: { uuid: `Actor.${id}`, type: "npc" },
  };
}
