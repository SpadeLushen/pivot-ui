#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { parseLaunchOptions } = require("./pivot-ui-options");
const { restoreRuntimeAliases } = require("../scripts/pivot-runtime-aliases");
const { assertBuildRuntime } = require("../scripts/pivot-build-runtime");

const pkgDir = path.join(__dirname, "..");

// The packaged .next directory references its externalized dependencies
// (serverExternalPackages) through hashed .next/node_modules aliases that
// npm pack cannot ship. postinstall recreates them, but package managers such
// as pnpm run dependency install scripts inside their own store, where the
// dependencies are not linked yet. Restore them again here so the server never
// starts with broken aliases, regardless of how the package was installed.
try {
  const { missing } = restoreRuntimeAliases(pkgDir);
  if (missing.length > 0) {
    console.warn(
      `Could not restore Turbopack dependency aliases for: ${missing.join(", ")}. ` +
        "Agent features may fail to load.",
    );
  }
} catch (error) {
  console.warn(`Could not restore Turbopack dependency aliases: ${error.message}`);
}

const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { port, hostname, openBrowser } = parseLaunchOptions();

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

try {
  assertBuildRuntime(pkgDir);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const nextArgs = ["start", "-p", port];
if (hostname) nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env },
});

let browserOpened = false;
const url = `http://${hostname ?? "localhost"}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
