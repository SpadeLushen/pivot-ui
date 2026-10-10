import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("..", import.meta.url));

test("toolchain has only native TS7 and Next uses its CLI", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.devDependencies.typescript, "7.0.2");
  assert.ok(pkg.files.includes("!scripts/*.test.mjs"));
  assert.ok(pkg.files.includes("!scripts/*-smoke.mjs"), "browser/runtime fixture scripts must not ship");
  assert.equal(pkg.devDependencies["eslint-config-next"], undefined);
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert.ok(!name.includes("typescript6"));
    if (name.endsWith("/typescript")) assert.equal(entry.version, "7.0.2");
  }
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /useTypeScriptCli: true/);
});

test("native lint still catches Hooks, explicit any, and Next image warnings", async () => {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(`import { useEffect } from "react";
export function Fixture({ enabled }: { enabled: any }) {
  if (enabled) useEffect(() => {}, []);
  return <img src="/test.png" />;
}`, { filePath: "components/ts7-lint-fixture.tsx" });
  assert.ok(!result.messages.some((message) => message.fatal));
  for (const rule of ["react-hooks/rules-of-hooks", "no-restricted-syntax", "@next/next/no-img-element", "jsx-a11y/alt-text"]) {
    assert.ok(result.messages.some((message) => message.ruleId === rule), `${rule} must remain enabled`);
  }
});
