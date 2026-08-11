import { classifyBasicSaveSource } from "./basic-save-source-classifier.js";

const TOOLBELT_ID = "pf2e-toolbelt";
/** Inclusive floor for known Target Helper flag semantics. */
export const TOOLBELT_MIN_VERSION = "3.52.0";
/**
 * Inclusive ceiling for versions whose Target Helper flag contract has been
 * structurally verified against NelFlow's adapter (includes 3.53.1).
 */
export const TOOLBELT_MAX_VERSION = "3.53.1";
const SAVE_TYPES = new Set(["fortitude", "reflex", "will"]);
const OUTCOMES = new Set(["criticalSuccess", "success", "failure", "criticalFailure"]);

function versionParts(version) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Known-compatible Toolbelt versions for Target Helper automation.
 * Prefer evaluateToolbeltCompatibility for capability-aware decisions.
 */
export function isSupportedToolbeltVersion(version) {
  const minimum = compareVersions(version, TOOLBELT_MIN_VERSION);
  const maximum = compareVersions(version, TOOLBELT_MAX_VERSION);
  return minimum !== null && maximum !== null && minimum >= 0 && maximum <= 0;
}

/**
 * Capability/structure probe for Target Helper. Prefer this over a bare version gate.
 * @param {object} args
 * @returns {{
 *   version: string|null,
 *   supported: boolean,
 *   targetFlagsSupported: boolean,
 *   resultRowsSupported: boolean,
 *   damageControlsSupported: boolean,
 *   reason: string|null
 * }}
 */
export function evaluateToolbeltCompatibility(args = {}) {
  const version = args.version ?? null;
  const versionOk = isSupportedToolbeltVersion(version);
  const raw = args.rawFlag ?? null;
  const hasType = raw && typeof raw.type === "string";
  const hasTargets = Array.isArray(raw?.targets);
  const hasSaveVariants = raw?.saveVariants && typeof raw.saveVariants === "object";
  const basicVariants = Object.values(raw?.saveVariants ?? {}).filter(
    (save) => save?.basic === true && SAVE_TYPES.has(save?.statistic),
  );
  const targetFlagsSupported = Boolean(hasType && hasTargets && hasSaveVariants);
  const resultRowsSupported = Boolean(
    targetFlagsSupported &&
      (basicVariants.length === 0 ||
        basicVariants.some((save) => save?.saves && typeof save.saves === "object")),
  );
  // Markup-only probe: when absent/unknown, do not disable save processing.
  const damageControlsSupported =
    args.damageControlsSupported === true
      ? true
      : args.damageControlsSupported === false
        ? false
        : versionOk;

  if (!versionOk) {
    return {
      version,
      supported: false,
      targetFlagsSupported: false,
      resultRowsSupported: false,
      damageControlsSupported: false,
      reason: "toolbelt-version-unverified",
    };
  }

  // Version alone is enough for module-level support when no flag sample is provided.
  if (!raw) {
    return {
      version,
      supported: true,
      targetFlagsSupported: true,
      resultRowsSupported: true,
      damageControlsSupported,
      reason: null,
    };
  }

  if (!targetFlagsSupported || !resultRowsSupported) {
    return {
      version,
      supported: false,
      targetFlagsSupported,
      resultRowsSupported,
      damageControlsSupported: false,
      reason: "toolbelt-target-flags-unproven",
    };
  }

  return {
    version,
    supported: true,
    targetFlagsSupported: true,
    resultRowsSupported: true,
    damageControlsSupported,
    reason: null,
  };
}

export function electProcessingGm(users, authorUserId) {
  const active = [...users]
    .filter((user) => user?.active && user?.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return active.find((user) => user.id === authorUserId)?.id ?? active[0]?.id ?? null;
}

function fingerprintValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function targetIdentityFingerprint(targets) {
  return fingerprintValue(
    [...(targets ?? [])].map((target) => ({
      tokenUuid: target.tokenUuid,
      actorUuid: target.actorUuid,
    })),
  );
}

export function toolbeltStateFingerprint(data) {
  return fingerprintValue({
    targets: data.targets,
    splashTargets: data.splashTargets,
    splashIndex: data.splashIndex,
    applied: data.applied,
    saveVariants: Object.fromEntries(
      Object.entries(data.saveVariants ?? {}).map(([key, save]) => [
        key,
        {
          basic: save?.basic,
          dc: save?.dc,
          statistic: save?.statistic,
          saves: Object.fromEntries(
            Object.entries(save?.saves ?? {}).map(([targetId, result]) => [
              targetId,
              {
                success: result?.success,
                rerolled: result?.rerolled ?? null,
                roll: result?.roll ?? null,
              },
            ]),
          ),
        },
      ]),
    ),
  });
}

function isNativeDamageRoll(roll) {
  return Boolean(roll && Array.isArray(roll.instances) && typeof roll.alter === "function");
}

function hasPersistentDamage(roll) {
  if (roll?.options?.evaluatePersistent) return true;
  return (roll?.instances ?? []).some((instance) =>
    [instance?.type, instance?.category, instance?.options?.category].includes("persistent"),
  );
}

export function selectToolbeltDamageRoll(rolls, splashIndex) {
  const regularRolls = [...(rolls ?? [])]
    .map((roll, index) => ({ roll, index }))
    .filter(
      ({ roll, index }) =>
        isNativeDamageRoll(roll) &&
        roll.options?.splashOnly !== true &&
        index !== Number(splashIndex),
    );
  if (regularRolls.length !== 1) {
    return { ok: false, reason: "shared-damage-ambiguous", count: regularRolls.length };
  }
  const [selected] = regularRolls;
  return { ok: true, ...selected };
}

function rawFlag(message) {
  return message?.flags?.[TOOLBELT_ID]?.targetHelper ?? null;
}

function structuredMessageMode(message) {
  const contextMode = message?.flags?.pf2e?.context?.messageMode;
  if (["public", "gm", "blind", "self"].includes(contextMode)) return contextMode;
  if (message?.blind === true) return "blind";
  const recipients = [...(message?.whisper ?? [])].map((user) => user?.id ?? user).filter(Boolean);
  if (!recipients.length) return "public";
  const authorId = message?.author?.id ?? message?.user?.id ?? null;
  if (recipients.length === 1 && recipients[0] === authorId) return "self";
  if (recipients.every((userId) => game.users?.get(userId)?.isGM === true)) return "gm";
  return "private";
}

/**
 * Toolbelt Target Helper boundary. Prefer evaluateToolbeltCompatibility over a
 * bare version string. Public APIs remain limited to getMessageTargets /
 * setMessageFlagTargets; NelFlow reads persisted Target Helper flags only.
 */
export class ToolbeltTargetHelperAdapter {
  static module() {
    return game.modules?.get(TOOLBELT_ID) ?? null;
  }

  static status() {
    const module = this.module();
    const active = module?.active === true;
    const version = module?.version ?? module?.manifest?.version ?? null;
    let enabled = false;
    if (active) {
      try {
        enabled = game.settings.get(TOOLBELT_ID, "targetHelper.enabled") === true;
      } catch {
        enabled = false;
      }
    }
    const compatibility = evaluateToolbeltCompatibility({ version });
    return {
      active,
      enabled,
      version,
      supported: active && compatibility.supported,
      compatibility,
      publicApi: game.toolbelt?.targetHelper ?? null,
      hasPublicApplyApi: false,
      hasPublicQueueApi: false,
    };
  }

  static readRawData(message) {
    return rawFlag(message);
  }

  /** Normalize a live Toolbelt source card without reading rendered markup. */
  static normalizeSourceMessage(message) {
    const status = this.status();
    if (!status.active) return { ok: false, reason: "toolbelt-inactive", status };
    if (!status.enabled) return { ok: false, reason: "target-helper-disabled", status };
    if (!status.supported) return { ok: false, reason: "toolbelt-version-unsupported", status };

    const data = rawFlag(message);
    if (!data || !["spell", "action"].includes(data.type)) {
      return { ok: false, reason: "not-toolbelt-basic-save-source", status };
    }
    const item = message?.item ?? null;
    const actor = message?.actor ?? null;
    const origin = message?.flags?.pf2e?.origin ?? null;
    if (!item?.uuid || !actor?.uuid || item.actor?.uuid !== actor.uuid) {
      return { ok: false, reason: "source-document-unavailable", status };
    }

    const sourceKind = item.isOfType?.("spell")
      ? "spell"
      : item.isOfType?.("action")
        ? "npc-ability"
        : "unknown";
    if (sourceKind === "unknown") {
      return { ok: false, reason: "source-item-type-unsupported", status };
    }
    if (
      origin?.actor !== actor.uuid ||
      origin?.uuid !== item.uuid ||
      (sourceKind === "spell" && origin.type !== "spell") ||
      (sourceKind === "npc-ability" && origin.type !== "action")
    ) {
      return { ok: false, reason: "source-origin-mismatch", status, sourceKind };
    }
    if (
      sourceKind === "npc-ability" &&
      (data.author !== actor.uuid || data.item !== item.uuid)
    ) {
      return { ok: false, reason: "source-toolbelt-identity-mismatch", status, sourceKind };
    }

    const variantId = sourceKind === "spell" ? item.variantId ?? "null" : "null";
    const directVariant = data.saveVariants?.[variantId];
    const basicVariants = Object.entries(data.saveVariants ?? {}).filter(
      ([, save]) => save?.basic === true && SAVE_TYPES.has(save?.statistic),
    );
    const selected = directVariant?.basic === true && SAVE_TYPES.has(directVariant.statistic)
      ? [variantId, directVariant]
      : basicVariants.length === 1
        ? basicVariants[0]
        : null;
    if (!selected) {
      return { ok: false, reason: "basic-save-variant-ambiguous", status, sourceKind };
    }
    const [selectedVariantId, save] = selected;
    const classification = sourceKind === "spell"
      ? classifyBasicSaveSource({
          message,
          toolbeltSource: {
            sourceActorUuid: actor.uuid,
            sourceItemUuid: item.uuid,
            isBasicSave: true,
            saveType: save.statistic,
          },
          rollIndex: 0,
        })
      : null;
    if (classification && (!classification.ok || classification.sourceKind !== sourceKind)) {
      return {
        ok: false,
        reason: classification.reason ?? "source-classification-mismatch",
        status,
        sourceKind,
      };
    }

    const seen = new Set();
    const targets = [];
    for (const tokenUuid of data.targets ?? []) {
      if (typeof tokenUuid !== "string" || seen.has(tokenUuid)) continue;
      seen.add(tokenUuid);
      const token = fromUuidSync(tokenUuid, { strict: false });
      if (!token?.id || !token.actor?.uuid) continue;
      targets.push({
        toolbeltTargetKey: token.id,
        tokenUuid,
        actorUuid: token.actor.uuid,
      });
    }
    const targetFingerprint = targetIdentityFingerprint(targets);
    const castRank = Number.isInteger(origin.castRank) ? origin.castRank : null;
    const overlayIds = Array.isArray(origin.variant?.overlays)
      ? [...origin.variant.overlays].map(String).sort()
      : [];
    const actionVariant = sourceKind === "npc-ability"
      ? (origin.variant?.id ?? null)
      : null;
    const messageMode = structuredMessageMode(message);
    const sourceFingerprint = fingerprintValue({
      sourceMessageId: message.id,
      sourceKind,
      sourceActorUuid: actor.uuid,
      sourceItemUuid: item.uuid,
      sourceUserId: message.author?.id ?? message.user?.id ?? null,
      saveType: save.statistic,
      selectedVariantId,
      sourceClassifierVersion: classification?.classifierVersion ?? null,
      castRank,
      overlayIds,
      actionVariant,
      context: message.flags?.pf2e?.context?.type ?? null,
      messageMode,
    });

    return {
      ok: true,
      status,
      message,
      actor,
      item,
      sourceMessageId: message.id,
      sourceKind,
      sourceActorUuid: actor.uuid,
      sourceActorType: actor.type ?? null,
      sourceItemUuid: item.uuid,
      sourceItemType: item.type ?? null,
      sourceUserId: message.author?.id ?? message.user?.id ?? null,
      saveType: save.statistic,
      isBasicSave: true,
      selectedVariantId,
      sourceClassifierVersion: classification?.classifierVersion ?? null,
      castRank,
      overlayIds,
      actionVariant,
      messageMode,
      targets,
      targetFingerprint,
      sourceFingerprint,
    };
  }

  static normalizeDamageMessage(message) {
    const status = this.status();
    if (!status.active) return { ok: false, reason: "toolbelt-inactive", status };
    if (!status.enabled) return { ok: false, reason: "target-helper-disabled", status };
    if (!status.supported) return { ok: false, reason: "toolbelt-version-unsupported", status };
    if (!message?.isDamageRoll) return { ok: false, reason: "not-native-damage", status };
    if (message.getFlag?.("nelflow", "saveResolverNative")) {
      return { ok: false, reason: "legacy-resolver-owned", status };
    }
    if (message.getFlag?.("nelflow", "transaction")) {
      return { ok: false, reason: "strike-damage-owned", status };
    }

    const data = rawFlag(message);
    if (!data || data.type !== "damage") return { ok: false, reason: "not-toolbelt-damage", status };
    if (data.isRegen) return { ok: false, reason: "healing-unsupported", status };
    const variants = Object.entries(data.saveVariants ?? {}).filter(
      ([, save]) => save?.basic === true && SAVE_TYPES.has(save?.statistic),
    );
    if (variants.length !== 1) return { ok: false, reason: "basic-save-not-unique", status };
    const [variantId, save] = variants[0];
    const toolbeltSource = {
      sourceActorUuid: data.author ?? null,
      sourceItemUuid: data.item ?? null,
      isBasicSave: true,
      saveType: save.statistic,
    };

    const selectedRoll = selectToolbeltDamageRoll(message.rolls, data.splashIndex);
    if (!selectedRoll.ok) {
      const source = classifyBasicSaveSource({ message, toolbeltSource, rollIndex: null });
      return { ok: false, reason: selectedRoll.reason, status, source };
    }
    const { roll, index: rollIndex } = selectedRoll;
    if (Number(roll.total) < 0 || roll.kinds?.has?.("healing")) {
      return { ok: false, reason: "healing-unsupported", status };
    }
    const source = classifyBasicSaveSource({ message, toolbeltSource, rollIndex });
    if (!source.ok) return { ok: false, reason: source.reason, status, source };

    const seen = new Set();
    const targets = [];
    for (let order = 0; order < (data.targets ?? []).length; order += 1) {
      const tokenUuid = data.targets[order];
      if (typeof tokenUuid !== "string" || seen.has(tokenUuid)) continue;
      seen.add(tokenUuid);
      const token = fromUuidSync(tokenUuid, { strict: false });
      const actor = token?.actor;
      if (!token?.id || !actor?.uuid) continue;
      const result = save.saves?.[token.id];
      const outcome = OUTCOMES.has(result?.success) ? result.success : null;
      const dieResult = Number.isFinite(result?.die) ? Number(result.die) : null;
      const total = Number.isFinite(result?.value) ? Number(result.value) : null;
      const modifiers = Array.isArray(result?.modifiers)
        ? result.modifiers
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => ({
              excluded: entry.excluded === true,
              label: typeof entry.label === "string" ? entry.label : null,
              modifier: Number.isFinite(entry.modifier) ? Number(entry.modifier) : null,
              slug: typeof entry.slug === "string" ? entry.slug : null,
            }))
        : null;
      const modifierTotal = Array.isArray(modifiers)
        ? modifiers.reduce((sum, entry) => {
            if (entry.excluded || !Number.isFinite(entry.modifier)) return sum;
            return sum + entry.modifier;
          }, 0)
        : null;
      targets.push({
        toolbeltTargetKey: token.id,
        actorUuid: actor.uuid,
        tokenUuid,
        sceneId: token.parent?.id ?? null,
        targetType: "primary",
        isPrimaryTarget: true,
        isSplashTarget: false,
        saveType: save.statistic,
        isBasicSave: true,
        saveState: outcome ? "resolved" : "pending",
        degreeOfSuccess: outcome,
        dieResult,
        total,
        modifier: Number.isFinite(modifierTotal) ? modifierTotal : null,
        modifiers,
        rerolled: typeof result?.rerolled === "string" ? result.rerolled : null,
        canApply: Boolean(outcome),
        toolbeltAppliedState: data.applied?.[token.id]?.[rollIndex] === true,
        saveFingerprint: result
          ? fingerprintValue({ success: result.success, rerolled: result.rerolled ?? null, roll: result.roll })
          : null,
        private: result?.private === true,
        order,
      });
    }
    if (!targets.length) return { ok: false, reason: "no-valid-primary-targets", status };

    return {
      ok: true,
      status,
      message,
      damageRoll: roll,
      rollIndex,
      variantId,
      saveType: save.statistic,
      saveDC: save.dc,
      sourceKind: source.sourceKind,
      sourceActorUuid: source.sourceActorUuid,
      sourceActorType: source.sourceActorType,
      sourceItemUuid: source.sourceItemUuid,
      sourceItemType: source.sourceItemType,
      sourceMessageId: source.sourceMessageId,
      sourceActionSlug: source.sourceActionSlug,
      isSpell: source.isSpell,
      isNpcAbility: source.isNpcAbility,
      sourceClassifierVersion: source.classifierVersion,
      eligibilityEvidenceVersion: source.eligibilityEvidenceVersion,
      eligibilityEvidence: source.eligibilityEvidence,
      sourceUserId: message.author?.id ?? message.user?.id ?? null,
      targets,
      targetFingerprint: targetIdentityFingerprint(targets),
      splashTargetUuids: [...(data.splashTargets ?? [])],
      sourceCastRank: Number.isInteger(message.flags?.pf2e?.origin?.castRank)
        ? message.flags.pf2e.origin.castRank
        : null,
      sourceOverlayIds: Array.isArray(message.flags?.pf2e?.origin?.variant?.overlays)
        ? [...message.flags.pf2e.origin.variant.overlays].map(String).sort()
        : [],
      persistent: hasPersistentDamage(roll),
      schemaFingerprint: toolbeltStateFingerprint(data),
    };
  }
}

export const TOOLBELT_OUTCOMES = OUTCOMES;
