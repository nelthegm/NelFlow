/**
 * Presentation-only PF2e combat action definitions (0.13.0 / Slice 4B).
 * No mechanical resolution lives here.
 */

export const SUPPORTED_ACTION_SLUGS = Object.freeze([
  "grapple",
  "trip",
  "shove",
  "reposition",
  "disarm",
  "demoralize",
  "feint",
  "escape",
]);

/**
 * @typedef {object} ActionConsequenceTemplate
 * @property {string} slug condition slug or display key
 * @property {string} label display label
 * @property {boolean} [requiresValue] omit from payload unless value known
 * @property {boolean} [valueOptionalForCorrelation] claim suppresses any value
 */

/**
 * @typedef {object} ActionDefinition
 * @property {string} slug
 * @property {string} name
 * @property {string} category
 * @property {string[]} statistics
 * @property {boolean} targetRequired
 * @property {Partial<Record<"criticalSuccess"|"success"|"failure"|"criticalFailure", ActionConsequenceTemplate[]>>} consequencesByDegree
 */

/** @type {Readonly<Record<string, ActionDefinition>>} */
export const ACTION_DEFINITIONS = Object.freeze({
  grapple: Object.freeze({
    slug: "grapple",
    name: "Grapple",
    category: "athletics-maneuver",
    statistics: Object.freeze(["athletics"]),
    targetRequired: true,
    // Remaster Grapple applies Grabbed on success; do not invent Restrained on crit.
    consequencesByDegree: Object.freeze({
      success: Object.freeze([{ slug: "grabbed", label: "Grabbed" }]),
      criticalSuccess: Object.freeze([{ slug: "grabbed", label: "Grabbed" }]),
    }),
  }),
  trip: Object.freeze({
    slug: "trip",
    name: "Trip",
    category: "athletics-maneuver",
    statistics: Object.freeze(["athletics"]),
    targetRequired: true,
    consequencesByDegree: Object.freeze({
      success: Object.freeze([{ slug: "prone", label: "Prone" }]),
      criticalSuccess: Object.freeze([{ slug: "prone", label: "Prone" }]),
    }),
  }),
  shove: Object.freeze({
    slug: "shove",
    name: "Shove",
    category: "athletics-maneuver",
    statistics: Object.freeze(["athletics"]),
    targetRequired: true,
    // Movement distance is never invented.
    consequencesByDegree: Object.freeze({}),
  }),
  reposition: Object.freeze({
    slug: "reposition",
    name: "Reposition",
    category: "athletics-maneuver",
    statistics: Object.freeze(["athletics"]),
    targetRequired: true,
    consequencesByDegree: Object.freeze({}),
  }),
  disarm: Object.freeze({
    slug: "disarm",
    name: "Disarm",
    category: "athletics-maneuver",
    statistics: Object.freeze(["athletics"]),
    targetRequired: true,
    consequencesByDegree: Object.freeze({}),
  }),
  demoralize: Object.freeze({
    slug: "demoralize",
    name: "Demoralize",
    category: "intimidation",
    statistics: Object.freeze(["intimidation"]),
    targetRequired: true,
    // Value must come from authoritative condition application — never invent N.
    consequencesByDegree: Object.freeze({
      success: Object.freeze([
        {
          slug: "frightened",
          label: "Frightened",
          requiresValue: true,
          valueOptionalForCorrelation: true,
        },
      ]),
      criticalSuccess: Object.freeze([
        {
          slug: "frightened",
          label: "Frightened",
          requiresValue: true,
          valueOptionalForCorrelation: true,
        },
      ]),
    }),
  }),
  feint: Object.freeze({
    slug: "feint",
    name: "Feint",
    category: "deception",
    statistics: Object.freeze(["deception"]),
    targetRequired: true,
    consequencesByDegree: Object.freeze({}),
  }),
  escape: Object.freeze({
    slug: "escape",
    name: "Escape",
    category: "escape",
    statistics: Object.freeze(["athletics", "acrobatics", "unarmed"]),
    targetRequired: false,
    consequencesByDegree: Object.freeze({
      success: Object.freeze([{ slug: "escaped", label: "Escaped" }]),
      criticalSuccess: Object.freeze([{ slug: "escaped", label: "Escaped" }]),
    }),
  }),
});

/**
 * @param {string|null|undefined} slug
 * @returns {ActionDefinition|null}
 */
export function getActionDefinition(slug) {
  if (typeof slug !== "string" || !slug) return null;
  return ACTION_DEFINITIONS[slug] ?? null;
}

/**
 * Extract action:<slug> from PF2e context.options. Never guesses from skill alone.
 * @param {Iterable<string>|null|undefined} options
 * @returns {string|null}
 */
export function detectActionSlugFromOptions(options) {
  const list = Array.isArray(options) ? options : [...(options ?? [])];
  const found = [];
  for (const entry of list) {
    if (typeof entry !== "string" || !entry.startsWith("action:")) continue;
    const rest = entry.slice("action:".length);
    const base = rest.split(":")[0];
    if (SUPPORTED_ACTION_SLUGS.includes(base) && !found.includes(base)) found.push(base);
  }
  if (found.length === 1) return found[0];
  return null;
}
