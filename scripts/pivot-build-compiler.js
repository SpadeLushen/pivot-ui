"use strict";
const path = require("node:path");
const { createRequire } = require("node:module");

function assertNativeCompiler(binding, label) {
  for (const method of ["projectNew", "projectFeatureUsage"]) {
    if (typeof binding[method] !== "function") {
      throw new Error(`Incompatible Next.js SWC binary (${label}): missing ${method}. ` +
        "Reinstall the native SWC package from the lockfile; its package.json version alone is not proof of binary compatibility.");
    }
  }
}

function assertBuildCompiler(root) {
  const resolve = createRequire(path.join(root, "package.json"));
  const swc = resolve("next/dist/build/swc");
  const triples = swc.getSupportedArchTriples()[process.platform]?.[process.arch] ?? [];
  const failures = [];
  for (const triple of triples) {
    const name = `@next/swc-${triple.platformArchABI}`;
    let binding;
    try { binding = resolve(name); } catch (error) { failures.push(`${name}: ${error.message}`); continue; }
    assertNativeCompiler(binding, name);
    return;
  }
  throw new Error(`Cannot verify a native Turbopack compiler: ${failures.join("; ")}`);
}

if (require.main === module) assertBuildCompiler(process.cwd());
module.exports = { assertBuildCompiler, assertNativeCompiler };
