"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function installedVersion(projectRoot, name) {
  // Use Node's lookup paths, including hoisted/pnpm dependencies. Read the
  // manifest directly: pi is import-only and does not export package.json.
  const resolve = createRequire(path.join(projectRoot, "package.json")).resolve;
  for (const directory of resolve.paths(name) ?? []) {
    const file = path.join(directory, name, "package.json");
    if (fs.existsSync(file)) return readJson(file).version;
  }
  throw new Error(`Cannot locate installed dependency ${name}`);
}

/** A Next build cannot safely run against a different Next/SDK installation. */
function assertBuildRuntime(projectRoot) {
  const nextRoot = path.join(projectRoot, ".next");
  const rebuild = "Stop the production service, run npm run build, then restart it. " +
    "Do not build over a running development .next directory.";
  let framework;
  let config;
  try {
    framework = readJson(path.join(nextRoot, "diagnostics", "framework.json"));
    config = readJson(path.join(nextRoot, "required-server-files.json")).config;
  } catch (error) {
    throw new Error(`Cannot read production build metadata: ${error.message}. ${rebuild}`);
  }
  const next = installedVersion(projectRoot, "next");
  if (framework.version !== next) {
    throw new Error(`Production build uses Next.js ${framework.version}, but installed Next.js is ${next}. ${rebuild}`);
  }
  const builtPi = config?.env?.NEXT_PUBLIC_PI_VERSION;
  if (builtPi && builtPi !== "unknown") {
    const pi = installedVersion(projectRoot, "@earendil-works/pi-coding-agent");
    if (builtPi !== pi) {
      throw new Error(`Production build uses pi SDK ${builtPi}, but installed pi SDK is ${pi}. ${rebuild}`);
    }
  }
}

module.exports = { assertBuildRuntime };
