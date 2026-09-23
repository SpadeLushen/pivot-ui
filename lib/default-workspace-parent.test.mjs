import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveDefaultWorkspaceParent, createDefaultWorkspaceDirectory } = await jiti.import("./default-workspace-parent.ts");
const { DEFAULT_PREFERENCES, normalizePreferences } = await jiti.import("./preferences-types.ts");
const { parsePreferencePatch } = await jiti.import("./preferences.ts");

test("missing preference defaults to a dedicated folder in home", () => {
  assert.equal(normalizePreferences({})["default-workspace-parent"], "~/pivot-default-workspaces");
  assert.equal(resolveDefaultWorkspaceParent(DEFAULT_PREFERENCES["default-workspace-parent"]), join(homedir(), "pivot-default-workspaces"));
});

test("custom parent accepts absolute paths and home expansion", () => {
  const custom = join(homedir(), "somewhere", "nested");
  assert.ok(isAbsolute(custom));
  assert.equal(resolveDefaultWorkspaceParent(custom), custom);
  assert.equal(resolveDefaultWorkspaceParent("~/somewhere/nested"), custom);
  assert.deepEqual(parsePreferencePatch({ "default-workspace-parent": custom }), { patch: { "default-workspace-parent": custom } });
});

test("creates missing parents and reuses the dated workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "pivot-default-test-"));
  try {
    const parent = join(root, "missing", "nested");
    const first = createDefaultWorkspaceDirectory(parent, "20260224");
    assert.equal(first, join(parent, "pi-cwd-20260224"));
    assert.ok(existsSync(first));
    assert.equal(createDefaultWorkspaceDirectory(parent, "20260224"), first);
    const blockingFile = join(root, "file");
    writeFileSync(blockingFile, "not a directory");
    assert.throws(() => createDefaultWorkspaceDirectory(blockingFile, "20260224"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative or empty paths are rejected instead of creating under the process cwd", () => {
  for (const value of ["", "relative/path", "~someone/path", "  "]) {
    assert.ok("error" in parsePreferencePatch({ "default-workspace-parent": value }));
  }
});
