import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { saveToolSettings } = await jiti.import("./tool-settings-save.ts");
const { readWorkspaceTools } = await jiti.import("./workspace-tools.ts");
const { readOrchestration } = await jiti.import("./tool-orchestration.ts");
const { subscribeResourceChanges } = await jiti.import("./session-resource-events.ts");
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-c3-save-")), cwd = path.join(root, "work");
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
  t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const request = (target = "workspace", tools = { read: { enabled: false } }, codemode) => {
    const rules = readWorkspaceTools(cwd), orchestration = readOrchestration(cwd);
    return { target, tools, codemode, revision: target === "global" ? rules.globalRevision : rules.revision,
      orchestrationRevision: target === "global" ? orchestration.globalRevision : orchestration.revision };
  };
  const save = change => saveToolSettings(cwd, change, async () => ({ read: "direct" }));
  return { root, cwd, request, save, json: async file => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")) };
}

test("workspace matching values remove only edited overrides, including false and zero", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "pivot-tools.json"), JSON.stringify({ version: 1, tools: { read: { enabled: false } } }));
  await writeFile(path.join(f.root, "settings.json"), JSON.stringify({ defaultProjectTrust: "always", codemode: { mode: "only", inlineBudget: 0 } }));
  const toolFile = path.join(f.cwd, ".pi/pivot-tools.json"), settings = path.join(f.cwd, ".pi/settings.json");
  await writeFile(toolFile, '\uFEFF{\r\n\t"version": 1,\r\n\t"future": 7,\r\n\t"tools": {"read":{"enabled":true,"exposure":"deferred","future":8}}\r\n}\r\n');
  await writeFile(settings, JSON.stringify({ custom: 9, codemode: { mode: "on", inlineBudget: 3000, future: 10 } }));
  await f.save(f.request("workspace", { read: { enabled: false } }, { mode: "only", inlineBudget: 0 }));
  assert.deepEqual((await f.json(toolFile)).tools.read, { exposure: "deferred", future: 8 });
  assert.equal((await f.json(toolFile)).future, 7);
  assert.deepEqual(await f.json(settings), { custom: 9, codemode: { future: 10 } });
  assert.match(await readFile(toolFile, "utf8"), /^\uFEFF\{\r\n\t/);
});
test("global save preserves project overrides and ignores project-only revision changes", async t => {
  const f = await fixture(t), request = f.request("global");
  const file = path.join(f.cwd, ".pi/pivot-tools.json");
  await writeFile(file, JSON.stringify({ version: 1, tools: { read: { exposure: "deferred" } } }));
  const before = await readFile(file, "utf8"); await f.save(request);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(readWorkspaceTools(f.cwd).globalRules.read.enabled, false);
});

test("stale global changes invalidate workspace drafts; concurrent writers admit one winner", async t => {
  const f = await fixture(t), old = f.request();
  await f.save(f.request("global"));
  await assert.rejects(f.save(old), error => error.status === 409);
  const change = f.request("workspace", {}, { mode: "only" });
  const results = await Promise.allSettled([f.save(change), f.save(change)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
});
test("trust blocks workspace edits but not global defaults; invalid budgets never write", async t => {
  const f = await fixture(t); await writeFile(path.join(f.root, "settings.json"), '{"defaultProjectTrust":"never"}');
  await assert.rejects(f.save(f.request()), error => error.status === 403);
  await f.save(f.request("global"));
  for (const inlineBudget of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(f.save(f.request("global", {}, { inlineBudget })), error => error.status === 400);
  }
  assert.equal(readOrchestration(f.cwd).inlineBudget, 3000);
});
test("global notifications reach both worktrees; workspace writes notify only same cwd subscribers", async t => {
  const f = await fixture(t), other = path.join(f.root, "other"); await mkdir(path.join(other, ".pi"), { recursive: true });
  let a = 0, sibling = 0, b = 0;
  for (const [cwd, callback] of [[f.cwd, () => a++], [f.cwd, () => sibling++], [other, () => b++]]) t.after(subscribeResourceChanges(cwd, callback));
  await f.save(f.request()); assert.deepEqual([a, sibling, b], [1, 1, 0]);
  assert.equal(readWorkspaceTools(other).rules.read, undefined);
  await f.save(f.request("global", {}, { inlineBudget: 0 })); assert.deepEqual([a, sibling, b], [2, 2, 1]);
  assert.equal(readOrchestration(other).inlineBudget, 0);
});

test("failed second-file atomic replacement restores first file and emits no success notification", async t => {
  const f = await fixture(t), tools = path.join(f.cwd, ".pi/pivot-tools.json"), settings = path.join(f.cwd, ".pi/settings.json");
  await writeFile(tools, '{"version":1,"tools":{},"untouched":true}\n'); await writeFile(settings, '{}\n');
  const before = await readFile(tools, "utf8"), change = f.request("workspace", { read: { enabled: false } }, { inlineBudget: 0 });
  let notified = 0; t.after(subscribeResourceChanges(f.cwd, () => notified++));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === settings) throw new Error("injected second-file failure"); return rename(from, to); };
  syncBuiltinESMExports();
  try {
    // Jiti captures builtin functions at import time; load a fresh module after fault injection.
    const fresh = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./tool-settings-save.ts");
    await assert.rejects(fresh.saveToolSettings(f.cwd, change, async () => ({ read: "direct" })), /injected second-file failure/);
  }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(await readFile(tools, "utf8"), before); assert.equal(await readFile(settings, "utf8"), '{}\n');
  assert.equal(notified, 0);
});

