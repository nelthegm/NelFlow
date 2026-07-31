import { classifyBasicSaveSource } from "./basic-save-source-classifier.js";

const TOOLBELT_ID = "pf2e-toolbelt";
export const TOOLBELT_MIN_VERSION = "3.52.0";
export const TOOLBELT_MAX_VERSION = "3.52.1";
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

export function isSupportedToolbeltVersion(version) {
  const minimum = compareVersions(version, TOOLBELT_MIN_VERSION);
  const maximum = compareVersions(version, TOOLBELT_MAX_VERSION);
  return minimum !== null && maximum !== null && minimum >= 0 && maximum <= 0;
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

/**
 * Toolbelt 3.52.x exposes only getMessageTargets/setMessageFlagTargets publicly.
 * This is the sole version-gated boundary that reads its persisted Target Helper flag.
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
    return {
      active,
      enabled,
      version,
      supported: active && isSupportedToolbeltVersion(version),
      publicApi: game.toolbelt?.targetHelper ?? null,
      hasPublicApplyApi: false,
      hasPublicQueueApi: false,
    };
  }

  static readRawData(message) {
    return rawFlag(message);
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
      splashTargetUuids: [...(data.splashTargets ?? [])],
      persistent: hasPersistentDamage(roll),
      schemaFingerprint: toolbeltStateFingerprint(data),
    };
  }
}

export const TOOLBELT_OUTCOMES = OUTCOMES;
