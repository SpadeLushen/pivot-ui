import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const route = await jiti.import("../app/api/mcp/servers/route.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
const { mcpFormValues, buildMcpFormDefinition } = await jiti.import("./mcp-editor-form.ts");
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); };
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-mcp-editor-")), cwd = path.join(root, "workspace");
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  await mkdir(cwd); allowFileRoot(cwd);
  await save(path.join(root, "settings.json"), { defaultProjectTrust: "always" });
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true }); });
  const snapshot = async (scope = "global") => {
    const response = await route.GET(new Request("http://localhost/api/mcp/servers?" + new URLSearchParams({ scope, cwd })));
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  return { root, cwd, snapshot, file: path.join(root, "mcp.json"), project: path.join(cwd, ".pi/mcp.json") };
}
const change = (method, body) => route[method](new Request("http://localhost/api/mcp/servers", { method, body: JSON.stringify(body) }));
test("global create defaults disabled, uses pure validation and preserves file metadata", async (t) => {
  const f = await fixture(t), marker = path.join(f.root, "must-not-run");
  await save(f.file, { custom: { retained: 1 }, mcpServers: {} });
  const response = await change("POST", { scope: "global", serverKey: "example", revision: (await f.snapshot()).revision,
    definition: { command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`], env: { TOKEN: "!must-not-execute" } } });
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json(); assert.equal(data.servers[0].enabled, false);
  assert.doesNotMatch(JSON.stringify(data), /must-not-execute/);
  assert.equal(existsSync(marker), false);
  assert.equal((await read(f.file)).custom.retained, 1);
  assert.equal((await read(f.file)).mcpServers.example.enabled, false);
});
test("form to API round trip preserves raw secrets and hidden fields without exposing them", async (t) => {
  const f = await fixture(t), raw = { url: "https://example.com/mcp?token=private-url",
    headers: { Authorization: "private-header" }, oauth: { clientSecret: "private-oauth" },
    auth: { provider: "example" }, toolExposure: { "*": "hidden" }, future: { values: [1, false] } };
  await save(f.file, { top: 9, mcpServers: { example: raw } });
  const snapshot = await f.snapshot(), original = snapshot.servers[0].definition, initial = mcpFormValues(original);
  const definition = buildMcpFormDefinition(original, initial, { ...initial, description: "Edited" }, true, true, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-/);
  const response = await change("PATCH", { scope: "global", serverKey: "example", revision: snapshot.revision, definition });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await read(f.file), { top: 9, mcpServers: { example: { ...raw, description: "Edited" } } });
});
test("workspace switch creates only an override; removing it restores global state", async (t) => {
  const f = await fixture(t); await save(f.file, { mcpServers: { shared: { command: "never-run", env: { TOKEN: "private" }, enabled: false } } });
  const before = await readFile(f.file, "utf8"), initial = await f.snapshot("project");
  assert.equal(initial.servers[0].inherited, true);
  const response = await change("PATCH", { scope: "project", cwd: f.cwd, serverKey: "shared", revision: initial.revision, enabled: true });
  assert.equal(response.status, 200);
  const active = await response.json(); assert.equal(active.servers[0].overridesGlobal, true);
  assert.deepEqual((await read(f.project)).mcpServers.shared, { enabled: true });
  const removed = await change("DELETE", { scope: "project", cwd: f.cwd, serverKey: "shared", revision: active.revision });
  assert.equal(removed.status, 200);
  const inherited = (await removed.json()).servers[0]; assert.equal(inherited.inherited, true); assert.equal(inherited.enabled, false);
  assert.equal(await readFile(f.file, "utf8"), before);
});
test("metadata distinguishes standalone workspace entries and full same-name overrides", async (t) => {
  const f = await fixture(t); await save(f.file, { mcpServers: { shared: { command: "global", enabled: false } } });
  await save(f.project, { mcpServers: { shared: { command: "local" }, standalone: { command: "local" } } });
  const data = await f.snapshot("project");
  assert.equal(data.servers.find(s => s.serverKey === "shared").overridesGlobal, true);
  assert.equal(data.servers.find(s => s.serverKey === "standalone").overridesGlobal, false);
});
test("stale revisions, invalid definitions and invalid masks cannot change the file", async (t) => {
  const f = await fixture(t); await save(f.file, { mcpServers: { example: { command: "server" } } });
  const revision = (await f.snapshot()).revision, before = await readFile(f.file, "utf8");
  for (const [definition, expected] of [[{ type: "sse", url: "https://example.com" }, 400], [{ command: "server", timeout: 0 }, 400],
    [{ command: "server", env: { NEW: "<redacted:unchanged>" } }, 400]]) {
    assert.equal((await change("PATCH", { scope: "global", serverKey: "example", revision, definition })).status, expected);
  }
  assert.equal((await change("DELETE", { scope: "global", serverKey: "example", revision: "stale" })).status, 409);
  assert.equal(await readFile(f.file, "utf8"), before);
});
test("Pack-owned entries cannot be deleted or have enablement changed", async (t) => {
  const f = await fixture(t); await save(f.project, { mcpServers: { managed: { command: "server", enabled: false } } });
  const packState = path.join(f.cwd, ".pi/skill-packs.json");
  await save(packState, { version: 2, appliedPacks: [{ packId: "active", status: "full", receipt: { installed: [], mcpServers: [], nativeMcpServers: ["managed"] } }], managedNativeMcpServers: ["managed"] });
  const revision = (await f.snapshot("project")).revision, before = await readFile(f.project, "utf8");
  for (const [method, extra] of [["DELETE", {}], ["PATCH", { enabled: true }]]) {
    assert.equal((await change(method, { scope: "project", cwd: f.cwd, serverKey: "managed", revision, ...extra })).status, 409);
  }
  assert.equal(await readFile(f.project, "utf8"), before);
  await save(packState, { version: 2, appliedPacks: [], managedNativeMcpServers: ["managed"] });
  const released = await f.snapshot("project");
  assert.equal(released.servers[0].managedByPack, false);
  assert.equal((await read(f.project)).mcpServers.managed.enabled, false);
  assert.equal((await change("PATCH", { scope: "project", cwd: f.cwd, serverKey: "managed", revision: released.revision, enabled: true })).status, 200);
});
test("project auth and untrusted project writes are rejected without touching global credentials", async (t) => {
  const f = await fixture(t), revision = (await f.snapshot("project")).revision;
  assert.equal((await change("POST", { scope: "project", cwd: f.cwd, serverKey: "example", revision,
    definition: { url: "https://example.com", auth: { provider: "example" } } })).status, 400);
  await save(path.join(f.root, "settings.json"), { defaultProjectTrust: "never" });
  assert.equal((await route.GET(new Request("http://localhost/api/mcp/servers?scope=project&cwd=" + encodeURIComponent(f.cwd)))).status, 403);
  assert.equal(existsSync(f.project), false);
});
test("namespace collisions are rejected and deleting definitions does not remove OAuth storage", async (t) => {
  const f = await fixture(t); await save(f.file, { mcpServers: { "a-b": { command: "server" } } });
  const auth = path.join(f.root, "mcp-auth.json"); await save(auth, { sentinel: "private" });
  const revision = (await f.snapshot()).revision;
  assert.equal((await change("POST", { scope: "global", serverKey: "a_b", revision, definition: { command: "server" } })).status, 409);
  assert.equal((await change("DELETE", { scope: "global", serverKey: "a-b", revision })).status, 200);
  assert.deepEqual(await read(auth), { sentinel: "private" });
});
test("global configuration symlinks are rejected", async (t) => {
  const f = await fixture(t), target = path.join(f.root, "outside.json"); await save(target, { mcpServers: {} });
  symlinkSync(target, f.file);
  const response = await route.GET(new Request("http://localhost/api/mcp/servers?scope=global"));
  assert.equal(response.status, 403); assert.deepEqual(await read(target), { mcpServers: {} });
});
