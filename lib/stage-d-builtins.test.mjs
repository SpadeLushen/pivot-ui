import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readBuiltinSettings, writeBuiltinSetting } = await jiti.import("./builtin-extension-settings.ts");
const { readBuiltinSnapshot } = await jiti.import("./builtin-extension-snapshot.ts");
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-d-builtins-")), cwd = path.join(root, "work");
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProjectTrust: "never",
    extensions: ["-builtin:mcp"], future: { retained: false } }));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old; await rm(root, { recursive: true, force: true }); });
  return { root, cwd };
}
test("D5b global save needs no trust; project save requires saved trust and respects scope/revision", async t => {
  const { root, cwd } = await fixture(t);
  let current = await readBuiltinSettings(cwd);
  await assert.rejects(writeBuiltinSetting(cwd, { name: "mcp", scope: "project", enabled: true,
    revision: current.revision }), e => e.status === 403);
  await writeBuiltinSetting(cwd, { name: "mcp", scope: "global", enabled: true, revision: current.globalRevision });
  assert.equal(new ProjectTrustStore(root).get(cwd), null);
  await assert.rejects(writeBuiltinSetting(cwd, { name: "mcp", scope: "global", enabled: false,
    revision: current.globalRevision }), e => e.status === 409);
  new ProjectTrustStore(root).set(cwd, true);
  current = await readBuiltinSettings(cwd);
  await writeBuiltinSetting(cwd, { name: "mcp", scope: "project", enabled: false, revision: current.revision });
  const result = await readBuiltinSettings(cwd);
  assert.equal(item(result).configured, false); assert.equal(item(result).globalEnabled, true);
  assert.equal(item(result).source, "project");
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "settings.json"), "utf8")).future, { retained: false });
});
test("D5b untrusted project overrides are ignored and unrelated settings survive toggles", async t => {
  const { root, cwd } = await fixture(t);
  const file = path.join(cwd, ".pi/settings.json");
  await writeFile(file, JSON.stringify({ extensions: ["+builtin:mcp"], future: null }));
  assert.equal(item(await readBuiltinSettings(cwd)).configured, false);
  new ProjectTrustStore(root).set(cwd, true);
  const current = await readBuiltinSettings(cwd);
  assert.equal(item(current).configured, true);
  await writeBuiltinSetting(cwd, { name: "codemode", scope: "project", enabled: false, revision: current.revision });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { extensions: ["+builtin:mcp", "-builtin:codemode"], future: null });
});
test("D5b selected-wrapper diagnostics are bounded/redacted, cwd-isolated and unknown while applying", async t => {
  const { cwd } = await fixture(t);
  const old = globalThis.__piSessions;
  let state = "applied";
  const wrapper = { isAlive: () => true,
    getExtensionApplicationState: () => ({ state, sessionId: "fixture", running: false }),
    inner: { sessionManager: { getCwd: () => cwd }, resourceLoader: {
      getExtensions: () => ({ extensions: [], warnings: [], errors: [{ path: "builtin:mcp", error: "secret-token-body" }] }),
      getSkills: () => ({ diagnostics: Array.from({ length: 150 }, () => ({ type: "warning", path: "builtin:skill",
        message: "secret-token-body", collision: { winnerPath: "winner", loserPath: "loser" } })) }),
      getPrompts: () => ({ diagnostics: [] }), getThemes: () => ({ diagnostics: [] })
    } } };
  globalThis.__piSessions = new Map([["fixture", wrapper]]);
  t.after(() => { globalThis.__piSessions = old; });
  const snapshot = await readBuiltinSnapshot(cwd, "fixture");
  assert.equal(item(snapshot).state, "error"); assert.equal(snapshot.diagnostics.length, 100);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-token-body/);
  assert.equal(item(await readBuiltinSnapshot(cwd)).state, "unknown");
  assert.equal(item(await readBuiltinSnapshot(path.dirname(cwd), "fixture")).state, "unknown");
  state = "applying";
  const applying = await readBuiltinSnapshot(cwd, "fixture");
  assert.equal(item(applying).state, "unknown"); assert.deepEqual(applying.diagnostics, []);
});
const item = (snapshot, name = "mcp") => snapshot.builtins.find(b => b.name === name);
test("D5b no-session diagnostics are unknown, read-only and do not create wrappers", async t => {
  const { root, cwd } = await fixture(t), file = path.join(root, "settings.json");
  const before = await readFile(file, "utf8"), count = globalThis.__piSessions?.size ?? 0;
  const snapshot = await readBuiltinSnapshot(cwd);
  assert.equal(item(snapshot).configured, false); assert.equal(item(snapshot).state, "unknown");
  assert.equal(snapshot.application, null); assert.equal(globalThis.__piSessions?.size ?? 0, count);
  assert.equal(await readFile(file, "utf8"), before);
});
