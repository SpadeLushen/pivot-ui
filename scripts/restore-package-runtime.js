"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const nextRoot = path.join(projectRoot, ".next");
const manifestPath = path.join(nextRoot, "pivot-runtime-deps.json");

if (!fs.existsSync(manifestPath)) process.exit(0);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const targetRoot = path.join(nextRoot, "node_modules");

function removePath(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink() || stats.isFile()) fs.unlinkSync(filePath);
    else fs.rmSync(filePath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

for (const { alias, target } of manifest.aliases ?? []) {
  const aliasPath = path.join(targetRoot, ...alias.split("/"));
  const targetPath = path.join(projectRoot, "node_modules", ...target.split("/"));
  if (!fs.existsSync(targetPath)) throw new Error(`Missing installed dependency: ${target}`);
  fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
  removePath(aliasPath);
  fs.symlinkSync(targetPath, aliasPath, process.platform === "win32" ? "junction" : "dir");
}

console.log(`Restored ${manifest.aliases?.length ?? 0} Turbopack dependency aliases.`);
