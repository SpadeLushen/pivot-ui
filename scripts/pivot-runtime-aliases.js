"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

// Turbopack creates symlinks like
// .next/node_modules/@earendil-works/pi-ai-<hash> for every entry of
// serverExternalPackages and embeds the hashed specifier (e.g.
// require("@earendil-works/pi-ai-5e96b54476ded9ea")) into the server output.
// npm pack cannot ship symlinks, so scripts/prepare-package-runtime.js records
// them as { alias, target } pairs in .next/pivot-runtime-deps.json, and this
// module recreates the links after installation.
//
// The dependencies cannot be resolved with a fixed
// <package-root>/node_modules/<target> path: the layout depends on the package
// manager that installed the package.
//   npm (hoisted):        <consumer>/node_modules/<target>          (sibling of the package)
//   npm (nested conflict): <package-root>/node_modules/<target>     (legacy layout)
//   pnpm (virtual store):  <package-root>/../node_modules/<target>  (sibling symlink into the pnpm store)
// So candidates are collected exactly the way Node itself resolves modules:
// walk every node_modules directory from the package root upwards.
//
// pnpm runs a dependency's install scripts while building it inside its
// content-addressable store, where the package's dependencies are not linked
// yet. In that context the aliases cannot be restored; warn and continue
// instead of failing the installation. bin/pivot-ui.js restores them again at
// startup, where the package always sits inside a regular node_modules tree.

const MANIFEST_RELATIVE_PATH = path.join(".next", "pivot-runtime-deps.json");

function getManifestPath(packageRoot) {
  return path.join(packageRoot, MANIFEST_RELATIVE_PATH);
}

function removePath(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink() || stats.isFile()) fs.unlinkSync(filePath);
    else fs.rmSync(filePath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// Every node_modules directory from the package root upwards; the first entry
// covers the legacy nested layout, the rest cover npm hoisting and pnpm's
// virtual store (where the package root is
// <project>/node_modules/.pnpm/<name>@<version>/node_modules/<name>).
function getModuleRoots(packageRoot) {
  const roots = [];
  let directory = packageRoot;
  for (;;) {
    roots.push(path.join(directory, "node_modules"));
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return roots;
}

function resolveDependencyRoot(packageRoot, target) {
  const segments = target.split("/");

  // Prefer Node's own resolution: it returns the fully resolved real path, so
  // pnpm's symlink chains collapse into the content-addressable store location.
  try {
    const packageJson = require.resolve([...segments, "package.json"].join("/"), { paths: [packageRoot] });
    const resolved = path.dirname(packageJson);
    if (fs.existsSync(path.join(resolved, "package.json"))) return resolved;
  } catch {
    // Not resolvable from here; try the explicit candidate locations below.
  }

  for (const moduleRoot of getModuleRoots(packageRoot)) {
    const candidate = path.join(moduleRoot, ...segments);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }

  return null;
}

// Recreates the .next/node_modules/<alias> links recorded by
// prepare-package-runtime.js. Never throws for missing dependencies: callers
// either retry later (bin/pivot-ui.js) or must not break the installation.
function restoreRuntimeAliases(packageRoot) {
  const manifestPath = getManifestPath(packageRoot);
  if (!fs.existsSync(manifestPath)) return { restored: [], missing: [] };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.warn(`Could not read pivot runtime dependency manifest: ${error.message}`);
    return { restored: [], missing: [] };
  }

  const targetRoot = path.join(packageRoot, ".next", "node_modules");
  const restored = [];
  const missing = [];

  for (const entry of manifest.aliases ?? []) {
    const alias = entry.alias;
    const target = entry.target;
    if (typeof alias !== "string" || typeof target !== "string") continue;

    const dependencyRoot = resolveDependencyRoot(packageRoot, target);
    if (dependencyRoot === null) {
      missing.push(target);
      continue;
    }

    const aliasPath = path.join(targetRoot, ...alias.split("/"));
    fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
    removePath(aliasPath);
    fs.symlinkSync(dependencyRoot, aliasPath, process.platform === "win32" ? "junction" : "dir");
    restored.push(alias);
  }

  return { restored, missing };
}

module.exports = { restoreRuntimeAliases };
