import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { parseWorkspacePatch, readWorkspaces, updateWorkspaces } = await createJiti(import.meta.url).import("./workspace-store.ts");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pivot-workspaces-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "workspaces.json");
}

test("concurrent field patches do not clobber another device's changes", async (t) => {
  const path = await fixture(t);
  await Promise.all([
    updateWorkspaces([{ path: "/a", removed: true }], path),
    updateWorkspaces([{ path: "/a", tag: "Work" }], path),
    updateWorkspaces([{ path: "/b", tag: "Other" }], path),
  ]);
  const data = await readWorkspaces(path);
  assert.deepEqual(data.workspaces[0], { path: "/a", tag: "Work", removed: true });
  assert.equal(data.workspaces.length, 2);
  assert.deepEqual(await readdir(join(path, "..")), ["workspaces.json"]);
});

test("updating another workspace preserves existing server records", async (t) => {
  const path = await fixture(t);
  await updateWorkspaces([{ path: "/a", removed: false, tag: "Shared" }], path);
  await updateWorkspaces([{ path: "/b", removed: true }], path);
  assert.deepEqual((await readWorkspaces(path)).workspaces, [
    { path: "/a", removed: false, tag: "Shared" }, { path: "/b", removed: true, tag: "" },
  ]);
});

test("corrupt files are not overwritten; a rejected write does not poison the queue", async (t) => {
  const path = await fixture(t);
  await writeFile(path, "broken json");
  await assert.rejects(updateWorkspaces([{ path: "/a" }], path));
  assert.equal(await readFile(path, "utf8"), "broken json");
  await writeFile(path, JSON.stringify({ version: 1, workspaces: [] }));
  await updateWorkspaces([{ path: "/a" }], path);
  assert.equal((await readWorkspaces(path)).workspaces.length, 1);
});

test("validates patches, preserving spaces in tags", () => {
  assert.deepEqual(parseWorkspacePatch({ path: "/a", tag: " Side projects " }), { path: "/a", tag: "Side projects" });
  assert.deepEqual(parseWorkspacePatch({ path: "/a", tag: "default", tagIfEmpty: true }), { path: "/a", tag: "default", tagIfEmpty: true });
  assert.equal(parseWorkspacePatch({ path: "C:\\work\\app", removed: false }).removed, false);
  for (const value of [null, [], {}, { path: "relative" }, { path: "/a", removed: "yes" }, { path: "/a", tag: 1 }, { path: "/a", tag: "x".repeat(121) }, { path: "/a", tag: "a\nb" }, { path: "/a", tagIfEmpty: "yes" }, { path: "/a", extra: true }]) {
    assert.throws(() => parseWorkspacePatch(value));
  }
});

test("tagIfEmpty sets an automatic tag only when no tag is stored", async (t) => {
  const path = await fixture(t);
  await updateWorkspaces([{ path: "/a", tag: "default", tagIfEmpty: true }], path);
  assert.deepEqual((await readWorkspaces(path)).workspaces, [{ path: "/a", tag: "default", removed: false }]);
  // Same path, same automatic tag request: keep whatever is already stored.
  await updateWorkspaces([{ path: "/a", tag: "default", tagIfEmpty: true }], path);
  assert.equal((await readWorkspaces(path)).workspaces[0].tag, "default");
  await updateWorkspaces([{ path: "/a", tag: "Work" }], path);
  await updateWorkspaces([{ path: "/a", tag: "default", tagIfEmpty: true }], path);
  assert.equal((await readWorkspaces(path)).workspaces[0].tag, "Work");
  // An explicit empty tag still clears a stored one.
  await updateWorkspaces([{ path: "/a", tag: "" }], path);
  await updateWorkspaces([{ path: "/a", tag: "default", tagIfEmpty: true }], path);
  assert.equal((await readWorkspaces(path)).workspaces[0].tag, "default");
});

test("round-trips removed/tag state, restore retains tag", async (t) => {
  const path = await fixture(t);
  assert.deepEqual(await readWorkspaces(path), { version: 1, workspaces: [] });
  await updateWorkspaces([{ path: "/a", tag: "Work", removed: true }], path);
  await updateWorkspaces([{ path: "/a", removed: false }], path);
  assert.deepEqual((await readWorkspaces(path)).workspaces, [{ path: "/a", tag: "Work", removed: false }]);
  await updateWorkspaces([{ path: "/a", tag: "" }], path);
  assert.equal((await readWorkspaces(path)).workspaces[0].tag, "");
});
