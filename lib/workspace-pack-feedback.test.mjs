import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { ProjectTrustStore, SessionManager, SettingsManager, ModelRuntime, initTheme } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { requiresWorkspaceTrust, workspacePackBlockMessages, WorkspacePackRequestError, confirmWorkspaceTrust } = await jiti.import("./workspace-pack-feedback.ts");
const { POST } = await jiti.import("../app/api/workspace-trust/route.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
const { subscribeResourceChanges } = await jiti.import("./session-resource-events.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const plan = () => ({ blocked: [], versionConflicts: [], mcp: { blocked: [], versionConflicts: [] } });
const translate = (key, params) => ({ "packs.blocked.untrusted_project": "Trust required", "packs.blocked.version_conflict": `Conflict: ${params?.entry}` })[key] ?? key;
test("Pack failures expose deduplicated blockers and retain unknown reasons", () => {
  const p = plan(); p.mcp.blocked = [{ serverKey: "a", reason: "untrusted_project" }, { serverKey: "b", reason: "untrusted_project" }];
  p.blocked = [{ skillKey: "skill", reason: "future_reason" }]; p.versionConflicts = [{ skillKey: "skill" }];
  assert.equal(requiresWorkspaceTrust(p), true);
  assert.deepEqual(workspacePackBlockMessages(p, translate), ["skill: future_reason", "Trust required", "Conflict: skill"]);
  const error = new WorkspacePackRequestError({ error: "generic", plan: p }, translate);
  assert.equal(error.plan, p); assert.match(error.message, /Trust required/); assert.doesNotMatch(error.message, /generic/);
});
test("explicit Trust helper forwards only the workspace without a second implicit confirmation", async t => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch, calls = [];
  t.after(() => { globalThis.window = oldWindow; globalThis.fetch = oldFetch; });
  let prompts = 0;
  globalThis.window = { confirm: () => { prompts++; throw new Error("unexpected extra confirmation"); } };
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ trusted: true }); };
  assert.equal(await confirmWorkspaceTrust("workspace", translate), true);
  assert.equal(prompts, 0);
  assert.deepEqual(calls, [{ url: "/api/workspace-trust", body: { cwd: "workspace", trusted: true } }]);
  globalThis.fetch = async () => Response.json({ error: "denied" }, { status: 403 });
  await assert.rejects(confirmWorkspaceTrust("workspace", translate), /denied/);
});
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-workspace-trust-")), cwd = path.join(root, "workspace");
  await mkdir(cwd); allowFileRoot(cwd);
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  await writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask" }));
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { root, cwd };
}
const trustRequest = body => POST(new Request("http://localhost/api/workspace-trust", { method: "POST", body: JSON.stringify(body) }));
test("trust endpoint rejects implicit consent and notifies only the confirmed workspace", async t => {
  const f = await fixture(t), store = new ProjectTrustStore(f.root);
  let changes = 0, unrelated = 0;
  const off = subscribeResourceChanges(f.cwd, () => changes++), offOther = subscribeResourceChanges(f.root, () => unrelated++);
  t.after(() => { off(); offOther(); });
  for (const body of [null, {}, { cwd: f.cwd }, { cwd: f.cwd, trusted: false }]) assert.equal((await trustRequest(body)).status, 400);
  assert.equal(store.get(f.cwd), null);
  assert.equal((await trustRequest({ cwd: f.cwd, trusted: true })).status, 200);
  assert.equal(store.get(f.cwd), true); assert.equal(store.get(f.root), null);
  assert.equal(changes, 1); assert.equal(unrelated, 0);
});
test("saved trust is refreshed only at the wrapper idle reload boundary", async t => {
  const f = await fixture(t); initTheme();
  const settingsManager = SettingsManager.create(f.cwd, f.root); settingsManager.setProjectTrusted(false);
  const sessionManager = SessionManager.inMemory(f.cwd);
  let reloads = 0;
  const modelRuntime = await ModelRuntime.create({ modelsPath: path.join(f.root, "models.json") });
  const inner = { sessionManager, settingsManager, modelRuntime,
    resourceLoader: { getExtensions: () => ({ extensions: [], errors: [], warnings: [] }) }, sessionId: sessionManager.getSessionId(), isStreaming: false, isCompacting: false,
    agent: { state: {} }, bindExtensions: async () => {}, extensionRunner: { getRegisteredCommands: () => [] },
    subscribe: () => () => {}, dispose: () => {}, getAllTools: () => [], getActiveToolNames: () => [], setActiveToolsByName: () => {},
    reload: async options => { await options?.beforeSessionStart?.(); reloads++; assert.equal(settingsManager.isProjectTrusted(), true); } };
  const wrapper = new AgentSessionWrapper(inner); wrapper.start(); wrapper.beginExtensionBinding();
  t.after(() => wrapper.destroyAndWait());
  inner.isStreaming = true;
  await trustRequest({ cwd: f.cwd, trusted: true });
  await wrapper.ensureWorkspacePacksReloaded();
  assert.equal(settingsManager.isProjectTrusted(), false); assert.equal(reloads, 0);
  inner.isStreaming = false; await wrapper.send({ type: "get_tools" });
  assert.equal(reloads, 1); assert.equal(settingsManager.isProjectTrusted(), true);
});
