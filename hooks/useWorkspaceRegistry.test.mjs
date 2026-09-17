import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useWorkspaceRegistry.ts", import.meta.url), "utf8");

test("workspace registry never reads, imports or removes legacy browser records", () => {
  assert.doesNotMatch(source, /localStorage|custom-workspaces|hidden-workspaces|migrateLegacyWorkspaces/);
  assert.doesNotMatch(source, /"POST"/);
  assert.match(source, /method: "GET" \| "PATCH" = "GET"/);
});

test("initial load and cross-device refresh only read the shared registry", () => {
  const refresh = source.slice(source.indexOf("const refresh ="), source.indexOf("const update ="));
  assert.match(refresh, /await requestRegistry\(\)/);
  assert.doesNotMatch(refresh, /requestRegistry\("PATCH"/);
  assert.match(source, /window.addEventListener\("focus", sync\)/);
  assert.match(source, /window.setInterval\(sync, 15_000\)/);
});
