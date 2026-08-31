"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function shouldCopyNextEntry(sourcePath) {
  const relativePath = normalize(path.relative(projectRoot, sourcePath));
  return (
    relativePath !== ".next/cache" &&
    !relativePath.startsWith(".next/cache/") &&
    relativePath !== ".next/dev" &&
    !relativePath.startsWith(".next/dev/") &&
    !relativePath.endsWith(".js.map")
  );
}

function copyDirectory(name, options = {}) {
  const sourcePath = path.join(projectRoot, name);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Required build directory not found: ${name}`);
  }

  fs.cpSync(sourcePath, path.join(distRoot, name), {
    recursive: true,
    filter: options.filter,
  });
}

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(distRoot, { recursive: true });

copyDirectory(".next", { filter: shouldCopyNextEntry });
copyDirectory("public");
copyDirectory("bin");

for (const fileName of ["next.config.ts", "package.json", "package-lock.json"]) {
  const sourcePath = path.join(projectRoot, fileName);
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, path.join(distRoot, fileName));
  }
}

console.log(`Production deployment files copied to ${path.relative(projectRoot, distRoot)}`);
console.log("The project-level node_modules directory is intentionally excluded; install production dependencies on the target device.");
console.log("Next-generated dependencies under .next/node_modules are retained because the current Turbopack build may reference them.");
