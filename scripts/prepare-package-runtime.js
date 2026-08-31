"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const nextRoot = path.join(projectRoot, ".next");
const sourceRoot = path.join(nextRoot, "node_modules");
const manifestPath = path.join(nextRoot, "pivot-runtime-deps.json");
const legacyBundlePath = path.join(nextRoot, "pivot-runtime-deps");

fs.rmSync(manifestPath, { force: true });
fs.rmSync(legacyBundlePath, { recursive: true, force: true });

if (!fs.existsSync(sourceRoot)) {
  console.log("No .next/node_modules directory found; continuing without Turbopack dependency aliases.");
  process.exit(0);
}

const projectModules = path.join(projectRoot, "node_modules");
const aliases = [];

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function collectAliases(directory, relativeDirectory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const entryPath = path.join(directory, entry.name);
    const stats = fs.lstatSync(entryPath);

    if (stats.isSymbolicLink()) {
      let resolvedPath;
      try {
        resolvedPath = fs.realpathSync(entryPath);
      } catch {
        continue;
      }
      const target = path.relative(projectModules, resolvedPath);
      if (target && !target.startsWith(`..${path.sep}`) && !path.isAbsolute(target)) {
        aliases.push({ alias: normalize(relativePath), target: normalize(target) });
      }
      continue;
    }

    if (stats.isDirectory()) collectAliases(entryPath, relativePath);
  }
}

collectAliases(sourceRoot, "");

if (aliases.length > 0) {
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 1, aliases }, null, 2)}\n`);
  console.log(`Recorded ${aliases.length} Turbopack dependency aliases for npm pack.`);
} else {
  console.log("No relocatable Turbopack dependency aliases found; continuing without a runtime alias manifest.");
}
