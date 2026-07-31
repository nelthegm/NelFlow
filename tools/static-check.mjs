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

const javascriptFiles = [...walk("scripts", ".js"), ...walk("tools", ".mjs")];
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
  (path) => !path.endsWith("turn-stack-service.js"),
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
if (!setupBlock.includes('Hooks.on("renderChatMessageHTML", renderNelflowChat)')) {
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
  "const hasControl = controls.length > 0",
  "stackFirstEnabled() && hasControl && !visible",
  "element.dataset.nelflowNativeStackId === stackId",
  "visibleByStack.clear()",
  "visibleByStack.delete(stack.id)",
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
  !read("scripts/chat-ui.js").includes(
    "revealNativeMessage(row.attackMessageId, stackId, { focus: true, highlight: true })",
  ) ||
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
  adapter.match(/function captureMatches[\s\S]*?function onPreCreateChatMessage/)?.[0] ?? "";
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
  !adapter.includes('capture.role === "application"') ||
  !adapter.includes("capture.candidates.length === 1")
) {
  fail("application capture must require one unique structured lifecycle candidate");
}

const packageScript = read("tools/package.ps1");
if (
  !packageScript.includes('@("scripts", "styles", "lang")') ||
  !packageScript.includes('$document.Name -notmatch "TEST_PLAN"') ||
  !packageScript.includes("module.json") ||
  !packageScript.includes("README.md")
) {
  fail("package script runtime/documentation allowlist is incomplete");
}
if (/Copy-Item[\s\S]*\$projectRoot\s+-Destination/.test(packageScript)) {
  fail("package script appears capable of recursively packaging the project root");
}
if (!packageScript.includes("$_ -match 'TEST_PLAN'")) {
  fail("package verification does not exclude non-runtime test plans");
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

if (failures.length) {
  console.error(`Static checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Static checks passed: ${javascriptFiles.length} JavaScript files, all JSON, localization, imports, assets, settings, and safety guards.`,
);
