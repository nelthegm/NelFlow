/**
 * Canonical Strike presentation policy.
 *
 * Ordinary single-target character Strikes keep PF2e's native attack and damage
 * cards. Nelflow augments the exact native damage card only after application.
 * NPC Strikes retain compact stacks. Shared-roll multi-target character Strikes
 * also retain their existing batch projection because PF2e has no one native
 * card that can represent every target-specific outcome and Undo operation.
 */
export const STRIKE_PRESENTATION_MODES = Object.freeze({
  NATIVE_AUGMENTED: "native-augmented",
  CANONICAL_STACK: "canonical-stack",
});

export function getStrikePresentationMode(transaction) {
  if (transaction?.transactionType === "multi-target-strike") {
    return STRIKE_PRESENTATION_MODES.CANONICAL_STACK;
  }
  if (
    transaction?.transactionType === "player-strike" &&
    // Older durable player-strike records may predate the redundant actorType
    // snapshot field. The transaction type itself is created only after the
    // character-only eligibility gate, so it remains safe reload evidence.
    [undefined, null, "character"].includes(transaction?.snapshot?.actorType)
  ) {
    return STRIKE_PRESENTATION_MODES.NATIVE_AUGMENTED;
  }
  return STRIKE_PRESENTATION_MODES.CANONICAL_STACK;
}

export function usesNativeAugmentedStrikePresentation(transaction) {
  return getStrikePresentationMode(transaction) === STRIKE_PRESENTATION_MODES.NATIVE_AUGMENTED;
}
