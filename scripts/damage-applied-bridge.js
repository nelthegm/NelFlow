/**
 * Post-application correlated damage event (0.14.2 / Slice 5A.3).
 *
 * Emits `nelflow.damageApplied` ONLY after a successful NelFlow-owned
 * Actor#applyDamage path where the exact DamageRoll message is paired with
 * a uniquely captured PF2e `damage-taken` AppliedDamageFlag.
 *
 * Semantics:
 * - `immediateDamageTypes` are PRE-IWR source facts from the DamageRoll.
 * - They are NOT post-IWR residual typed amounts (PF2e does not expose those).
 * - Undo never enters this path.
 */

export const DAMAGE_APPLIED_HOOK = "nelflow.damageApplied";
export const DAMAGE_APPLIED_PROTOCOL = 1;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Extract unique IMMEDIATE damage types from a PF2e DamageRoll.
 * Deferred persistent instances (persistent && !evaluatePersistent) are excluded.
 *
 * @param {object|null|undefined} roll
 * @returns {{
 *   immediateDamageTypes: string[],
 *   hasUntypedImmediate: boolean,
 *   persistentDistinctionReliable: boolean,
 *   unsupported: boolean,
 * }}
 */
export function extractImmediateDamageTypesFromRoll(roll) {
  const empty = {
    immediateDamageTypes: [],
    hasUntypedImmediate: false,
    persistentDistinctionReliable: false,
    unsupported: true,
  };
  if (!roll || !Array.isArray(roll.instances)) return empty;

  const immediate = new Set();
  let hasUntypedImmediate = false;
  let sawPersistentFlag = false;

  for (const instance of roll.instances) {
    if (!instance || typeof instance !== "object") return empty;
    const type = safeString(instance.type)?.toLowerCase();
    if (!type) return empty;

    if ("persistent" in instance) sawPersistentFlag = true;
    const isPersistent = instance.persistent === true;
    const evaluatePersistent = instance.evaluatePersistent === true;

    // Deferred persistent does not contribute to this HP application.
    if (isPersistent && !evaluatePersistent) continue;

    immediate.add(type);
    if (type === "untyped") hasUntypedImmediate = true;
  }

  return {
    immediateDamageTypes: [...immediate].sort(),
    hasUntypedImmediate,
    // If any instance exposed a persistent flag, distinction is considered reliable.
    // Empty rolls with no instances already returned unsupported.
    persistentDistinctionReliable: true,
    unsupported: false,
    // Retain sawPersistentFlag for diagnostics without changing contract.
    _sawPersistentFlag: sawPersistentFlag,
  };
}

/**
 * Resolve an optional source level from known PF2e item/actor fields.
 * Does not invent values — returns null when unknown.
 *
 * @param {{ item?: object|null, actor?: object|null, explicit?: number|null }} input
 * @returns {number|null}
 */
export function resolveDamageSourceLevel(input = {}) {
  const explicit = Number(input.explicit);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.trunc(explicit);

  const item = input.item;
  const castRank = Number(
    item?.system?.location?.heightenedLevel ??
      item?.system?.level?.value ??
      item?.rank ??
      item?.level,
  );
  if (Number.isFinite(castRank) && castRank >= 1) return Math.trunc(castRank);

  const actorLevel = Number(input.actor?.level ?? input.actor?.system?.details?.level?.value);
  if (Number.isFinite(actorLevel) && actorLevel >= 1) return Math.trunc(actorLevel);

  return null;
}

/**
 * Build a plain serializable appliedDamage subset from PF2e AppliedDamageFlag.
 * @param {object|null|undefined} flag
 * @returns {object|null}
 */
export function projectAppliedDamageFlag(flag) {
  if (!flag || typeof flag !== "object") return null;
  const updates = Array.isArray(flag.updates)
    ? flag.updates
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          path: safeString(entry.path),
          value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : null,
        }))
        .filter((entry) => entry.path)
    : [];

  return {
    uuid: safeString(flag.uuid),
    isHealing: flag.isHealing === true,
    updates,
    shield: flag.shield
      ? {
          id: safeString(flag.shield.id),
          damage: Number.isFinite(Number(flag.shield.damage)) ? Number(flag.shield.damage) : null,
        }
      : null,
  };
}

/**
 * Build the versioned integration payload.
 * Returns null when correlation / provenance is insufficient.
 *
 * @param {object} input
 * @returns {object|null}
 */
export function buildDamageAppliedPayload(input = {}) {
  const transactionId = safeString(input.transactionId);
  const targetActorUuid = safeString(input.targetActorUuid);
  const targetTokenUuid = safeString(input.targetTokenUuid);
  if (!transactionId || !targetActorUuid) return null;

  const types = extractImmediateDamageTypesFromRoll(input.damageRoll ?? input.transformedRoll);
  if (types.unsupported) return null;

  const appliedDamage = projectAppliedDamageFlag(input.appliedDamage);
  if (!appliedDamage || appliedDamage.isHealing) return null;

  const payload = {
    protocol: DAMAGE_APPLIED_PROTOCOL,
    type: "damageApplied",
    transactionId,
    target: {
      actorUuid: targetActorUuid,
      tokenUuid: targetTokenUuid,
    },
    source: {
      kind: "damage-roll",
      damageRollMessageUuid: safeString(input.damageRollMessageUuid ?? input.damageMessage?.uuid),
      damageRollMessageId: safeString(input.damageMessage?.id ?? input.damageRollMessageId),
      immediateDamageTypes: types.immediateDamageTypes,
      hasUntypedImmediate: types.hasUntypedImmediate,
      persistentDistinctionReliable: types.persistentDistinctionReliable,
      originActorUuid: safeString(input.originActorUuid),
      originItemUuid: safeString(input.originItemUuid),
      sourceLevel: resolveDamageSourceLevel({
        item: input.sourceItem ?? input.item,
        actor: input.sourceActor ?? input.actor,
        explicit: input.sourceLevel,
      }),
    },
    appliedDamage,
    applicationMessageId: safeString(input.applicationMessageId),
    isUndo: false,
  };

  try {
    JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
  return payload;
}

/**
 * Emit exactly once after successful correlated application.
 * Listener failures never propagate to the damage workflow.
 *
 * @param {object|null} payload
 * @returns {boolean}
 */
export function emitDamageApplied(payload) {
  if (!payload || payload.protocol !== DAMAGE_APPLIED_PROTOCOL) return false;
  try {
    Hooks.callAll(DAMAGE_APPLIED_HOOK, payload);
    return true;
  } catch (error) {
    console.error("NelFlow | damageApplied listener failure", error);
    return false;
  }
}

/**
 * Convenience used by PF2eAdapter after unique damage-taken capture.
 * @param {object} args
 * @returns {object|null}
 */
export function emitDamageAppliedFromApplication(args = {}) {
  const applicationMessage = args.applicationMessage;
  const appliedDamage =
    applicationMessage?.flags?.pf2e?.appliedDamage ??
    applicationMessage?._source?.flags?.pf2e?.appliedDamage ??
    null;
  if (!appliedDamage) return null;

  const payload = buildDamageAppliedPayload({
    transactionId: args.transactionId,
    targetActorUuid: args.targetActorUuid,
    targetTokenUuid: args.targetTokenUuid,
    damageRoll: args.transformedRoll ?? args.damageRoll,
    damageMessage: args.damageMessage,
    appliedDamage,
    applicationMessageId: applicationMessage?.id ?? null,
    originActorUuid: args.sourceActor?.uuid ?? args.originActorUuid,
    originItemUuid: args.sourceItem?.uuid ?? args.originItemUuid,
    sourceItem: args.sourceItem,
    sourceActor: args.sourceActor,
    sourceLevel: args.sourceLevel,
  });
  if (!payload) return null;
  emitDamageApplied(payload);
  return payload;
}

export function installDamageAppliedPublicApi() {
  const root = (game.nelflow ??= {});
  root.integrations = root.integrations ?? {};
  root.integrations.damageApplied = Object.freeze({
    hook: DAMAGE_APPLIED_HOOK,
    protocol: DAMAGE_APPLIED_PROTOCOL,
    /**
     * Semantics note for consumers: immediateDamageTypes are pre-IWR source
     * type presence from the correlated DamageRoll — never post-IWR residuals.
     */
    semantics: Object.freeze({
      immediateDamageTypes: "pre-iwr-source-type-presence",
      postIwrTypedAmounts: false,
    }),
  });
}
