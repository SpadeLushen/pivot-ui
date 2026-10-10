import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import runtime from "./pivot-build-runtime.js";

function fixture(t, { next = "16.3.8", pi = "0.99.1" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "pivot-build-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const json = (file, data) => {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(data));
  };
  json("node_modules/next/package.json", { version: next });
  json("node_modules/@earendil-works/pi-coding-agent/package.json", { version: pi });
  json(".next/diagnostics/framework.json", { name: "Next.js", version: "16.3.8" });
  json(".next/required-server-files.json", { config: { env: { NEXT_PUBLIC_PI_VERSION: "0.99.1" } } });
  return root;
}

test("missing metadata fails with an actionable error", (t) => {
  const root = fixture(t);
  rmSync(path.join(root, ".next", "diagnostics"), { recursive: true });
  assert.throws(() => runtime.assertBuildRuntime(root), /Cannot read production build metadata.*npm run build/);
});

test("both launcher and direct next start validate build metadata", async () => {
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../bin/pivot-ui.js", import.meta.url), "utf8");
  assert.match(config, /phase === PHASE_PRODUCTION_SERVER\) assertBuildRuntime\(__dirname\)/);
  assert.match(launcher, /assertBuildRuntime\(pkgDir\)/);
});

test("SDK manifests hidden by exports are resolved without loading the SDK", (t) => {
  const root = fixture(t);
  const sdk = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(path.join(sdk, "dist"));
  writeFileSync(path.join(sdk, "dist", "index.js"), 'throw new Error("must not load SDK");');
  writeFileSync(path.join(sdk, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent",
    version: "0.99.1", exports: { ".": { import: "./dist/index.js" } } }));
  assert.doesNotThrow(() => runtime.assertBuildRuntime(root));
});

test("matching production build and runtime can start", (t) => {
  assert.doesNotThrow(() => runtime.assertBuildRuntime(fixture(t)));
});

test("Next version mismatch fails early with rebuild instructions", (t) => {
  assert.throws(() => runtime.assertBuildRuntime(fixture(t, { next: "16.2.9" })), /Next\.js 16\.3\.8.*16\.2\.9.*npm run build/);
});

test("SDK version mismatch is distinct from a global CLI upgrade", (t) => {
  assert.throws(() => runtime.assertBuildRuntime(fixture(t, { pi: "1.0.2" })), /pi SDK 0\.99\.1.*1\.0\.2.*npm run build/);
});
