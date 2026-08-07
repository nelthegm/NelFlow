/**
 * Deterministic beneficial/harmful classification for PF2e Effect Items (0.12.0).
 *
 * PF2e does not expose a native buff/debuff polarity field on Effect items.
 * Classification sources (priority order):
 * 1. explicit NelFlow transaction override
 * 2. flags.nelflow.nelcineEffectKind ("beneficial"|"harmful"|null)
 * 3. reviewed stable registry (compendium sourceId, then slug)
 * 4. unsupported → no cinematic
 *
 * Never classify from name, description, icon, or chat HTML.
 */

import { MODULE_ID } from "./constants.js";

export const CLASSIFICATION_SOURCES = Object.freeze({
  TRANSACTION: "transaction",
  NELFLOW_FLAG: "nelflow-flag",
  PF2E_NATIVE: "pf2e-native",
  REGISTRY: "registry",
  UNSUPPORTED: "unsupported",
});

export const EFFECT_ITEM_TYPE = "effect";

/**
 * Reviewed core registry.
 *
 * Keys are stable PF2e identifiers:
 * - Compendium sourceId (`Compendium.pf2e.<pack>.Item.<id>`) verified against
 *   PF2e spell-effects / feat-effects pack documents (local 6.2.0 + upstream IDs)
 * - system.slug for the same documents (stable across worlds)
 *
 * Entries are intentionally few; polarity is taken from known spell/feat design
 * (e.g. Bless/Heroism buff allies; Bane debuffs enemies), not from runtime inference.
 *
 * Do not add aura-* carrier items here — those are aura sources, not received buffs.
 *
 * @type {Readonly<Record<string, "beneficial"|"harmful">>}
 */
export const NELCINE_EFFECT_KIND_REGISTRY = Object.freeze({
  // --- beneficial spell effects ---
  "Compendium.pf2e.spell-effects.Item.l9HRQggofFGIxEse": "beneficial", // Spell Effect: Heroism
  "spell-effect-heroism": "beneficial",
  "Compendium.pf2e.spell-effects.Item.Gqy7K6FnbLtwGpud": "beneficial", // Spell Effect: Bless
  "spell-effect-bless": "beneficial",
  "Compendium.pf2e.spell-effects.Item.3qHKBDF7lrHw8jFK": "beneficial", // Spell Effect: Guidance
  "spell-effect-guidance": "beneficial",
  "Compendium.pf2e.spell-effects.Item.ElkXovNrHB0Doi6O": "beneficial", // Spell Effect: Haste
  "spell-effect-haste": "beneficial",
  "Compendium.pf2e.spell-effects.Item.sPCWrhUHqlbGhYSD": "beneficial", // Spell Effect: Enlarge
  "spell-effect-enlarge": "beneficial",
  "Compendium.pf2e.spell-effects.Item.Jemq5UknGdMO7b73": "beneficial", // Spell Effect: Shield
  "spell-effect-shield": "beneficial",
  "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr": "beneficial", // Effect: Rage
  "effect-rage": "beneficial",
  "Compendium.pf2e.feat-effects.Item.uBJsxCzNhje8m8jj": "beneficial", // Effect: Panache
  "effect-panache": "beneficial",
  "Compendium.pf2e.feat-effects.Item.gYpy9XBPScIlY93p": "beneficial", // Stance: Mountain Stance
  "stance-mountain-stance": "beneficial",

  // --- harmful spell effects ---
  "Compendium.pf2e.spell-effects.Item.UTLp7omqsiC36bso": "harmful", // Spell Effect: Bane
  "spell-effect-bane": "harmful",
});

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} kind
 * @returns {"beneficial"|"harmful"|null}
 */
export function normalizeNelcineEffectKind(kind) {
  if (kind === "beneficial" || kind === "harmful") return kind;
  if (kind === null) return null;
  return null;
}

/**
 * @param {Item|object} item
 * @returns {string|null}
 */
export function resolveEffectSourceId(item) {
  return (
    safeString(item?.sourceId) ??
    safeString(item?._stats?.compendiumSource) ??
    safeString(item?._stats?.duplicateSource) ??
    safeString(item?.flags?.core?.sourceId)
  );
}

/**
 * @param {Item|object} item
 * @returns {string|null}
 */
export function resolveEffectSlug(item) {
  return safeString(item?.system?.slug) ?? safeString(item?.slug);
}

/**
 * @param {Item|object} item
 * @returns {string|null} best stable identity for registry / transaction keys
 */
export function resolveEffectStableIdentity(item) {
  return resolveEffectSourceId(item) ?? resolveEffectSlug(item);
}

/**
 * Read explicit NelFlow override flag. Invalid strings → unsupported sentinel.
 * @param {Item|object} item
 * @returns {{ kind: "beneficial"|"harmful"|null, invalid: boolean }}
 */
export function readNelcineEffectKindFlag(item) {
  const raw = item?.flags?.[MODULE_ID]?.nelcineEffectKind;
  if (raw === undefined) return { kind: undefined, invalid: false };
  if (raw === null) return { kind: null, invalid: false };
  if (raw === "beneficial" || raw === "harmful") return { kind: raw, invalid: false };
  return { kind: null, invalid: true };
}

/**
 * Lookup reviewed registry by sourceId then slug.
 * @param {Item|object} item
 * @returns {{ kind: "beneficial"|"harmful", identifier: string }|null}
 */
export function lookupEffectKindRegistry(item) {
  const sourceId = resolveEffectSourceId(item);
  if (sourceId && Object.prototype.hasOwnProperty.call(NELCINE_EFFECT_KIND_REGISTRY, sourceId)) {
    return { kind: NELCINE_EFFECT_KIND_REGISTRY[sourceId], identifier: sourceId };
  }
  const slug = resolveEffectSlug(item);
  if (slug && Object.prototype.hasOwnProperty.call(NELCINE_EFFECT_KIND_REGISTRY, slug)) {
    return { kind: NELCINE_EFFECT_KIND_REGISTRY[slug], identifier: slug };
  }
  return null;
}

/**
 * Pure classifier. Does not mutate. Never uses name/description/icon.
 *
 * @param {Item|object|null|undefined} item
 * @param {{ transactionKind?: unknown }} [options]
 * @returns {{
 *   supported: boolean,
 *   kind: "beneficial"|"harmful"|null,
 *   source: string,
 *   identifier: string|null,
 *   reason?: string
 * }}
 */
export function classifyEffect(item, options = {}) {
  if (!item || item.type !== EFFECT_ITEM_TYPE) {
    return {
      supported: false,
      kind: null,
      source: CLASSIFICATION_SOURCES.UNSUPPORTED,
      identifier: null,
      reason: "not-effect-item",
    };
  }

  const tx = normalizeNelcineEffectKind(options.transactionKind);
  if (options.transactionKind !== undefined && options.transactionKind !== null) {
    if (tx) {
      return {
        supported: true,
        kind: tx,
        source: CLASSIFICATION_SOURCES.TRANSACTION,
        identifier: resolveEffectStableIdentity(item),
      };
    }
    return {
      supported: false,
      kind: null,
      source: CLASSIFICATION_SOURCES.UNSUPPORTED,
      identifier: resolveEffectStableIdentity(item),
      reason: "invalid-transaction-kind",
    };
  }

  const flag = readNelcineEffectKindFlag(item);
  if (flag.invalid) {
    return {
      supported: false,
      kind: null,
      source: CLASSIFICATION_SOURCES.UNSUPPORTED,
      identifier: resolveEffectStableIdentity(item),
      reason: "invalid-flag",
    };
  }
  if (flag.kind === "beneficial" || flag.kind === "harmful") {
    return {
      supported: true,
      kind: flag.kind,
      source: CLASSIFICATION_SOURCES.NELFLOW_FLAG,
      identifier: resolveEffectStableIdentity(item),
    };
  }
  if (flag.kind === null) {
    // Explicit null flag means "do not present"
    return {
      supported: false,
      kind: null,
      source: CLASSIFICATION_SOURCES.NELFLOW_FLAG,
      identifier: resolveEffectStableIdentity(item),
      reason: "flag-null",
    };
  }

  // No PF2e-native polarity field exists on Effect items (documented 0.12.0 audit).
  const registry = lookupEffectKindRegistry(item);
  if (registry) {
    return {
      supported: true,
      kind: registry.kind,
      source: CLASSIFICATION_SOURCES.REGISTRY,
      identifier: registry.identifier,
    };
  }

  return {
    supported: false,
    kind: null,
    source: CLASSIFICATION_SOURCES.UNSUPPORTED,
    identifier: resolveEffectStableIdentity(item),
    reason: "unsupported-effect",
  };
}

/**
 * True when an Effect Item is eligible for generic cinematic consideration
 * (type/actor filters only — not classification).
 * @param {Item|object} item
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateGenericEffectItemEligibility(item) {
  if (!item || item.type !== EFFECT_ITEM_TYPE) {
    return { eligible: false, reason: "not-effect-item" };
  }
  if (item.pack) return { eligible: false, reason: "compendium" };
  if (item.type === "condition") return { eligible: false, reason: "condition" };
  const actor = item.actor;
  if (!actor || actor.pack) return { eligible: false, reason: "actor-ineligible" };
  // GrantItem children — avoid double presentation with granter housekeeping.
  if (item.flags?.pf2e?.grantedBy?.id) {
    return { eligible: false, reason: "granted-item" };
  }
  // Aura carrier documents (slug aura-*) are sources, not received buffs.
  const slug = resolveEffectSlug(item);
  if (slug && /^aura-/.test(slug)) {
    return { eligible: false, reason: "aura-carrier" };
  }
  return { eligible: true };
}

/**
 * Shared transaction identity for NelCine coalescing when origin evidence exists.
 * @param {Item|object} item
 * @returns {string}
 */
export function resolveGenericEffectTransactionId(item) {
  const identity = resolveEffectStableIdentity(item) ?? safeString(item?.id) ?? "unknown";
  const originItem = safeString(item?.system?.context?.origin?.item);
  const originActor =
    safeString(item?.system?.context?.origin?.actor) ??
    safeString(item?.flags?.pf2e?.aura?.origin);
  if (originItem) {
    return `effect-apply:${originItem}:${identity}`;
  }
  if (item?.flags?.pf2e?.aura && originActor) {
    return `effect-aura:${originActor}:${identity}`;
  }
  const actorUuid = safeString(item?.actor?.uuid) ?? "actor";
  const itemId = safeString(item?.id) ?? "item";
  return `effect-create:${actorUuid}:${itemId}`;
}
