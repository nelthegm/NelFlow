# Nelflow 0.14.19 Runtime Test Plan — Default Strike Results State

Use Foundry V14, a supported PF2e 8.x build, and Nelflow 0.14.19. Static tests
and packaging are not Foundry runtime acceptance.

## A. Defaults and independent disclosure

1. Set **Default Turn Stack State** and **Default Strike Results State** to
   Expanded. Create a one-Strike stack; authorized Attack/Damage/Undo icons are
   immediately visible.
2. Append two more Strikes. Results remains expanded and each new row receives
   only its available controls.
3. Set Strike Results to Collapsed. Create a new stack; rows remain visible but
   exact controls start hidden.
4. Set Turn Stack to Collapsed and Strike Results to Expanded. Confirm only the
   stack header is visible. Expand the stack and confirm result controls appear.

## B. Local overrides

1. With Results default Expanded, collapse Results and trigger ordinary row
   updates. Confirm the same stack remains locally collapsed.
2. Append another Strike while locally collapsed. Confirm it does not reopen.
3. Re-expand Results and append another Strike. Confirm it remains expanded.
4. With the configured default Collapsed, manually expand Results and rerender;
   confirm the explicit expanded override survives.
5. Compare two clients. Confirm one viewer's toggle does not affect the other.
6. Reload. Confirm the configured default is used when no persisted override
   exists and no ChatMessage update or flag was created for disclosure state.

## C. Controls, privacy, and follow

1. Confirm Results count remains exact after attack/damage messages appear or
   are deleted.
2. Confirm a miss normally exposes only its authorized Attack icon.
3. Test public, whisper, blind, and self rolls as GM and player. Expanded
   Results must not override exact-message visibility or expose hidden data.
4. Hover, focus, click, Enter, and Space on result icons; exact-record popovers
   and accessibility labels remain functional.
5. Use guarded Undo and confirm only its exact transaction changes.
6. Let the active stack follow to the bottom. Confirm Results state, popovers,
   stack disclosure, Riders, Actions, and Undo still work after reparenting.
7. Confirm ordinary player-character native Strike cards remain unaffected.

## D. Compatibility

Test PF2e Workbench, Toolbelt, Dice So Nice, NelCine, NelZones, NelTempo, and
relevant chat modules separately and together. Record module versions and do not
claim runtime acceptance until every applicable scenario passes in Foundry.
