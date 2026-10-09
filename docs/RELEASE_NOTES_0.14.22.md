# NelFlow 0.14.22

## Damage interaction repair

Preserves PF2e damage reactions and canonical stack presentation after the
0.14.21 resource-accounting slice.

### Shield Block

When a Strike target has Raise a Shield active and the prompt setting is on,
NelFlow **defers auto-apply** instead of opening a replacement Dialog.

The player uses PF2e's native damage-card **Shield Block** toggle and
**Apply Damage**. After PF2e mutates resources, NelFlow settles once:

- `resourceLoss` (HP / Temp HP / Stamina)
- stack Results
- `nelflow.damageApplied`
- stack-first hide of redundant native cards

### Presentation

- **Mitigation pending:** native damage card stays interactive/visible.
- **After settlement:** stack-first hide resumes so only the NelFlow stack
  remains as the final NPC presentation.

Spell attacks and save damage paths are unchanged (no Shield Block deferral).
