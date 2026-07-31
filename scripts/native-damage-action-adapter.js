import { AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES } from "./constants.js";

export const NATIVE_DAMAGE_ACTION_ADAPTER_VERSION = 1;
const SUPPORTED_SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);

function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function ineligible(reason, sourceKind = "unknown") {
  return { ok: false, reason, sourceKind, adapterVersion: NATIVE_DAMAGE_ACTION_ADAPTER_VERSION };
}

export function autorollModeAllows(mode, author) {
  if (mode === AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF) return false;
  if (!author?.active) return false;
  if (mode === AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.GM) return author.isGM === true;
  return mode === AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.ALL;
}

export function userCanInvokeSource(user, actor, item) {
  if (!user || !actor || !item || item.actor?.uuid !== actor.uuid) return false;
  return Boolean(
    item.isOwner ||
      actor.isOwner ||
      actor.canUserModify?.(user, "update") ||
      actor.testUserPermission?.(user, "OWNER"),
  );
}

function hasPersistentComponent(roll) {
  if (roll?.options?.evaluatePersistent) return true;
  return (roll?.instances ?? []).some((instance) =>
    [instance?.type, instance?.category, instance?.options?.category].includes("persistent"),
  );
}

function hasSplashComponent(roll) {
  if (roll?.options?.splashOnly) return true;
  const modifiers = roll?.options?.damage?.modifiers ?? [];
  return modifiers.some((modifier) =>
    [modifier?.category, modifier?.damageCategory].includes("splash"),
  );
}

function rollModePlan(messageMode, user, defaultMessageMode) {
  if (messageMode == null || messageMode === defaultMessageMode) {
    return { ok: true, ctrlKey: false, metaKey: false, rollMode: messageMode ?? defaultMessageMode ?? null };
  }
  if (messageMode === "gm" && user?.isGM) {
    return { ok: true, ctrlKey: true, metaKey: false, rollMode: "gm" };
  }
  if (messageMode === "blind" && !user?.isGM) {
    return { ok: true, ctrlKey: true, metaKey: false, rollMode: "blind" };
  }
  return { ok: false, reason: "roll-visibility-mode-unsupported" };
}

/**
 * Inspect PF2e documents and PF2e's own prepared damage object. Nelflow never
 * reads a formula or description and never creates a replacement roll.
 */
export async function inspectNativeDamageAction({
  normalizedSource,
  user,
  defaultMessageMode,
  showDamageDialogs,
}) {
  if (!normalizedSource?.ok || normalizedSource.isBasicSave !== true) {
    return ineligible(normalizedSource?.reason ?? "source-unavailable", normalizedSource?.sourceKind);
  }
  if (!SUPPORTED_SAVE_TYPES.has(normalizedSource.saveType)) {
    return ineligible("basic-save-unavailable", normalizedSource.sourceKind);
  }
  const { actor, item, sourceKind } = normalizedSource;
  if (!["character", "npc"].includes(actor?.type)) {
    return ineligible("source-actor-type-unsupported", sourceKind);
  }
  if (!userCanInvokeSource(user, actor, item)) {
    return ineligible("source-permission-denied", sourceKind);
  }
  if (!normalizedSource.targets?.length) return ineligible("toolbelt-targets-missing", sourceKind);
  if (sourceKind === "npc-ability") {
    // PF2e 8.3.0 AbilityItemPF2e has no damage method. Its @Damage link is
    // available only through TextEditor/card listeners, which this slice must
    // not call or reverse engineer.
    return ineligible("ability-native-damage-api-unavailable", sourceKind);
  }
  if (sourceKind !== "spell" || !item?.isOfType?.("spell")) {
    return ineligible("source-kind-unsupported", sourceKind);
  }
  if (normalizedSource.message?.flags?.pf2e?.context?.type !== "spell-cast") {
    return ineligible("spell-cast-context-missing", sourceKind);
  }
  if (item.isAttack === true) return ineligible("spell-attack-unsupported", sourceKind);
  if (!Number.isInteger(normalizedSource.castRank) || normalizedSource.castRank !== item.rank) {
    return ineligible("cast-rank-ambiguous", sourceKind);
  }
  if (item.hasVariants && !item.isVariant && !normalizedSource.overlayIds.length) {
    return ineligible("spell-overlay-ambiguous", sourceKind);
  }
  if (typeof item.getDamage !== "function" || typeof item.rollDamage !== "function") {
    return ineligible("native-spell-damage-unavailable", sourceKind);
  }
  if (showDamageDialogs === true) {
    return ineligible("damage-choice-dialog-enabled", sourceKind);
  }
  const rollMode = rollModePlan(normalizedSource.messageMode, user, defaultMessageMode);
  if (!rollMode.ok) return ineligible(rollMode.reason, sourceKind);

  const prepared = await item.getDamage({
    skipDialog: true,
    messageMode: rollMode.rollMode ?? undefined,
  });
  const roll = prepared?.template?.damage?.roll ?? null;
  if (!roll || !Array.isArray(roll.instances) || typeof roll.evaluate !== "function") {
    return ineligible("native-damage-action-missing", sourceKind);
  }
  if (roll.kinds?.has?.("healing") || Number(roll.total) < 0) {
    return ineligible("healing-unsupported", sourceKind);
  }
  if (hasPersistentComponent(roll)) return ineligible("persistent-damage-unsupported", sourceKind);
  if (hasSplashComponent(roll)) return ineligible("splash-damage-unsupported", sourceKind);

  const damageActionId = "spell-damage";
  const damageRollIndex = 0;
  const eligibilityFingerprint = fingerprint({
    sourceFingerprint: normalizedSource.sourceFingerprint,
    targetFingerprint: normalizedSource.targetFingerprint,
    damageActionId,
    damageRollIndex,
    castRank: normalizedSource.castRank,
    overlayIds: normalizedSource.overlayIds,
    rollMode: rollMode.rollMode,
  });
  return {
    ok: true,
    adapterVersion: NATIVE_DAMAGE_ACTION_ADAPTER_VERSION,
    sourceKind,
    sourceMessageId: normalizedSource.sourceMessageId,
    sourceActorUuid: normalizedSource.sourceActorUuid,
    sourceItemUuid: normalizedSource.sourceItemUuid,
    sourceUserId: normalizedSource.sourceUserId,
    castRank: normalizedSource.castRank,
    overlayIds: [...normalizedSource.overlayIds],
    actionVariant: normalizedSource.actionVariant,
    damageActionId,
    damageRollIndex,
    saveType: normalizedSource.saveType,
    isBasicSave: true,
    requiresChoice: false,
    rollMode: rollMode.rollMode,
    eventData: {
      ctrlKey: rollMode.ctrlKey,
      metaKey: rollMode.metaKey,
      shiftKey: false,
    },
    eligibilityFingerprint,
  };
}

export async function invokeNativeDamageAction(item, inspection) {
  if (!inspection?.ok || inspection.damageActionId !== "spell-damage") {
    return { ok: false, reason: "native-invocation-unavailable", roll: null };
  }
  try {
    const roll = await item.rollDamage({ ...inspection.eventData });
    return roll?.instances
      ? { ok: true, reason: null, roll }
      : { ok: false, reason: "native-api-returned-no-roll", roll: null };
  } catch (error) {
    return { ok: false, reason: "native-api-threw", roll: null, error };
  }
}

export function autoDamageIntegrationId(sourceMessageId, nonce) {
  return `auto-damage-roll:${sourceMessageId}:${nonce}`;
}

export function autoDamageCandidateMatches(transaction, normalizedDamage, marker = null) {
  if (!transaction || !normalizedDamage?.ok) return false;
  if (
    marker &&
    (marker.integrationId !== transaction.integrationId ||
      marker.sourceMessageId !== transaction.sourceMessageId ||
      Number(marker.damageRollIndex) !== Number(transaction.damageRollIndex) ||
      marker.targetFingerprint !== transaction.targetFingerprint)
  ) return false;
  return Boolean(
    normalizedDamage.message?.id &&
      normalizedDamage.sourceKind === transaction.sourceKind &&
      normalizedDamage.sourceActorUuid === transaction.sourceActorUuid &&
      normalizedDamage.sourceItemUuid === transaction.sourceItemUuid &&
      normalizedDamage.sourceUserId === transaction.rollingUserId &&
      Number(normalizedDamage.rollIndex) === Number(transaction.damageRollIndex) &&
      normalizedDamage.targetFingerprint === transaction.targetFingerprint &&
      normalizedDamage.sourceCastRank === transaction.castRank &&
      JSON.stringify(normalizedDamage.sourceOverlayIds ?? []) === JSON.stringify(transaction.overlayIds ?? []),
  );
}
