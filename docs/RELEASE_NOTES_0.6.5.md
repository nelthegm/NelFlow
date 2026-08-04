# Nelflow 0.6.5 release notes

Nelflow 0.6.5 is a strict chat-presentation correction. It does not add a new automation category or change attack/damage correlation, authority, application, IWR, temporary HP, recovery, reload, or guarded Undo semantics.

## Chat presentation

- Transaction internals are never displayed in ordinary chat for NPC Strikes, player Strikes, basic saves, Toolbelt applications, failures, interruptions, recovery states, reloads, or chat history.
- Successful player Strikes use one canonical concise application summary and no more than one legal guarded Undo.
- NPC turn stacks remain the principal Strike summary. Row disclosures are labeled **Native Records** and contain only exact viewer-entitled PF2e message links.
- Linked native application cards use a neutral **PF2e Application Record** label instead of a duplicate Applied status.
- Failed or interrupted automation shows concise human-readable recovery wording and **Review**, without identifiers or technical payload.
- Legacy diagnostic markup is removed synchronously, and defensive CSS hides stale cached containers before first paint. No delayed cleanup mechanism is used.

## Diagnostics and compatibility

Diagnostic flags, audit records, authority/correlation evidence, recovery state, and reload reconstruction remain stored unchanged. **Copy Support Info** retains the existing sanitized export, and the review dialog retains the existing guarded recovery actions. The old client-scoped diagnostics setting key and stored values remain registered for compatibility but are hidden from normal settings and cannot expose chat internals.

Native PF2e ChatMessages, rolls, flags, buttons, ownership, whispers, blind rolls, and roll-mode visibility remain unchanged. Native-record navigation still validates the exact linked message and current viewer visibility.

## Testing status

The Node/static suite covers diagnostic-free player and NPC presentation, initial render, reload/history registration, legacy-container suppression, recovery wording, setting compatibility, native-record privacy, canonical summaries, and single guarded Undo projection. Foundry V14/PF2e runtime acceptance remains required and is not claimed by this build.
