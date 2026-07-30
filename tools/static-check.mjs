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
if (!existsSync(join(root, "tools", "package.ps1"))) {
  fail("packaging script is missing");
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
