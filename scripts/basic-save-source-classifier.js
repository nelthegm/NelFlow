export const BASIC_SAVE_SOURCE_CLASSIFIER_VERSION = 1;
export const BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION = 1;
const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);

export function sourceModeAllows(sourceKind, mode) {
  return sourceKind === "spell" || (sourceKind === "npc-ability" && mode === "spells-and-npc-abilities");
}

function itemIs(item, type) {
  return item?.isOfType?.(type) === true || item?.type === type;
}

function actorIs(actor, type) {
  return actor?.isOfType?.(type) === true || actor?.type === type;
}

function unsupported(reason, sourceKind = "unknown") {
  return {
    ok: false,
    reason,
    sourceKind,
    classifierVersion: BASIC_SAVE_SOURCE_CLASSIFIER_VERSION,
    eligibilityEvidenceVersion: BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION,
  };
}

/**
 * Classify only structured PF2e/Toolbelt source evidence. This deliberately
 * never reads message content, flavor, labels, or an item's description.
 */
export function classifyBasicSaveSource({ message, toolbeltSource, rollIndex, resolveUuid }) {
  const resolve = resolveUuid ?? ((uuid) => fromUuidSync(uuid, { strict: false }));
  if (toolbeltSource?.isBasicSave !== true || !SAVE_TYPES.has(toolbeltSource.saveType)) {
    return unsupported("basic-save-not-unique");
  }
  const sourceItem = message?.item ?? null;
  const sourceSpell = itemIs(sourceItem, "spell")
    ? sourceItem
    : itemIs(sourceItem, "consumable")
      ? sourceItem.embeddedSpell ?? null
      : null;

  // Preserve Slice 3.1's established spell and consumable-spell eligibility.
  if (sourceSpell?.uuid) {
    return {
      ok: true,
      sourceKind: "spell",
      sourceActorUuid: toolbeltSource?.sourceActorUuid ?? message.actor?.uuid ?? null,
      sourceActorType: message.actor?.type ?? null,
      sourceItemUuid: sourceSpell.uuid,
      sourceItemType: sourceSpell.type ?? "spell",
      sourceMessageId: message.flags?.pf2e?.origin?.messageId ?? null,
      sourceActionSlug: sourceSpell.slug ?? null,
      isSpell: true,
      isNpcAbility: false,
      classifierVersion: BASIC_SAVE_SOURCE_CLASSIFIER_VERSION,
      eligibilityEvidenceVersion: BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION,
      eligibilityEvidence: ["pf2e-spell-document", "toolbelt-basic-save", "single-regular-damage-roll"],
    };
  }

  const origin = message?.flags?.pf2e?.origin ?? null;
  const context = message?.flags?.pf2e?.context ?? null;
  if (!sourceItem) return unsupported("source-item-unavailable");
  if (!itemIs(sourceItem, "action")) return unsupported("source-item-type-unsupported");
  if (!toolbeltSource?.sourceActorUuid) return unsupported("source-actor-unavailable", "npc-ability");
  const sourceActor = resolve(toolbeltSource.sourceActorUuid);
  if (!sourceActor) return unsupported("source-actor-unavailable", "npc-ability");
  if (!actorIs(sourceActor, "npc")) {
    return unsupported(actorIs(sourceActor, "hazard") ? "hazard-source-unsupported" : "non-npc-source", "npc-ability");
  }
  if (message.actor?.uuid !== sourceActor.uuid || sourceItem.actor?.uuid !== sourceActor.uuid) {
    return unsupported("source-actor-mismatch", "npc-ability");
  }
  if (
    !origin ||
    origin.type !== "action" ||
    origin.uuid !== sourceItem.uuid ||
    origin.actor !== sourceActor.uuid ||
    toolbeltSource.sourceItemUuid !== sourceItem.uuid
  ) {
    return unsupported("source-item-identity-mismatch", "npc-ability");
  }
  if (context?.type !== "damage-roll") {
    return unsupported("damage-context-unavailable", "npc-ability");
  }
  if (context.sourceType === "attack" || context.outcome != null || message.flags?.pf2e?.strike) {
    return unsupported("attack-plus-save-unsupported", "npc-ability");
  }
  if (context.sourceType !== "save") {
    return unsupported("damage-not-save-governed", "npc-ability");
  }
  if (!Number.isInteger(rollIndex) || rollIndex < 0) {
    return unsupported("damage-roll-index-ambiguous", "npc-ability");
  }

  return {
    ok: true,
    sourceKind: "npc-ability",
    sourceActorUuid: sourceActor.uuid,
    sourceActorType: "npc",
    sourceItemUuid: sourceItem.uuid,
    sourceItemType: "action",
    // PF2e action origins and Toolbelt 3.52.x do not persist the action-card ID.
    sourceMessageId: origin.messageId ?? null,
    sourceActionSlug: sourceItem.slug ?? null,
    isSpell: false,
    isNpcAbility: true,
    classifierVersion: BASIC_SAVE_SOURCE_CLASSIFIER_VERSION,
    eligibilityEvidenceVersion: BASIC_SAVE_ELIGIBILITY_EVIDENCE_VERSION,
    eligibilityEvidence: [
      "pf2e-npc-actor",
      "pf2e-action-origin",
      "pf2e-save-damage-context",
      "toolbelt-author-match",
      "toolbelt-item-match",
      "toolbelt-basic-save",
      "single-regular-damage-roll",
    ],
  };
}
