# Slice 4.0 / Nelflow 0.6.2: Deterministic Character Strike Damage

## Goal and supported workflow

Nelflow observes a PF2e `character` Strike against exactly one target regardless of whether its active OWNER author is a player, assistant GM, or GM. It records the native attack message and target, then waits. The user—not Nelflow—chooses PF2e's native Damage or Critical Damage control and completes any native dialog. When PF2e creates a structurally compatible native damage message, one elected active GM revalidates the documents, durably claims that message, and passes its existing `DamageRoll` to Nelflow's one PF2e contextual application adapter.

Normal success and critical success are supported in and out of combat. The exact native ordinary or critical roll selected by the user is accepted for either hit outcome. Misses, missing outcomes, multiple targets, non-character sources, non-Strikes, spell/impulse attacks, hazards, and ambiguous native messages stay manual. Character Strikes never enter NPC compact turn stacks.

## PF2e 8.4.0 APIs inspected

The correction was checked against the official `pf2e-8.4.0` tag at commit `90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1`, and compared with `pf2e-8.3.0` at `bebe55ad9f5e0b7184fd019bc1e410fdbb2e934e`:

- `CharacterPF2e` Strike construction in `src/module/actor/character/document.ts`: `CheckContext`, `DamageContext`, exact target forwarding, identifier, MAP, and the native `damage`/`critical` functions.
- `Check.roll` and `Check.rerollFromMessage` in `src/module/system/check/check.ts`: persisted attack origin/target, identifier, options, MAP, final outcome, roll mode, and replacement-message rerolls.
- `ChatMessagePF2e` in `src/module/chat-message/document.ts`: exact target, item, and structured `_attack` resolution. Nelflow requires the structured identifier and never permits the getter's rendered-card fallback.
- Native Strike card listeners in `src/module/chat-message/listeners/cards.ts`: the player control forwards the attack message's exact `checkContext` and target into native damage.
- `DamageContext` in `src/module/actor/roll-context/damage.ts` and `DamagePF2e.roll` in `src/module/system/damage/damage.ts`: native `DamageRoll`, origin, target, outcome, MAP, Strike action index, alternative usage, author, and roll-mode persistence.
- PF2e actor damage application as already isolated by `PF2eAdapter.applyDamageRollToRecordedTarget`: contextual clone, ephemeral target effects, roll options, `Actor#applyDamage`, `skipIWR: false`, and HP/temp-HP snapshots.

The six relevant Strike/check/chat/damage source files had no schema-changing diff between those official 8.3.0 and 8.4.0 commits. PF2e 8.4.0 still persists attack identifier, actor/token/item, target, MAP, outcome, Strike index, alternate usage, and the selected native damage outcome; it still does not persist the originating attack-message ID on the damage card. No API or message assumption was taken from the locally installed PF2e 6.2.0 copy.

## Source eligibility and target snapshot

The earliest authoring-client `preCreateChatMessage` hook records a minimal observation role in the existing Nelflow transaction flag: schema version, transaction type, attack message, and exact target count. It also places a namespaced inert target-count roll option into PF2e's structured context so a PF2e replacement-message reroll can retain cardinality evidence. The authoritative GM replaces that observation with the canonical revalidated attack transaction and requires:

- actor type `character`;
- structured attack-roll action `strike` and a resolved `attack.type === "strike"`;
- active player or GM author with OWNER permission on the authoritative source actor;
- exact actor, token when available, item, structured Strike identifier, action index, alternative usage, attack message, attack roll, MAP, and author;
- one exact PF2e target actor/token and its scene and token disposition;
- PF2e's conclusive structured outcome.

The canonical `flags.nelflow.transaction.snapshot` contains exact document UUIDs because those documents must be re-read, plus compact source/target fingerprints. It contains no actor, token, item, or Strike names. Changing the current target after the attack cannot alter the stored UUIDs. A deleted or replaced token cannot inherit the transaction.

Zero targets and more than one target produce no eligible application. Multiple targets are never truncated or fanned out.

## Outcome, native damage choice, and variant

The attack outcome is the PF2e context outcome. Nelflow does not recompute AC, modifiers, natural-die adjustments, concealment, fortune, substitutions, or target predicates. Success and critical success make the transaction eligible; the native damage message then records whether the user selected ordinary Damage or Critical Damage. Failure and critical failure are terminal non-hit projections.

Nelflow never calls a Strike's `damage` or `critical` method for character attacks, never clicks a card, and never opens or confirms a damage dialog. An ordinary roll selected after a critical hit and a critical roll selected after a normal hit are both applied exactly as PF2e rolled them with multiplier 1. Nelflow does not transform, double, halve, or reinterpret either variant.

## Exact click intent, correlation, and concurrency

PF2e 8.4.0 renders both native controls as `button[data-action="strike-damage"]`; `data-outcome="success"` selects Damage and `data-outcome="critical-success"` selects Critical Damage. PF2e attaches one target-phase click listener that invokes the prepared Strike's native `damage` or `critical` function. Nelflow adds one capture-phase listener to the rendered message root. It records intent before PF2e's listener runs but never prevents propagation, calls either native method, opens a dialog, or creates a roll. The same render hook covers the main chat log and chat popout, and a weak root guard prevents duplicate listeners on one rendered element.

The 30-second client-local intent records schema version 1, exact attack message and transaction IDs, nonce, requested native variant, clicking user, source actor/token/item, Strike identifier and action index, alternate usage, attack outcome, scene, and available combat/round/turn context. The authoring client's `preCreateChatMessage` hook accepts exactly one fresh structurally matching intent and adds `flags.nelflow.characterStrikeCorrelation` without touching PF2e flags or visible content. It consumes the intent immediately. Cancelled dialogs simply expire; they do not change the durable transaction state.

The elected GM treats the flag as an untrusted causal hint. It re-reads the exact source attack, transaction, native damage message, actor, item, owner permission, recorded target, setting, state, nonce shape, author, variant, and age. Correlation priority is: validated click intent; any future exact native linkage; structured PF2e fallback; Manual Review for an actual observed conflict. A direct link therefore selects Attack B even if Attack A is structurally identical and waiting.

PF2e damage messages preserve source actor/token/item, target actor/token, author, Strike action index, alternative usage, MAP, context type, and selected ordinary/critical outcome. Structured fallback still requires every identity field and one native DamageRoll. Names, formulas, totals, content, HTML, chat adjacency, newest-message selection, and current targeting are not evidence. Time is used only to expire a known click intent, never to choose a fallback candidate.

Each attack transaction and damage message can claim each other once. A stable elected active GM, per-attack queue, current transaction state, revisioned durable flag, and the existing damage-claim registry prevent repeated hooks, socket wake-ups, and other GM clients from applying twice. Without a direct intent, an actually observed message matching multiple transactions is deliberately ambiguous. Merely having multiple theoretical waiting matches does not change any transaction from Waiting for Damage.

## Authority and socket security

The module socket accepts exactly `{ action: "player-strike-damage-observed", damageMessageId }`, with a bounded document-ID character set. Any extra target, actor, source-message, outcome, variant, formula, total, roll, HP delta, or other field invalidates the payload. The socket is only a wake-up: the elected GM re-reads the native damage message, canonical attack transaction, attack message, source actor/item, ownership, author activity, setting, exact target token/actor, disposition, outcome, variant, and state. The normal cross-client `createChatMessage` hook is also safe because it enters the same queued claim path.

The authoring client never mutates target HP. No general-purpose damage endpoint exists.

## Native application, disposition, and reactions

`Off` does nothing. `Hostile Targets` requires both snapshotted and current target-token disposition to equal Foundry's structured HOSTILE value. A disposition change, friendly/neutral/self target, missing token, or indeterminate value remains manual. `All Targets` permits any disposition but still requires the exact target token and every identity/authority guard. These modes apply identically to player- and GM-authored character Strikes.

The adapter passes the unchanged native DamageRoll with multiplier 1 through PF2e's contextual clone and `Actor#applyDamage`. PF2e owns typed instances, materials, precision, resistance, weakness, immunity, temporary HP, ephemeral effects, healing/negative values, splash/persistent categories, and critical damage already present in the roll. Nelflow does not parse or reconstruct the roll and does not subtract HP.

PF2e 8.4.0 exposes no conclusive structured field proving that a particular target currently has a legal Shield Block choice. Nelflow 0.6.2 therefore does not guess or implement a reaction gate. It never selects Shield Block, consumes a reaction, damages a shield, computes Hardness, or presents a reaction prompt. The existing adapter uses `shieldBlockRequest: false`; tables needing reaction decisions should leave this setting Off until the later reaction-gate slice.

## Transaction lifecycle, UI, Undo, and guards

The existing canonical Strike transaction is extended with `transactionType: "player-strike"`, schema version, setting mode, source/target fingerprints, author, elected authority, revision, session, damage link, application snapshots, Undo, failure, audit, recovery, and linked-message markers. Its normal lifecycle is:

`waiting-for-damage -> damage-observed -> validating -> claimed -> applying -> applied -> undone`

Manual, ambiguous, failed, interrupted, skipped, and abandoned are durable alternatives. `waiting-for-damage -> ambiguous` is rejected unless an observed damage-message ID, multiple structured candidates, or a documented direct-intent conflict exists. The attack and linked damage cards show a compact localized Waiting, Applying, Applied, Manual Review, Interrupted, Miss, or Undone status plus the permitted recorded-target label and known applied amount. GMs additionally get Transaction Details, safe failure/audit data, recovery controls, and guarded Undo. Players receive no raw target UUID, fingerprints, raw flags, private totals, or GM diagnostic context.

No character-Strike control is presentation-guarded. Native Damage/Critical Damage and native/manual application controls stay functional. Guard clearing is therefore presentation-only and unnecessary for this workflow.

GM Undo calls the existing Slice 1 guarded Undo. It requires exact post-application HP and temporary HP before restoring the exact recorded pre-application pair. Later healing/damage blocks Undo; messages and attack results are never deleted or rerolled.

## Reload, diagnostics, recovery, and privacy

Waiting transactions reconstruct and continue waiting for a future native message. A previous-session `validating`, `claimed`, or `applying` transaction becomes Interrupted and never reapplies. Applied/undone records reconstruct with guarded Undo; manual, ambiguous, and abandoned records stay terminal.

The stable character-Strike failure codes integrate with Slice 3.4. Durable flags record actor and authority data, target, outcome, observed variant/message, final correlation method, direct-intent validation and rejection, intent identity/age/expiration, fallback candidate count and shortened IDs, ambiguity stage, application attempts, final state, failure code, and Manual reason. The sanitized diagnostic export shortens IDs and omits names, formulas, totals, full UUIDs, raw flags, and hidden data. A Manual state without a meaningful failure is normalized to `manual-review-required` instead of displaying no failure code.

Re-scan is inspection-only. Use Existing Damage Message requires a GM to select one exact structurally compatible unclaimed card; it then re-enters the same GM validation/application service. Use Existing Damage Message, Mark Manual, and Abandon appear for actual Manual/Ambiguous/Failed/Interrupted recovery states, not valid Applied transactions. Recovery preserves native documents and survives reload.

## Compatibility and known limitations

- Native messages, rolls, flags, roll modes, visibility, and controls are preserved. No PF2e or third-party method is patched.
- Dice So Nice remains driven by native message creation. Toolbelt, Workbench, Better Chat Message, NPC stacks, basic saves, and spell autoroll retain separate transaction identities.
- Modules that strip structured PF2e message data cause Manual Review.
- Self-only or otherwise private documents unavailable to the elected GM cannot be processed.
- PF2e does not natively persist an originating attack-message ID on damage cards. Nelflow supplies that link for normal native card clicks. Structurally indistinguishable unmarked messages, or multiple same-user damage dialogs completed out of causal order, can still require recovery rather than being guessed by time or chat order.
- Duplicate browser tabs for one Foundry user share document authority and remain a distributed-lock limitation, although durable claims and revisions avoid intentional duplicate application.
- Multi-target/splash-target automation is deferred to Slice 5.0 / Nelflow 0.7.0. Shield/reaction prompting is deferred to a later reaction-gate slice.
- Secondary-target fan-out, conditions, other resource Undo, defeated state, and shield restoration are not supported. Persistent, splash, healing, category, and material semantics already contained in the selected native roll remain PF2e-owned during application.
- Static and Node-mocked checks are not Foundry runtime acceptance.
