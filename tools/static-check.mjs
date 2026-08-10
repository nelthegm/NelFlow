import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function walk(relativeDirectory, extension) {
  const directory = join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    return entry.isDirectory()
      ? walk(relativePath, extension)
      : entry.name.endsWith(extension)
        ? [relativePath]
        : [];
  });
}

function walkAll(relativeDirectory = ".") {
  const directory = join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "dist", "node_modules"].includes(entry.name)) return [];
    const relativePath = join(relativeDirectory, entry.name);
    return entry.isDirectory() ? walkAll(relativePath) : [relativePath];
  });
}

let manifest;
let translations;
try {
  manifest = JSON.parse(read("module.json"));
} catch (error) {
  fail(`module.json is invalid: ${error.message}`);
}

for (const relativePath of walkAll().filter((path) => path.endsWith(".json"))) {
  try {
    JSON.parse(read(relativePath));
  } catch (error) {
    fail(`${relativePath} is invalid JSON: ${error.message}`);
  }
}
try {
  translations = JSON.parse(read("lang/en.json"));
} catch (error) {
  fail(`lang/en.json is invalid: ${error.message}`);
}

if (manifest) {
  if (manifest.id !== "nelflow") fail("module id must be nelflow");
  if (basename(root).toLowerCase() !== manifest.id) {
    fail(`folder ${basename(root)} does not agree with module id ${manifest.id}`);
  }
  if (!manifest.relationships?.systems?.some((system) => system.id === "pf2e")) {
    fail("PF2e system relationship is missing");
  }
  const packageMetadata = JSON.parse(read("package.json"));
  if (manifest.version !== packageMetadata.version) {
    fail("module.json and package.json versions do not match");
  }
  for (const path of [...(manifest.esmodules ?? []), ...(manifest.styles ?? [])]) {
    if (!existsSync(join(root, path))) fail(`manifest path does not exist: ${path}`);
  }
  for (const language of manifest.languages ?? []) {
    if (!existsSync(join(root, language.path))) fail(`language path does not exist: ${language.path}`);
  }
  for (const template of manifest.templates ?? []) {
    if (!existsSync(join(root, template))) fail(`template path does not exist: ${template}`);
  }
}

const javascriptFiles = [
  ...walk("scripts", ".js"),
  ...walk("tools", ".mjs"),
  ...(existsSync(join(root, "tests")) ? walk("tests", ".mjs") : []),
];
for (const relativePath of javascriptFiles) {
  const absolutePath = join(root, relativePath);
  const checked = spawnSync(process.execPath, ["--check", absolutePath], { encoding: "utf8" });
  if (checked.status !== 0) {
    fail(`${relativePath} syntax failed: ${checked.stderr.trim()}`);
  }
}

for (const relativePath of walk("scripts", ".js")) {
  const source = read(relativePath);
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const imported = resolve(dirname(join(root, relativePath)), match[1]);
    if (!existsSync(imported)) fail(`${relativePath} imports missing path ${match[1]}`);
  }
  if (/[A-Za-z]:\\/.test(source)) fail(`${relativePath} contains an absolute Windows path`);
  if (/\bsetTimeout\s*\(/.test(source)) fail(`${relativePath} uses setTimeout`);
  for (const match of source.matchAll(/["']((?:templates|styles)\/[^"']+)["']/g)) {
    if (!existsSync(join(root, match[1]))) {
      fail(`${relativePath} references missing runtime asset ${match[1]}`);
    }
  }
}
for (const relativePath of javascriptFiles) {
  const source = read(relativePath);
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const imported = resolve(dirname(join(root, relativePath)), match[1]);
    if (!existsSync(imported)) fail(`${relativePath} imports missing path ${match[1]}`);
  }
}

if (translations) {
  const usedKeys = new Set();
  for (const relativePath of walk("scripts", ".js")) {
    for (const match of read(relativePath).matchAll(/["'](Nelflow\.[A-Za-z0-9_.]+)["']/g)) {
      usedKeys.add(match[1]);
    }
  }
  for (const key of usedKeys) {
    if (!(key in translations)) fail(`missing localization key: ${key}`);
  }
}

const constantsSource = read("scripts/constants.js");
const settingsSource = read("scripts/settings.js");
const settingsBlock =
  constantsSource.match(/export const SETTINGS = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
for (const match of settingsBlock.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*"[^"]+",?$/gm)) {
  if (!settingsSource.includes(`SETTINGS.${match[1]}`)) {
    fail(`setting constant is not registered: SETTINGS.${match[1]}`);
  }
}
for (const required of [
  "SETTINGS.COMPACT_TURN_STACKS",
  "SETTINGS.COLLAPSE_LINKED_NATIVE_CARDS",
  "SETTINGS.STACK_FIRST_NATIVE_RECORDS",
  "STACK_FIRST_NATIVE_RECORD_MODES.ALWAYS_SHOW",
  "STACK_FIRST_NATIVE_RECORD_MODES.HIDE_BEHIND_STACK",
  "type: String",
  "choices:",
  "SETTINGS.BASIC_SAVE_RESOLVER",
  "SETTINGS.AUTO_APPLY_BASIC_SAVE_DAMAGE",
  "SETTINGS.BASIC_SAVE_WORKFLOW",
  "SETTINGS.TOOLBELT_BASIC_SAVE_APPLICATION",
  "SETTINGS.AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL",
  "AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF",
  "AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.GM",
  "AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.ALL",
  "SETTINGS.MIGRATION_VERSION",
  "SETTINGS.PLAYER_STRIKE_AUTO_APPLY",
  "SETTINGS.SHARED_ROLL_MULTI_TARGET_STRIKES",
  "SETTINGS.SHOW_TRANSACTION_DIAGNOSTICS",
  "PLAYER_STRIKE_AUTO_APPLY_MODES.OFF",
  "PLAYER_STRIKE_AUTO_APPLY_MODES.HOSTILE",
  "PLAYER_STRIKE_AUTO_APPLY_MODES.ALL",
  "MULTI_TARGET_STRIKE_MODES.OFF",
  "MULTI_TARGET_STRIKE_MODES.NPC_STRIKES",
  "MULTI_TARGET_STRIKE_MODES.PLAYER_AND_NPC_STRIKES",
  "TRANSACTION_DIAGNOSTIC_MODES.ERRORS_ONLY",
]) {
  if (!settingsSource.includes(required)) fail(`setting registration is missing ${required}`);
}

const adapter = read("scripts/pf2e-adapter.js");
if (!adapter.includes("contextClone.applyDamage")) {
  fail("native PF2e applyDamage delegation is missing");
}
const runtimeSource = walk("scripts", ".js").map(read).join("\n");
if (/system\.attributes\.hp(?:\.value|\.temp)?["']?\s*[-+]=?/.test(runtimeSource)) {
  fail("runtime code appears to modify HP arithmetically");
}
if ((adapter.match(/await\s+contextClone\.applyDamage\s*\(/g) ?? []).length !== 1) {
  fail("there must be exactly one native transaction application call");
}
if (/(?:ChatMessage|game\.messages|message)\s*\.\s*(?:delete|deleteDocuments)\s*\(/.test(runtimeSource)) {
  fail("runtime code appears to delete a native ChatMessage");
}
for (const relativePath of walk("scripts", ".js").filter(
  (path) =>
    !path.endsWith("turn-stack-service.js") &&
    !path.endsWith("save-resolver-service.js"),
)) {
  if (
    /(?:ChatMessage|ChatMessageClass|CONFIG\.ChatMessage\.documentClass)\s*(?:\.|\?\.)\s*create\s*\(/.test(
      read(relativePath),
    )
  ) {
    fail(`${relativePath} appears to recreate a ChatMessage`);
  }
}

const mechanicalSource = [
  "scripts/pf2e-adapter.js",
  "scripts/strike-resolver.js",
  "scripts/transaction-store.js",
  "scripts/turn-stack-service.js",
  "scripts/save-resolver-service.js",
  "scripts/save-correlation.js",
  "scripts/basic-save-source-classifier.js",
  "scripts/native-damage-action-adapter.js",
  "scripts/auto-damage-roll-model.js",
  "scripts/auto-damage-roll-service.js",
  "scripts/player-strike-model.js",
  "scripts/player-strike-adapter.js",
  "scripts/player-strike-service.js",
  "scripts/multi-target-strike-model.js",
  "scripts/multi-target-strike-capture.js",
  "scripts/multi-target-strike-service.js",
  "scripts/multi-target-strike-resolution.js",
  "scripts/multi-target-strike-undo.js",
]
  .map(read)
  .join("\n");
if (
  /\.innerHTML\b|\.querySelector\s*\(|DOMParser|message\.content|_source\.content/.test(
    mechanicalSource,
  )
) {
  fail("mechanical code appears to inspect PF2e chat-card HTML");
}
if (!mechanicalSource.includes("roll.instances") || !mechanicalSource.includes("instance.type")) {
  fail("structured PF2e damage summary is missing");
}
if (!mechanicalSource.includes('"multiple-attack-penalty"')) {
  fail("structured PF2e MAP modifier lookup is missing");
}
if (!runtimeSource.includes('Hooks.on("renderChatMessageHTML"')) {
  fail("renderChatMessageHTML hook registration is missing");
}
if ((runtimeSource.match(/Hooks\.on\(["']renderChatMessageHTML["']/g) ?? []).length !== 1) {
  fail("there must be exactly one renderChatMessageHTML hook registration");
}
const mainSource = read("scripts/main.js");
const setupBlock =
  mainSource.match(/Hooks\.once\(["']setup["'][\s\S]*?\n\}\);/)?.[0] ?? "";
const readyBlock =
  mainSource.match(/Hooks\.once\(["']ready["'][\s\S]*?\n\}\);/)?.[0] ?? "";
if (
  !setupBlock.includes('Hooks.on("renderChatMessageHTML"') ||
  !setupBlock.includes("runNelflowSyncBoundary") ||
  !setupBlock.includes("renderNelflowChat(message, html)")
) {
  fail("chat renderer must be registered during setup so initial history can rehydrate");
}
if (readyBlock.includes("renderChatMessageHTML")) {
  fail("chat renderer is registered too late during ready");
}
if (!existsSync(join(root, "tools", "package.ps1"))) {
  fail("packaging script is missing");
}

const compactor = read("scripts/native-card-compactor.js");
if (
  /\.formula\b|reconstruct.*formula|message\.(?:content|flavor)|_source\.(?:content|flavor)/i.test(
    compactor,
  )
) {
  fail("native-card presentation appears to inspect or reconstruct displayed damage data");
}
if (/\b(?:message|damageMessage|attackMessage)\.(?:update|setFlag)\s*\(/.test(compactor)) {
  fail("native-card presentation must not persistently mutate ChatMessages");
}
if (/\basync\s+(?:function|render\b)|static\s+async\s+render\b/.test(compactor)) {
  fail("native-card rendering must remain synchronous");
}
if (
  !compactor.includes("resolved.transaction.applicationMessageId") ||
  !compactor.includes("message.isContentVisible") ||
  !compactor.includes("standard direct message header/content not available") ||
  !compactor.includes("if (existing) {")
) {
  fail("native-card linkage, visibility, fail-open, or duplicate-listener guard is missing");
}

const stackSource = read("scripts/turn-stack-service.js");
if (
  !constantsSource.includes("STACK_SCHEMA_VERSION = 2") ||
  !stackSource.includes("supplementalActions: snapshot.supplementalActions ?? null") ||
  !stackSource.includes("schemaVersion: STACK_SCHEMA_VERSION")
) {
  fail("optional Slice 2.2 stack schema compatibility is missing");
}
for (const required of [
  "static canPersistStackProjection(attackMessage, transaction)",
  "game.user.isGM",
  "attackMessage.author?.id === game.user.id",
  "transaction.snapshot?.processingUserId === game.user.id",
  "if (!projectionChanged(stack, next)) return stackMessage",
  "content: buildDurableStackContent(next, stackVisibility(stackMessage))",
  "[`flags.${MODULE_ID}.stack`]: next",
]) {
  if (!stackSource.includes(required)) {
    fail(`durable stack persistence is missing authority or atomic projection guard: ${required}`);
  }
}
if (
  !stackSource.includes("content: buildDurableStackContent(stack, descriptor.visibility)") ||
  stackSource.includes('localize("Nelflow.Stack.StoredContent")')
) {
  fail("new stack messages must store meaningful durable fallback HTML");
}

const chatUiSource = read("scripts/chat-ui.js");
const renderFunction =
  chatUiSource.match(/export function renderNelflowChat[\s\S]*$/)?.[0] ?? "";
for (const required of [
  "function canRenderStackForViewer(message)",
  "function canRevealNativeRecord(messageId)",
  "function canUseUndo(row, stack)",
  "renderDurableStackFallback(message, html, stack)",
  "NativeRecordsController.failOpen(stack?.id)",
]) {
  if (!chatUiSource.includes(required)) {
    fail(`reload-safe read-only stack projection is missing: ${required}`);
  }
}
if (
  /\.update\s*\(|\.setFlag\s*\(|ChatMessage(?:Class)?\.create\s*\(|applyDamage|rollStrikeDamage|\.critical\s*\(|\.damage\s*\(/.test(
    renderFunction,
  )
) {
  fail("renderNelflowChat must remain a read-only presentation path");
}
if (
  /message\.author|game\.user\.isGM/.test(
    renderFunction.match(/if \(stack\)[\s\S]*?return;\n\s*\}/)?.[0] ?? "",
  )
) {
  fail("stack rendering must not be gated by authoring-GM authority");
}

const fallbackSource = read("scripts/stack-fallback.js");
for (const required of [
  "function escapeHtml(value)",
  "function isGmOnlyAudience(visibility)",
  "recipients.every((userId) => game.users?.get(userId)?.isGM === true)",
  "stack.schemaVersion ?? 1",
  'localize("Nelflow.Native.Target")',
  "export function buildDurableStackContent(stack, visibility)",
]) {
  if (!fallbackSource.includes(required)) {
    fail(`durable fallback is missing schema, escaping, or privacy guard: ${required}`);
  }
}
if (
  /<button\b|transactionId|attackMessageId|targetActorUuid|targetTokenUuid|\$\{[^}]*presentationError/.test(
    fallbackSource,
  )
) {
  fail("durable fallback appears to expose controls, identifiers, or diagnostics");
}
if (fallbackSource.includes("if (visibility?.blind) return true")) {
  fail("blind fallback content must still validate its persisted recipient audience");
}

const awareness = read("scripts/supplemental-action-awareness.js");
for (const required of [
  "strike.attack?.additionalEffects",
  "strike.item?.system?.attackEffects?.value",
  "availabilityUnknown: true",
  'detectionSource: "linked-attack-dom"',
  "li.roll-note a[data-pf2-action]",
  "li.roll-note a.inline-check[data-pf2-check]",
]) {
  if (!awareness.includes(required)) {
    fail(`supplemental awareness is missing safe source or guard: ${required}`);
  }
}
if (
  /game\.pf2e\.actions|dispatchEvent\s*\(|\.click\s*\(|executeMacro|macro\.execute/.test(
    awareness,
  )
) {
  fail("supplemental awareness appears to execute or recreate a PF2e action");
}
if (
  /Date\.now|createdTime|attackName|actorName|message\.flavor|message\.content|_source\.content/.test(
    awareness,
  )
) {
  fail("supplemental awareness appears to match by timing, names, or stored prose");
}

const recordsController = read("scripts/native-records-controller.js");
for (const required of [
  "TransactionStore.resolveCanonical(message)",
  "resolved.transaction.stackRef?.id !== stack.id",
  "message?.visible && message.isContentVisible",
  'const INSPECTION_ROLES = new Set(["attack", "damage"])',
  "stackFirstEnabled() && !failedStacks.has(stackId)",
  "element.dataset.nelflowNativeStackId === stackId",
  "resultsOpenByStack.clear()",
  "resultsOpenByStack.delete(stack.id)",
  "static failOpen(stackId)",
]) {
  if (!recordsController.includes(required)) {
    fail(`stack-first exact-link or fail-open guard is missing: ${required}`);
  }
}
if (
  /\b(?:message|stackMessage)\.(?:update|setFlag)\s*\(/.test(recordsController) ||
  /appendChild|insertBefore|replaceChildren/.test(recordsController)
) {
  fail("stack-first presentation must not mutate documents or relocate native message DOM");
}
if (
  !recordsController.includes("if (initialized) return") ||
  (runtimeSource.match(/Hooks\.on\(["']nelflowPresentationSettingChanged["']/g) ?? []).length !== 1
) {
  fail("presentation-setting listener is missing its duplicate-registration guard");
}
if (
  !compactor.includes("NativeRecordsController.registerNative(html, message.id, linked)") ||
  !read("scripts/chat-ui.js").includes("NativeRecordsController.markStackRendered(stack)") ||
  !read("scripts/chat-ui.js").includes("renderSupplementalActions(row, stackId)") ||
  !read("scripts/chat-ui.js").includes(
    "if (canRenderStackForViewer(message)) renderStack(message, html, stack)",
  ) ||
  !read("scripts/chat-ui.js").includes(
    "if (!message.visible || !message.isContentVisible) return",
  )
) {
  fail("exact native registration, stack visibility, or Actions focus linkage is missing");
}
if (/async\s+(?:render|function\s+render)|await\s+NativeRecordsController/.test(
  `${recordsController}\n${compactor}\n${read("scripts/chat-ui.js")}`,
)) {
  fail("chat presentation contains an unhandled asynchronous render update");
}
if (
  /setInterval\s*\(|MutationObserver|game\.messages\.(?:forEach|map)\s*\(|ChatMessage\.updateDocuments/.test(
    `${mainSource}\n${chatUiSource}\n${recordsController}`,
  )
) {
  fail("reload rehydration must not use polling, DOM observation, or bulk migration writes");
}
if (/rolls\s*:|["']rolls["']\s*:/.test(runtimeSource)) {
  fail("runtime code appears to replace native PF2e rolls");
}

const captureSection =
  adapter.match(/function applicationCaptureMatches[\s\S]*?function damageCandidate/)?.[0] ?? "";
for (const required of [
  "flags.appliedDamage?.uuid",
  "flags.appliedDamage?.isHealing === false",
  "flags.origin?.actor === capture.sourceActorUuid",
  "speakerToken === capture.targetTokenId",
]) {
  if (!captureSection.includes(required)) {
    fail(`application capture is missing structured guard: ${required}`);
  }
}
if (/\.content\b|textContent|innerText|Date\.now|createdTime/.test(captureSection)) {
  fail("application capture appears to correlate by text, content, or timing");
}
if (
  !adapter.includes("function finishApplicationCapture(capture)") ||
  !adapter.includes("capture.candidates.length === 1")
) {
  fail("application capture must require one unique structured lifecycle candidate");
}

const correlation = read("scripts/damage-correlation.js");
const resolver = read("scripts/strike-resolver.js");
for (const required of [
  "DamageMessageClaimRegistry",
  "DamageCaptureRegistry",
  "buildDamageCorrelationOption",
  "validateDamageCandidate",
  "candidate.correlationOption !== scope.correlationOption",
  "candidate.visible !== true",
  "candidate.authorUserId !== scope.processingUserId",
  'candidate.contextType !== "damage-roll"',
  "candidate.sourceActorUuid !== scope.sourceActorUuid",
  "candidate.itemUuid !== scope.itemUuid",
  "candidate.targetActorUuid !== scope.targetActorUuid",
  "candidate.targetTokenUuid !== scope.targetTokenUuid",
  "candidate.outcome !== scope.expectedOutcome",
  "this.claims.claim(candidate.messageId, transactionId)",
]) {
  if (!correlation.includes(required)) {
    fail(`concurrent damage correlation is missing exact guard: ${required}`);
  }
}
for (const required of [
  "options: new Set([capture.correlationOption])",
  "damageCaptures.observe(damageCandidate(message, correlationOption))",
  "damageCaptures.finish(transactionId",
  "damageClaims.markPersisted(messageId, transactionId)",
  "damageClaims.owner(damageMessage?.id) !== transaction.id",
]) {
  if (!adapter.includes(required)) {
    fail(`PF2e adapter is missing transaction-scoped correlation behavior: ${required}`);
  }
}
if ((adapter.match(/await\s+rollDamage\s*\(/g) ?? []).length !== 1) {
  fail("there must be exactly one native Strike damage invocation");
}
const rollDamageSection =
  adapter.match(/static async rollStrikeDamage[\s\S]*?static persistDamageClaim/)?.[0] ?? "";
if (/Hooks\.(?:on|once)\s*\(/.test(rollDamageSection)) {
  fail("damage invocation must not register a per-transaction hook");
}
if (
  /actorName|strikeName|targetName|message\.(?:content|flavor)|_source\.(?:content|flavor)|most recent|latest message/i.test(
    correlation,
  )
) {
  fail("damage correlation appears to use names, prose, or newest-message matching");
}
const candidateValidator =
  correlation.match(/export function validateDamageCandidate[\s\S]*?^}/m)?.[0] ?? "";
if (/Date\.now|createdTime|timestamp/.test(candidateValidator)) {
  fail("damage candidate validation must not use time as proof");
}
if (/new\s+DamageRoll|construct.*formula|damage\.formula/i.test(`${correlation}\n${resolver}`)) {
  fail("concurrent correlation must not construct a DamageRoll or damage formula");
}
if (
  !resolver.includes("PF2eAdapter.persistDamageClaim") ||
  !resolver.includes("PF2eAdapter.validateDamageForApplication") ||
  !resolver.includes("commitStrikeApplication") ||
  !resolver.includes("PF2eAdapter.applyDamageToRecordedTarget")
) {
  fail("damage application must occur only after exact claim persistence and revalidation");
}
// Ordering must be proven inside handleAttackMessage: durable claim before the
// helper that performs asynchronous HP application. Do not use whole-file
// indexOf — commitStrikeApplication is defined above the claim call site.
const handleAttackSection =
  resolver.match(/static async handleAttackMessage[\s\S]*?(?=static async undoFromMessage)/)?.[0] ?? "";
const claimIdx = handleAttackSection.indexOf("PF2eAdapter.persistDamageClaim");
const commitIdx = handleAttackSection.indexOf("commitStrikeApplication");
if (claimIdx < 0 || commitIdx < 0 || claimIdx > commitIdx) {
  fail("damage application must occur only after exact claim persistence and revalidation");
}
const commitHelper =
  resolver.match(/async function commitStrikeApplication[\s\S]*?(?=async function commitArmedImpact)/)?.[0] ??
  resolver.match(/async function commitStrikeApplication[\s\S]*?(?=export class StrikeResolver)/)?.[0] ??
  "";
if (!commitHelper.includes("PF2eAdapter.applyDamageToRecordedTarget")) {
  fail("damage application must occur only after exact claim persistence and revalidation");
}
if (
  !resolver.includes("manualApplicationRequired: true") ||
  !resolver.includes('"Nelflow.Notification.ManualApplicationRequired"') ||
  !resolver.includes("PF2eAdapter.releaseDamageClaim")
) {
  fail("safe manual damage fallback or failed-claim cleanup is missing");
}
if (
  /setProperty\s*\(|Hooks\.(?:on|once)\s*\(\s*["']preUpdateActor["']/.test(runtimeSource)
) {
  fail("Nelflow must not contain the observed external preUpdateActor/setProperty failure");
}
const concurrencyTests = read("tests/damage-correlation.test.mjs");
if ((concurrencyTests.match(/\btest\s*\(/g) ?? []).length < 20) {
  fail("mocked damage-correlation coverage must include at least 20 scenarios");
}

const saveResolver = read("scripts/save-resolver-service.js");
const saveCorrelation = read("scripts/save-correlation.js");
const saveModel = read("scripts/save-resolver-model.js");
for (const required of [
  "item?.system?.defense?.save",
  "save?.basic !== true",
  "item.isAttack",
  "item.getDamage",
  "save.check.roll",
  "extraRollOptions: [correlationOption]",
  "PF2eAdapter.rollSpellDamage",
  "PF2eAdapter.applyDamageRollToRecordedTarget",
  "isPersistentDamageSummary(summary)",
  "guardedHealthRestore",
  "target.targetTokenUuid",
  "target.targetActorUuid",
]) {
  if (!saveResolver.includes(required)) {
    fail(`basic-save resolver is missing structured/native guard: ${required}`);
  }
}
for (const required of [
  "buildSaveCorrelationOption",
  "candidate.correlationOption !== scope.correlationOption",
  "candidate.authorUserId !== scope.rollingUserId",
  'candidate.contextType !== "saving-throw"',
  "candidate.statistic !== scope.saveType",
  "candidate.dc !== scope.saveDC",
  "candidate.targetActorUuid !== scope.targetActorUuid",
  "candidate.sourceActorUuid !== scope.sourceActorUuid",
  "candidate.itemUuid !== scope.spellItemUuid",
]) {
  if (!saveCorrelation.includes(required)) {
    fail(`save correlation is missing exact guard: ${required}`);
  }
}
if (
  /1d20|new\s+(?:Roll|DamageRoll)|damage\.formula|message\.(?:content|flavor)|DOMParser/i.test(
    `${saveResolver}\n${saveCorrelation}\n${saveModel}`,
  )
) {
  fail("basic-save mechanics appear to reconstruct a roll/formula or parse chat HTML");
}
if (/latest|most recent|createdTime|timestamp-only/i.test(saveCorrelation)) {
  fail("save correlation appears to use broad or temporal matching");
}
if (
  saveResolver.indexOf("draft.damage.messageId = rolled.damageMessage.id") >
  saveResolver.indexOf("PF2eAdapter.applyDamageRollToRecordedTarget")
) {
  fail("target application must occur only after the shared damage message is persisted");
}
if (!saveResolver.includes("target.applicationState !== \"pending\"")) {
  fail("terminal target applications must not replay");
}
if (!saveResolver.includes("RESOLVER_PHASES.INTERRUPTED")) {
  fail("reload must convert in-flight resolver work to an interrupted state");
}
if (!read("scripts/chat-ui.js").includes("renderSaveResolverChat(message, html)")) {
  fail("save resolver is not registered through the setup-time chat renderer");
}
const saveTests = read("tests/save-resolver.test.mjs");
if ((saveTests.match(/\btest\s*\(/g) ?? []).length < 40) {
  fail("mocked save-resolver coverage must include at least 40 scenarios");
}
if (!existsSync(join(root, "docs", "SLICE_003_BASIC_SAVE_SPELL_RESOLVER.md"))) {
  fail("Slice 3 architecture documentation is missing");
}
const saveTestPlan = read("docs/SLICE_003_TEST_PLAN.md");
if ((saveTestPlan.match(/^\d+\.\s+\*\*/gm) ?? []).length < 46) {
  fail("Slice 3 runtime test plan must include at least 46 scenarios");
}
const toolbeltAdapter = read("scripts/toolbelt-target-helper-adapter.js");
const toolbeltService = read("scripts/toolbelt-basic-save-service.js");
const toolbeltUi = read("scripts/toolbelt-basic-save-ui.js");
const toolbeltModel = read("scripts/toolbelt-basic-save-model.js");
for (const required of [
  'TOOLBELT_MIN_VERSION = "3.52.0"',
  'TOOLBELT_MAX_VERSION = "3.53.1"',
  "evaluateToolbeltCompatibility",
  'game.settings.get(TOOLBELT_ID, "targetHelper.enabled")',
  'message?.flags?.[TOOLBELT_ID]?.targetHelper',
  'data.type !== "damage"',
  'save?.basic === true',
  'data.applied?.[token.id]?.[rollIndex] === true',
  'isSplashTarget: false',
]) {
  if (!toolbeltAdapter.includes(required)) fail(`Toolbelt adapter guard is missing: ${required}`);
}
for (const required of [
  "electProcessingGm",
  "processingUserId",
  "toolbeltSchemaFingerprint",
  "PF2eAdapter.applyDamageRollToRecordedTarget",
  "guardedHealthRestore",
  "persistent-damage-unsupported",
  "toolbeltAppliedState",
  "reload-during-application",
  "stale-toolbelt-save-state",
]) {
  if (!toolbeltService.includes(required)) fail(`Toolbelt transaction guard is missing: ${required}`);
}
if (/\.click\s*\(|dispatchEvent|jQuery|\$\s*\(/.test(`${toolbeltAdapter}\n${toolbeltService}`)) {
  fail("Toolbelt mechanics appear to click or dispatch DOM controls");
}
if (/message\.(?:content|flavor)|innerHTML|textContent|querySelector/.test(`${toolbeltAdapter}\n${toolbeltService}`)) {
  fail("Toolbelt mechanics appear to parse rendered chat content or DOM");
}
if (/rollDamage\s*\(|new\s+(?:Roll|DamageRoll)|1d20|damage\.formula/.test(toolbeltService)) {
  fail("Toolbelt integration appears to reroll or reconstruct damage/save formulas");
}
if (/target\.name|actor\.name/.test(`${toolbeltAdapter}\n${toolbeltService}\n${toolbeltModel}`)) {
  fail("Toolbelt mechanical identity appears to depend on a target or actor name");
}
if (!toolbeltUi.includes("nelflow-toolbelt") || !read("scripts/chat-ui.js").includes("renderToolbeltBasicSave")) {
  fail("Toolbelt status UI is not routed through the existing chat renderer");
}
if (!read("scripts/settings.js").includes("SETTINGS_MIGRATION_VERSION")) {
  fail("Slice 3.1 one-time settings migration is missing");
}
const toolbeltTests = read("tests/toolbelt-basic-save.test.mjs");
if ((toolbeltTests.match(/\btest\s*\(/g) ?? []).length < 48) {
  fail("mocked Toolbelt integration coverage must include at least 48 scenarios");
}
if (!existsSync(join(root, "docs", "SLICE_003_1_TOOLBELT_AUTO_APPLICATION.md"))) {
  fail("Slice 3.1 architecture documentation is missing");
}
const toolbeltTestPlan = read("docs/SLICE_003_1_TEST_PLAN.md");
if ((toolbeltTestPlan.match(/^\d+\.\s+\*\*/gm) ?? []).length < 66) {
  fail("Slice 3.1 runtime test plan must include at least 66 scenarios");
}
const toolbeltGuard = read("scripts/toolbelt-control-guard.js");
const toolbeltGuardUi = read("scripts/toolbelt-basic-save-ui.js");
for (const required of [
  'action === "target-applyDamage"',
  "new Set([0.5, 1, 2, 3])",
  'data-target-uuid][data-target-roll-index]',
  "guardIdentityMatches(",
  'addEventListener("click", interceptActivation, true)',
  'addEventListener("keydown", interceptActivation, true)',
  "event.stopImmediatePropagation()",
  'control.setAttribute("aria-disabled", "true")',
  "listenerRoots.has(html)",
  "manualControlsEnabled",
]) {
  if (!toolbeltGuard.includes(required)) fail(`Toolbelt control guard is missing: ${required}`);
}
for (const required of [
  "DialogV2.confirm",
  "game.user.id !== draft.processingUserId",
  "ToolbeltBasicSaveService.setManualControls",
  "ToolbeltControlGuard.render",
]) {
  if (!toolbeltGuardUi.includes(required)) fail(`Toolbelt guard UI is missing: ${required}`);
}
if (/\.click\s*\(|dispatchEvent|MutationObserver|setTimeout\s*\(/.test(toolbeltGuard)) {
  fail("Toolbelt control guard must not click controls, poll, or observe arbitrary DOM changes");
}
if (/target\.name|actor\.name|textContent\s*===|innerText/.test(toolbeltGuard)) {
  fail("Toolbelt control guard appears to identify a row by visible text or name");
}
if (/setFlag|\.update\s*\(|flags\.[A-Za-z]/.test(toolbeltGuard)) {
  fail("ordinary Toolbelt guard rendering must not update messages or imitate Toolbelt flags");
}
if (!settingsSource.includes("SETTINGS.GUARD_TOOLBELT_DAMAGE_CONTROLS")) {
  fail("Guard Toolbelt Damage Controls setting is missing");
}
const guardTests = read("tests/toolbelt-control-guard.test.mjs");
if ((guardTests.match(/\btest\s*\(/g) ?? []).length < 35) {
  fail("mocked Toolbelt control-guard coverage must include at least 35 scenarios");
}
if (!existsSync(join(root, "docs", "SLICE_003_1_1_TOOLBELT_CONTROL_GUARDS.md"))) {
  fail("Slice 3.1.1 architecture documentation is missing");
}
const guardTestPlan = read("docs/SLICE_003_1_1_TEST_PLAN.md");
if ((guardTestPlan.match(/^\d+\.\s+/gm) ?? []).length < 51) {
  fail("Slice 3.1.1 runtime test plan must include at least 51 scenarios");
}
const sourceClassifier = read("scripts/basic-save-source-classifier.js");
const npcAbilityTests = read("tests/basic-save-source-classifier.test.mjs");
for (const required of [
  'sourceKind: "npc-ability"',
  'itemIs(sourceItem, "action")',
  'actorIs(sourceActor, "npc")',
  'context.sourceType !== "save"',
  'origin.uuid !== sourceItem.uuid',
  'toolbeltSource.sourceItemUuid !== sourceItem.uuid',
  'message.flags?.pf2e?.strike',
  'sourceModeAllows(sourceKind, mode)',
  'sourceMessageId: origin.messageId ?? null',
]) {
  if (!sourceClassifier.includes(required)) fail(`NPC ability classifier is missing: ${required}`);
}
for (const required of [
  "SETTINGS.TOOLBELT_BASIC_SAVE_SOURCES",
  "TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS",
  "TOOLBELT_BASIC_SAVE_SOURCE_MODES.SPELLS_AND_NPC_ABILITIES",
  "version < 2",
]) {
  if (!settingsSource.includes(required)) fail(`Slice 3.2 source setting or migration is missing: ${required}`);
}
if (!constantsSource.includes("SETTINGS_MIGRATION_VERSION = 4")) {
  fail("Slice 4.0 settings migration version must be 4");
}

const playerStrikeModel = read("scripts/player-strike-model.js");
const playerStrikeAdapter = read("scripts/player-strike-adapter.js");
const playerStrikeService = read("scripts/player-strike-service.js");
const playerStrikeIntent = read("scripts/player-strike-intent.js");
const playerStrikeRuntime = `${playerStrikeAdapter}\n${playerStrikeService}`;
for (const required of [
  'PLAYER_STRIKE_TRANSACTION_TYPE = "player-strike"',
  'PLAYER_STRIKE_SOCKET_ACTION = "player-strike-damage-observed"',
  "validatePlayerStrikeAttack",
  "validatePlayerStrikeDamage",
  "validatePlayerStrikeSnapshot",
  "correlatePlayerStrikeDamage",
  "validatePlayerStrikeSocketPayload",
  "reconcilePlayerStrikeReload",
]) {
  if (!playerStrikeModel.includes(required)) fail(`player Strike model is missing ${required}`);
}
for (const required of [
  "PF2eAdapter.applyDamageRollToRecordedTarget",
  "PF2eAdapter.claimDamageMessage",
  "PF2eAdapter.persistDamageClaim",
  "TransactionStore.claimPlayerStrike",
  "electProcessingGm",
  'normalized.evidence.actorType !== "character"',
  'game.socket?.on?.(SOCKET_NAMESPACE',
  'game.socket?.emit?.(SOCKET_NAMESPACE',
]) {
  if (!playerStrikeService.includes(required)) fail(`player Strike service is missing ${required}`);
}
if (/actorType !== "character"\s*\|\|\s*normalized\.evidence\.authorIsGm/.test(playerStrikeService) ||
    /if\s*\(evidence\.authorIsGm\s*\|\|/.test(playerStrikeModel) ||
    /userId !== game\.user\?\.id\s*\|\|\s*game\.user\?\.isGM/.test(playerStrikeAdapter)) {
  fail("character Strike eligibility must not be gated by the authoring user's GM role");
}
for (const required of [
  "observedDamageVariant",
  "correlationMethod",
  "applicationAttemptCount",
  "manualReason",
]) {
  if (!playerStrikeRuntime.includes(required)) fail(`character Strike diagnostics are missing ${required}`);
}
for (const required of [
  'role: "observation"',
  "normalizePlayerStrikeAttack",
  "normalizePlayerStrikeDamage",
  "capturePlayerStrikeObservation",
]) {
  if (!playerStrikeRuntime.includes(required)) fail(`player Strike adapter is missing ${required}`);
}
for (const required of [
  'button[data-action="strike-damage"]',
  "capture: true",
  "CHARACTER_STRIKE_INTENT_MAX_AGE_MS",
  "characterStrikeCorrelation",
  "captureCharacterStrikeDamageCorrelation",
  "validateCharacterStrikeCorrelation",
]) {
  if (!`${playerStrikeIntent}\n${playerStrikeModel}\n${playerStrikeService}`.includes(required)) {
    fail(`deterministic character Strike intent is missing ${required}`);
  }
}
if (/preventDefault|stopPropagation|stopImmediatePropagation|\.critical\s*\(|\.damage\s*\(/.test(playerStrikeIntent)) {
  fail("character Strike click intent must not block PF2e controls or invoke native damage");
}
if (!playerStrikeService.includes('correlationMethod = direct.ok ? "character-strike-click-intent"')) {
  fail("validated character Strike click intent must take priority over structured fallback");
}
if (!playerStrikeService.includes("Ignored premature Player Strike ambiguity")) {
  fail("player Strike state machine must reject ambiguity without observed conflict evidence");
}
const playerStrikeIntentTests = read("tests/player-strike-intent.test.mjs");
const playerStrikeLifecycleTests = read("tests/player-strike-intent-lifecycle.test.mjs");
if ((`${playerStrikeIntentTests}\n${playerStrikeLifecycleTests}`.match(/test\(/g) ?? []).length < 83) {
  fail("Nelflow 0.6.3 requires at least 83 focused click-intent scenarios");
}
for (const required of [
  "directIntentLocalState", "persistedBindingState", "authorityClaimState",
  "applicationState", "directCorrelationDecision", "boundDamageMessageId",
]) {
  if (!playerStrikeRuntime.includes(required)) fail(`character Strike lifecycle diagnostics are missing ${required}`);
}
if (playerStrikeService.includes("valid-but-consumed")) {
  fail("same-message click-intent bindings must not use the ambiguous valid-but-consumed state");
}
if (/rollStrikeDamage|\.critical\s*\(|\.damage\s*\(/.test(playerStrikeService)) {
  fail("player Strike workflow must not invoke native damage rolling");
}
if (/\.innerHTML\b|\.querySelector\s*\(|DOMParser|message\.content|_source\.content|\.formula\b/.test(
  `${playerStrikeModel}\n${playerStrikeRuntime}`,
)) {
  fail("player Strike mechanics appear to inspect HTML or formulas");
}
if (!settingsSource.includes("shouldDisablePlayerStrikeForMigration") || !settingsSource.includes("PLAYER_STRIKE_AUTO_APPLY_MODES.OFF")) {
  fail("existing-world player Strike opt-in migration is missing");
}
for (const required of [
  "sourceKind: normalized.sourceKind",
  "sourceActorType: normalized.sourceActorType",
  "sourceItemType: normalized.sourceItemType",
  "sourceActionSlug: normalized.sourceActionSlug",
  "sourceClassifierVersion: normalized.sourceClassifierVersion",
  "eligibilityEvidenceVersion: normalized.eligibilityEvidenceVersion",
  "sourceIdentityMatches(draft, normalized)",
  "durable.revision !== draft.revision",
]) {
  if (!toolbeltService.includes(required)) fail(`Toolbelt ability transaction is missing: ${required}`);
}
if (/message\.(?:content|flavor)|\.description\b|innerHTML|textContent|DOMParser/i.test(
  `${sourceClassifier}\n${toolbeltAdapter}\n${toolbeltService}`,
)) {
  fail("NPC ability mechanics appear to parse descriptions or rendered chat HTML");
}
if (/rolls\s*(?:\[\s*0\s*\]|\.at\(\s*0\s*\))|findLast|most recent|latest message/i.test(toolbeltAdapter)) {
  fail("Toolbelt adapter appears to choose the first or newest damage roll");
}
if (/new\s+(?:Roll|DamageRoll)|rollDamage\s*\(|damage\.formula|1d20|degreeOfSuccess\s*=/.test(
  `${sourceClassifier}\n${toolbeltAdapter}\n${toolbeltService}`,
)) {
  fail("NPC ability integration appears to calculate saves or reroll/reconstruct damage");
}
if (/\.click\s*\(|dispatchEvent|target\.name|actor\.name|sourceItem\.name\s*===/.test(
  `${sourceClassifier}\n${toolbeltAdapter}\n${toolbeltService}`,
)) {
  fail("NPC ability mechanics appear to click controls or use displayed names as identity");
}
if ((npcAbilityTests.match(/\btest\s*\(/g) ?? []).length < 50) {
  fail("mocked NPC basic-save ability coverage must include at least 50 scenarios");
}
if (!existsSync(join(root, "docs", "SLICE_003_2_TOOLBELT_NPC_BASIC_SAVE_ABILITIES.md"))) {
  fail("Slice 3.2 architecture documentation is missing");
}
const npcAbilityTestPlan = read("docs/SLICE_003_2_TEST_PLAN.md");
if ((npcAbilityTestPlan.match(/^\d+\.\s+/gm) ?? []).length < 56) {
  fail("Slice 3.2 runtime test plan must include at least 56 scenarios");
}
const correlationTestPlan = read("docs/SLICE_002_2_2_TEST_PLAN.md");
if ((correlationTestPlan.match(/^\d+\.\s+\*\*/gm) ?? []).length < 25) {
  fail("Slice 2.2.2 runtime test plan must include at least 25 scenarios");
}

const autoDamageAdapter = read("scripts/native-damage-action-adapter.js");
const autoDamageModel = read("scripts/auto-damage-roll-model.js");
const autoDamageService = read("scripts/auto-damage-roll-service.js");
const autoDamageUi = read("scripts/auto-damage-roll-ui.js");
const autoDamageSource = `${autoDamageAdapter}\n${autoDamageModel}\n${autoDamageService}`;
for (const required of [
  'AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL: "automaticBasicSaveDamageRoll"',
  'OFF: "off"',
  'GM: "gm"',
  'ALL: "all"',
  "AUTO_DAMAGE_ROLL_SCHEMA_VERSION = 1",
]) {
  if (!constantsSource.includes(required)) fail(`Slice 3.3 constant is missing: ${required}`);
}
for (const required of [
  "default: AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.ALL",
  "version < 3",
  "AUTOMATIC_BASIC_SAVE_DAMAGE_ROLL_MODES.OFF",
  "hasStoredMigration",
]) {
  if (!settingsSource.includes(required)) fail(`Slice 3.3 setting/migration guard is missing: ${required}`);
}
for (const required of [
  "item.getDamage",
  "item.rollDamage",
  'damageActionId = "spell-damage"',
  "normalizedSource.castRank !== item.rank",
  "spell-overlay-ambiguous",
  "damage-choice-dialog-enabled",
  "ability-native-damage-api-unavailable",
  "toolbelt-targets-missing",
  "persistent-damage-unsupported",
  "splash-damage-unsupported",
  "eligibilityFingerprint",
]) {
  if (!autoDamageAdapter.includes(required)) fail(`native damage adapter guard is missing: ${required}`);
}
for (const required of [
  'const FLAG = "autoDamageRoll"',
  'const ORIGIN_FLAG = "autoDamageRollOrigin"',
  "const liveSourceIds = new Set()",
  "const captures = new Map()",
  "const scheduled = new Set()",
  "let invocationQueue = Promise.resolve()",
  "state: AUTO_DAMAGE_ROLL_STATES.ELIGIBLE",
  "draft.state = AUTO_DAMAGE_ROLL_STATES.CLAIMED",
  "await persist(message, draft); // Durable source/target/authority claim precedes the native call.",
  "draft.state = AUTO_DAMAGE_ROLL_STATES.ROLLING",
  "durable.revision !== revisionBeforeRolling + 1",
  "invokeNativeDamageAction(normalized.item, inspection)",
  "capture.preCreateMatches !== 1",
  "autoDamageCandidateMatches(draft, normalizedDamage, marker)",
  "setMessageFlagTargets(update, capture.targetTokenUuids)",
  "external-correlation-ambiguous",
  "reload-interrupted-autoroll",
  "liveSourceIds.has(sourceMessageId)",
]) {
  if (!autoDamageService.includes(required)) fail(`autoroll transaction/correlation guard is missing: ${required}`);
}
for (const state of [
  'COMPLETED: "completed"',
  'EXTERNAL: "external-roll-detected"',
  'AMBIGUOUS: "ambiguous"',
  'MANUAL: "manual"',
  'INTERRUPTED: "interrupted"',
  'ERROR: "error"',
]) {
  if (!autoDamageModel.includes(state)) fail(`autoroll terminal state is missing: ${state}`);
}
if (/message\.(?:content|flavor)|_source\.(?:content|flavor)|innerHTML|textContent|querySelector|DOMParser/.test(autoDamageSource)) {
  fail("autoroll mechanics appear to parse source/damage card HTML or displayed content");
}
if (/\.click\s*\(|dispatchEvent|addRollListener|activateListeners|_onClick/.test(autoDamageSource)) {
  fail("autoroll mechanics appear to click a DOM control or invoke a chat-card listener");
}
if (/new\s+(?:Roll|DamageRoll)|\.formula\b|construct.*formula|evaluate\s*\(/i.test(autoDamageSource)) {
  fail("autoroll mechanics appear to construct, inspect, or evaluate a damage formula");
}
if (/save\.check\.roll|1d20|degreeOfSuccess\s*=|rollSave\s*\(/.test(autoDamageSource)) {
  fail("autoroll service appears to roll or calculate a saving throw");
}
if (/most recent|newest|findLast|actor\.name|item\.name|sourceItem\.name|message\.timestamp/i.test(autoDamageSource)) {
  fail("autoroll correlation appears to use names, timestamps, or newest-message matching");
}
const liveGate = autoDamageModel.match(/export function liveInvocationAllowed[\s\S]*?^}/m)?.[0] ?? "";
if (!liveGate.includes("live &&") || /Date\.now|createdTime|timestamp/.test(liveGate)) {
  fail("autoroll live-session gate is missing or depends on time");
}
if (/setTimeout|setInterval|MutationObserver/.test(autoDamageSource)) {
  fail("autoroll mechanics must not use timeouts, polling, or DOM observation");
}
if (!autoDamageService.includes('Hooks.on("preCreateChatMessage", onPreCreateChatMessage)') ||
    (autoDamageService.match(/Hooks\.on\(["']preCreateChatMessage["']/g) ?? []).length !== 1) {
  fail("autoroll must use one permanent generated-message preCreate dispatcher");
}
for (const required of [
  'querySelectorAll(\'[data-action="spell-damage"]\')',
  'addEventListener("click", intercept, true)',
  'addEventListener("keydown", intercept, true)',
  "event.stopImmediatePropagation()",
  "listenerRoots.has(html)",
  "DialogV2.confirm",
  "setManualRoll(message.id, true)",
  "auto-damage-source-control-restored",
  "export function failOpenAutoDamageRoll(html)",
]) {
  if (!autoDamageUi.includes(required)) fail(`source-card guard/UI behavior is missing: ${required}`);
}
if (!chatUiSource.includes("failOpenAutoDamageRoll(html)")) {
  fail("central chat presentation failure must restore the native source control");
}
if (/\.click\s*\(|dispatchEvent|MutationObserver|setTimeout/.test(autoDamageUi)) {
  fail("source-card UI must not programmatically click, dispatch, observe, or poll");
}
for (const event of [
  "auto-damage-source-observed",
  "auto-damage-awaiting-targets",
  "auto-damage-eligible",
  "auto-damage-ineligible",
  "auto-damage-claimed",
  "auto-damage-rolling",
  "auto-damage-message-correlated",
  "auto-damage-completed",
  "auto-damage-external-roll-detected",
  "auto-damage-correlation-ambiguous",
  "auto-damage-manual",
  "auto-damage-interrupted",
  "auto-damage-error",
  "auto-damage-source-control-guarded",
  "auto-damage-source-control-restored",
  "auto-damage-manual-roll-enabled",
  "auto-damage-manual-roll-reguarded",
]) {
  if (!`${autoDamageService}\n${autoDamageUi}`.includes(event)) fail(`safe autoroll diagnostic is missing: ${event}`);
}
const autoDamageTests = read("tests/auto-damage-roll.test.mjs");
if ((autoDamageTests.match(/\btest\s*\(/g) ?? []).length < 68) {
  fail("mocked deterministic damage-autoroll coverage must include at least 68 scenarios");
}
if (!existsSync(join(root, "docs", "SLICE_003_3_DETERMINISTIC_DAMAGE_AUTOROLL.md"))) {
  fail("Slice 3.3 architecture documentation is missing");
}
const autoDamageTestPlan = read("docs/SLICE_003_3_TEST_PLAN.md");
if ((autoDamageTestPlan.match(/^\d+\.\s+/gm) ?? []).length < 78) {
  fail("Slice 3.3 runtime test plan must include at least 78 scenarios");
}

for (const path of [
  "scripts/transaction-failure.js",
  "scripts/transaction-reconciliation.js",
  "scripts/transaction-diagnostics-service.js",
  "scripts/transaction-diagnostics-ui.js",
  "scripts/nelflow-boundary.js",
  "scripts/runtime-session.js",
  "docs/SLICE_003_4_RUNTIME_DIAGNOSTICS_AND_RECOVERY.md",
  "docs/SLICE_003_4_TEST_PLAN.md",
  "tests/transaction-diagnostics.test.mjs",
  "LICENSE",
]) {
  if (!existsSync(join(root, path))) fail(`Slice 3.4 required file is missing: ${path}`);
}
const failureSource = read("scripts/transaction-failure.js");
const reconciliationSource = read("scripts/transaction-reconciliation.js");
const diagnosticsSource = `${read("scripts/transaction-diagnostics-service.js")}\n${read("scripts/transaction-diagnostics-ui.js")}\n${read("scripts/nelflow-boundary.js")}`;
const failureArraySource = failureSource.match(/FAILURE_CODES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
const failureCodes = [...failureArraySource.matchAll(/"([a-z][a-z0-9-]+)"/g)].map((match) => match[1]);
for (const code of failureCodes) {
  if (!translations?.[`Nelflow.Failure.${code}`]) fail(`failure code lacks localization: ${code}`);
}
if (!failureSource.includes("MAX_AUDIT_ENTRIES = 24") || !failureSource.includes("audit.slice(-MAX_AUDIT_ENTRIES)")) {
  fail("Slice 3.4 audit trail must remain capped");
}
if (/querySelector|innerHTML|outerHTML|textContent|rollDamage|applyDamage|healthSnapshot/.test(reconciliationSource)) {
  fail("structured transaction reconciliation must not inspect HTML, roll, apply, or inspect HP");
}
for (const event of [
  "transaction-failure-recorded", "transaction-recovery-review-opened", "transaction-diagnostic-copied",
  "transaction-recovery-started", "transaction-recovery-completed", "transaction-recovery-failed",
  "transaction-rescan-started", "transaction-rescan-completed", "transaction-existing-damage-linked",
  "transaction-marked-manual", "transaction-abandoned", "transaction-guard-cleared",
  "transaction-interrupted", "transaction-reconciled", "transaction-health-summary",
  "hook-boundary-failed", "control-restored-fail-open",
]) {
  if (!`${runtimeSource}\n${diagnosticsSource}\n${autoDamageService}\n${read("scripts/toolbelt-basic-save-service.js")}`.includes(event)) {
    fail(`safe Slice 3.4 diagnostic is missing: ${event}`);
  }
}
if (!diagnosticsSource.includes("if (!game.user?.isGM") || !diagnosticsSource.includes("buildSanitizedDiagnostic")) {
  fail("transaction recovery must be GM-only and support diagnostics must be sanitized");
}
const diagnosticsTests = read("tests/transaction-diagnostics.test.mjs");
if ((diagnosticsTests.match(/\btest\s*\(/g) ?? []).length < 70) {
  fail("Slice 3.4 mocked coverage must include at least 70 focused scenarios");
}
for (const path of [
  "scripts/player-strike-presentation.js",
  "scripts/strike-presentation-mode.js",
  "scripts/transaction-diagnostics-policy.js",
  "tests/presentation-cleanup.test.mjs",
  "docs/NELFLOW_0.14.3_TEST_PLAN.md",
  "docs/RELEASE_NOTES_0.14.3.md",
]) {
  if (!existsSync(join(root, path))) fail(`Nelflow 0.6.5 presentation cleanup file is missing: ${path}`);
}
const presentationTests = read("tests/presentation-cleanup.test.mjs");
if ((presentationTests.match(/\btest\s*\(/g) ?? []).length < 24) {
  fail("Nelflow 0.6.5 requires at least 24 focused presentation scenarios");
}
const presentationSource = `${read("scripts/player-strike-presentation.js")}\n${read("scripts/transaction-diagnostics-policy.js")}\n${read("scripts/player-strike-ui.js")}\n${read("scripts/transaction-diagnostics-ui.js")}\n${read("scripts/chat-ui.js")}`;
for (const required of [
  "selectPlayerStrikePresentationHost",
  "transactionNeedsRecoveryPresentation",
  "removeLegacyTransactionDiagnostics",
  "renderTransactionRecovery",
  "StrikeResolver.undoFromMessage",
]) {
  if (!presentationSource.includes(required)) fail(`Nelflow 0.6.5 presentation policy is missing: ${required}`);
}
if (/renderTransactionDiagnostics|transactionDiagnosticProjection|Nelflow\.Diagnostics\.Details/.test(read("scripts/chat-ui.js"))) {
  fail("Nelflow 0.6.5 ordinary chat must not render transaction internals");
}
if (/textContent\s*=\s*row\.presentationError/.test(read("scripts/chat-ui.js"))) {
  fail("NPC stack chat must not expose stored presentation errors");
}
if (!read("scripts/settings.js").match(/SHOW_TRANSACTION_DIAGNOSTICS[\s\S]*config:\s*false/)) {
  fail("legacy chat-diagnostics setting must remain registered but hidden");
}
if (!read("styles/nelflow.css").match(/\.nelflow-diagnostics,[\s\S]*display:\s*none\s*!important/)) {
  fail("legacy diagnostic containers must be hidden defensively before first paint");
}
if (/deleteChatMessage|\.delete\s*\(|\.setFlag\s*\(|\.update\s*\(/.test(read("scripts/player-strike-ui.js"))) {
  fail("player Strike presentation must not mutate or delete native ChatMessages");
}
const strikePresentationMode = read("scripts/strike-presentation-mode.js");
const playerStrikeUi = read("scripts/player-strike-ui.js");
const nativeCompactor = read("scripts/native-card-compactor.js");
for (const required of [
  'NATIVE_AUGMENTED: "native-augmented"',
  'CANONICAL_STACK: "canonical-stack"',
  'transaction?.transactionType === "multi-target-strike"',
  '[undefined, null, "character"].includes(transaction?.snapshot?.actorType)',
]) {
  if (!strikePresentationMode.includes(required)) {
    fail(`Nelflow 0.14.3 Strike presentation selector is missing: ${required}`);
  }
}
for (const required of [
  "bindCharacterStrikeIntentCapture",
  "data-nelflow-application-status",
  "canShowPlayerStrikeUndo",
  "StrikeResolver.undoFromMessage",
  "usesNativeAugmentedStrikePresentation",
]) {
  if (!playerStrikeUi.includes(required)) {
    fail(`Nelflow 0.14.3 native PC augmentation is missing: ${required}`);
  }
}
if (/damageActionControl|activateNativeStrikeDamage|resultsControl|authorizedAttackTotal|RollPopoverController/.test(playerStrikeUi)) {
  fail("Nelflow 0.14.3 must not recreate PC Strike controls, summaries, or Results");
}
if (!nativeCompactor.match(/usesNativeAugmentedStrikePresentation\(linked\.transaction\)[\s\S]*restoreFullCard\(html\)/)) {
  fail("Nelflow 0.14.3 must restore full native PC attack and damage cards");
}
const nativePcTests = read("tests/player-strike-actionable.test.mjs");
if ((nativePcTests.match(/\btest\s*\(/g) ?? []).length < 40) {
  fail("Nelflow 0.14.3 requires at least 40 focused native PC presentation scenarios");
}
const diagnosticsTestPlan = read("docs/SLICE_003_4_TEST_PLAN.md");
if ((diagnosticsTestPlan.match(/^\d+\.\s+/gm) ?? []).length < 55) {
  fail("Slice 3.4 runtime test plan must include at least 55 scenarios");
}

const packageScript = read("tools/package.ps1");
if (
  !packageScript.includes('@("scripts", "styles", "lang")') ||
  !packageScript.includes('$document.Name -notmatch "TEST_PLAN"') ||
  !packageScript.includes("module.json") ||
  !packageScript.includes("README.md") ||
  !packageScript.includes("LICENSE")
) {
  fail("package script runtime/documentation allowlist is incomplete");
}
if (/Copy-Item[\s\S]*\$projectRoot\s+-Destination/.test(packageScript)) {
  fail("package script appears capable of recursively packaging the project root");
}
if (!packageScript.includes("$_ -match 'TEST_PLAN'")) {
  fail("package verification does not exclude non-runtime test plans");
}
if (!packageScript.includes(".git|dist|tools|tests|node_modules")) {
  fail("package verification must explicitly exclude tests and development tooling");
}

for (const relativePath of walkAll()) {
  if (
    /(^|[\\/])(?:__pycache__|\.pytest_cache|\.mypy_cache|node_modules)([\\/]|$)/.test(
      relativePath,
    ) ||
    /\.(?:pyc|pyo)$/.test(relativePath)
  ) {
    fail(`development cache must not be included: ${relativePath}`);
  }
}

const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
if (tracked.status === 0) {
  for (const relativePath of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
    if (
      /(^|\/)(?:dist|node_modules|__pycache__|\.pytest_cache|\.mypy_cache)(\/|$)/.test(
        relativePath,
      ) ||
      /\.(?:zip|pyc|pyo)$/.test(relativePath)
    ) {
      fail(`tracked development or distribution artifact: ${relativePath}`);
    }
  }
}

const damageApplied = read("scripts/damage-applied-bridge.js");
if (!damageApplied.includes('DAMAGE_APPLIED_HOOK = "nelflow.damageApplied"')) {
  fail("damageApplied hook name is missing");
}
if (!damageApplied.includes("DAMAGE_APPLIED_PROTOCOL = 1")) {
  fail("damageApplied protocol version is missing");
}
if (/damageByType\s*:/.test(damageApplied)) {
  fail("damageApplied must not invent post-IWR typed amounts");
}
if (!read("scripts/pf2e-adapter.js").includes("emitDamageAppliedFromApplication")) {
  fail("pf2e-adapter must emit damageApplied after unique capture");
}
if (!read("scripts/main.js").includes("installDamageAppliedPublicApi")) {
  fail("damageApplied public API is not installed");
}

if (failures.length) {
  console.error(`Static checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Static checks passed: ${javascriptFiles.length} JavaScript files, all JSON, localization, imports, assets, settings, and safety guards.`,
);
