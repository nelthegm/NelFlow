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

let manifest;
let translations;
try {
  manifest = JSON.parse(read("module.json"));
} catch (error) {
  fail(`module.json is invalid: ${error.message}`);
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

const adapter = read("scripts/pf2e-adapter.js");
if (!adapter.includes("contextClone.applyDamage")) {
  fail("native PF2e applyDamage delegation is missing");
}
if (/applyDamageToRecordedTarget[\s\S]*system\.attributes\.hp\.value["']?\s*[-+]=?/.test(adapter)) {
  fail("application path appears to modify HP arithmetically");
}

if (failures.length) {
  console.error(`Static checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Static checks passed: ${javascriptFiles.length} JavaScript files, manifest, localization, imports, paths, and safety guards.`);
