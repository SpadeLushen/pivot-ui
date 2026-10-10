import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readWorkspaceTools, writeWorkspaceTool, subscribeWorkspaceTools, ToolSettingsError, isToolSettingsError } = await jiti.import("./workspace-tools.ts");
const { activateAllSessionTools } = await jiti.import("./active-tools.ts");
const { readToolsSnapshot } = await jiti.import("./tool-catalog.ts");
const { workspaceToolExtension } = await jiti.import("./workspace-tool-extension.ts");
const route = await jiti.import("../app/api/tools/route.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-tools-policy-")), cwd = path.join(root, "workspace");
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  await mkdir(path.join(cwd, ".pi"), { recursive: true }); allowFileRoot(cwd);
  const settings = path.join(root, "settings.json"), file = path.join(cwd, ".pi/pivot-tools.json");
  await writeFile(settings, '{"defaultProjectTrust":"always"}');
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true }); });
  return { root, cwd, file, settings, save: (tools) => writeFile(file, JSON.stringify({ version: 1, tools })),
    rule: (name, rule, revision = readWorkspaceTools(cwd).revision) => writeWorkspaceTool(cwd, revision, name, rule) };
}
const enabled = (exposure = "direct") => ({ enabled: true, exposure });
const disabled = { enabled: false, exposure: "direct" };
function runtime(cwd, definitions) {
  let active = definitions.filter(d => d.exposure === "direct").map(d => d.name), updates = 0;
  return { definitions, sessionManager: { getCwd: () => cwd }, settingsManager: { isProjectTrusted: () => true },
    resourceLoader: { getExtensions: () => ({ extensions: [], errors: [], warnings: [] }) },
    getAllTools: () => definitions.map(d => ({ description: "", parameters: {}, sourceInfo: { source: "builtin", path: "builtin:" + d.name }, ...d })),
    getToolDefinition: name => definitions.find(d => d.name === name), getActiveToolNames: () => active,
    setActiveToolsByName: names => { active = names; updates++; }, get updates() { return updates; } };
}
test("error recognition survives duplicate module instances without accepting arbitrary status objects", async () => {
  const fresh = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./workspace-tools.ts");
  assert.equal(isToolSettingsError(new fresh.ToolSettingsError("conflict", 409)), true);
  assert.equal(isToolSettingsError({ status: 409, message: "forged" }), false);
  assert.equal(isToolSettingsError(Object.assign(new Error("not branded"), { status: 409 })), false);
});
test("serialized revision writes preserve unknown fields, indentation and line endings", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, '{\r\n\t"version": 1,\r\n\t"custom": 7,\r\n\t"tools": { "read": { "enabled": true, "exposure": "direct", "future": 9 } }\r\n}\r\n');
  let notified = 0; const off = subscribeWorkspaceTools(f.cwd, () => notified++); t.after(off);
  const revision = readWorkspaceTools(f.cwd).revision;
  await f.rule("read", disabled, revision);
  const text = await readFile(f.file, "utf8"), saved = JSON.parse(text);
  assert.equal(saved.custom, 7); assert.equal(saved.tools.read.future, 9);
  assert.equal(saved.tools.read.enabled, false); assert.equal(notified, 1);
  assert.match(text, /\r\n\t"version"/);
  await assert.rejects(f.rule("write", disabled, revision), error => error.status === 409);
  assert.equal(await readFile(f.file, "utf8"), text); assert.equal(notified, 1);
});
test("simultaneous edits from one revision admit exactly one writer", async (t) => {
  const f = await fixture(t), revision = readWorkspaceTools(f.cwd).revision;
  const results = await Promise.allSettled([f.rule("read", disabled, revision), f.rule("write", disabled, revision)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  assert.equal(Object.keys(readWorkspaceTools(f.cwd).rules).length, 1);
});
test("untrusted config is ignored and cannot be written", async (t) => {
  const f = await fixture(t); await f.save({ read: disabled });
  await writeFile(f.settings, '{"defaultProjectTrust":"never"}');
  assert.equal(Object.keys(readWorkspaceTools(f.cwd).rules).length, 0);
  const before = await readFile(f.file, "utf8");
  await assert.rejects(f.rule("read", enabled()), error => error.status === 403);
  assert.equal(await readFile(f.file, "utf8"), before);
});
test("disable applies hidden exposure; re-enable restores owner policy without affecting native MCP", async (t) => {
  const f = await fixture(t), session = runtime(f.cwd, [{ name: "read", exposure: "direct" }, { name: "mcp__native__read", exposure: "direct" }]);
  await f.save({ read: disabled, mcp__native__read: disabled }); activateAllSessionTools(session);
  assert.equal(session.definitions[0].exposure, "hidden");
  assert.deepEqual(session.getActiveToolNames(), ["mcp__native__read"]);
  await f.save({ read: enabled() }); activateAllSessionTools(session);
  assert.equal(session.definitions[0].exposure, "direct");
  assert.deepEqual(session.getActiveToolNames().sort(), ["mcp__native__read", "read"]);
  const count = session.updates; activateAllSessionTools(session); assert.equal(session.updates, count);
});
test("codemode and deferred rules activate helpers without premature direct declaration", async (t) => {
  for (const [exposure, helper] of [["codemode", "codemode"], ["deferred", "tool_search"]]) {
    const f = await fixture(t), session = runtime(f.cwd, [{ name: "read", exposure: "direct" }, { name: helper, exposure: "direct" }]);
    await f.save({ read: enabled(exposure) }); activateAllSessionTools(session);
    assert.equal(session.definitions[0].exposure, exposure); assert.deepEqual(session.getActiveToolNames(), [helper]);
    session.setActiveToolsByName(["read", helper]); activateAllSessionTools(session);
    assert.deepEqual(session.getActiveToolNames(), ["read", helper], "explicit SDK discovery survives idle reconciliation");
  }
});
test("owner-withdrawn tools cannot be revived by stale overrides", async (t) => {
  const f = await fixture(t), session = runtime(f.cwd, [{ name: "read", exposure: "direct" }]);
  await f.save({ read: enabled("deferred") }); activateAllSessionTools(session);
  session.definitions[0].exposure = "hidden";
  await f.save({ read: enabled() }); activateAllSessionTools(session);
  assert.equal(session.definitions[0].exposure, "hidden"); assert.deepEqual(session.getActiveToolNames(), []);
  assert.equal((await readToolsSnapshot(f.cwd, session)).tools[0].ownerHidden, true);
  session.definitions[0] = { name: "read", exposure: "hidden" }; activateAllSessionTools(session);
  assert.equal(session.definitions[0].exposure, "hidden");
});
test("runtime guards use captured rules for the whole run, including re-registered tools", async (t) => {
  const f = await fixture(t), handlers = new Map(); await f.save({ read: disabled, mcp__native__read: disabled });
  workspaceToolExtension().factory({ on: (event, handler) => handlers.set(event, handler),
    getAllTools: () => [{ name: "read", sourceInfo: { path: "extension" } }, { name: "mcp__native__read", sourceInfo: { path: "builtin:mcp" } }] });
  await handlers.get("before_agent_start")({}, { cwd: f.cwd });
  await f.save({ read: enabled() });
  assert.equal((await handlers.get("tool_call")({ toolName: "read" })).block, true);
  assert.equal(await handlers.get("tool_call")({ toolName: "mcp__native__read" }), undefined);
  await handlers.get("before_agent_start")({}, { cwd: f.cwd });
  assert.equal(await handlers.get("tool_call")({ toolName: "read" }), undefined);
});
test("tool API lists builtins and persists settings while rejecting stale, unknown and native names", async (t) => {
  const f = await fixture(t), get = () => route.GET(new Request("http://localhost/api/tools?cwd=" + encodeURIComponent(f.cwd)));
  const initialResponse = await get(); assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json(), read = initial.tools.find(tool => tool.name === "read");
  assert.equal(read.source, "builtin"); assert.equal(read.enabled, true);
  const patch = (extra = {}) => route.PATCH(new Request("http://localhost/api/tools", { method: "PATCH",
    body: JSON.stringify({ cwd: f.cwd, name: "read", revision: initial.revision, ...disabled, ...extra }) }));
  assert.equal((await patch()).status, 200);
  assert.deepEqual(readWorkspaceTools(f.cwd).rules.read, { enabled: false }, "matching default exposure is removed from workspace overrides");
  const saved = await (await get()).json();
  assert.equal(saved.tools.find(tool => tool.name === "read").exposure, "direct", "removed override still inherits owner exposure");
  await assert.rejects(f.rule("read", disabled, initial.revision), error => {
    return error instanceof ToolSettingsError && error.status === 409;
  });
  const stale = await patch();
  assert.equal(stale.status, 409, await stale.clone().text());
  assert.equal((await patch({ name: "unregistered" })).status, 404);
  assert.equal((await patch({ name: "mcp__native__read" })).status, 404);
  assert.equal((await patch({ exposure: "invalid" })).status, 400);
  assert.equal((await get()).status, 200);
});
test("source names support packages, Windows paths, file entries and inline factories", async (t) => {
  const f = await fixture(t), cases = [
    ["npm:@scope/plugin@1.2.3", "ignored", "@scope/plugin"],
    ["local", "C:\\Users\\agent\\extensions\\pi-exec-low-priority\\index.ts", "pi-exec-low-priority"],
    ["local", "/extensions/example.ts", "example"], ["inline", "<inline:factory>", "factory"] ];
  const session = runtime(f.cwd, cases.map((_, i) => ({ name: "tool" + i, exposure: "direct" })));
  session.getAllTools = () => cases.map(([source, path], i) => ({ ...session.definitions[i], description: "", sourceInfo: { source, path } }));
  assert.deepEqual((await readToolsSnapshot(f.cwd, session)).tools.map(tool => tool.sourceName), cases.map(c => c[2]));
});
