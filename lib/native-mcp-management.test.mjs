import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { mcpHttpFixture } from "./fixtures/native-mcp-http.mjs";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const resources = await jiti.import("../app/api/mcp/resources/route.ts");
const auth = await jiti.import("../app/api/mcp/auth/route.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
const { notifyMcpConfigurationChanged, subscribeResourceChanges } = await jiti.import("./session-resource-events.ts");
const { nativeMcpModule } = await jiti.import("./native-mcp-config.ts");
const { McpOAuthCredentialStore } = nativeMcpModule("extensions/mcp/runtime.js");
const save = (file, value) => writeFile(file, JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(30); }
  assert.fail("management lifecycle did not finish");
}
const request = body => new Request("http://localhost/api/mcp", { method: "POST", body: JSON.stringify(body) });
async function fixture(t, options = {}, config = {}) {
  const peer = await mcpHttpFixture(options), root = await mkdtemp(path.join(tmpdir(), "pivot-mcp-management-"));
  const cwd = path.join(root, "workspace"), old = process.env.PI_CODING_AGENT_DIR;
  await mkdir(cwd); allowFileRoot(cwd); process.env.PI_CODING_AGENT_DIR = root;
  await save(path.join(root, "settings.json"), { defaultProjectTrust: "always" });
  await save(path.join(root, "mcp.json"), { mcpServers: { example: { url: peer.url, ...config } } });
  t.after(async () => {
    notifyMcpConfigurationChanged(cwd);
    await waitFor(() => ![...globalThis.__pivotMcpOAuth?.identities.values() ?? []].some(a => a.record.context.cwd === cwd));
    await peer.close();
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { ...peer, root, cwd,
    inspect: async extra => { const response = await resources.POST(request({ cwd, serverKey: "example", ...extra }));
      return { status: response.status, data: await response.json() }; },
    credentials: new McpOAuthCredentialStore().forServer("example", peer.url) };
}
test("native resource pages filter apps and support independent template pagination", async t => {
  const f = await fixture(t, { templates: true });
  const first = await f.inspect();
  assert.equal(first.status, 200); assert.equal(first.data.state, "connected");
  assert.deepEqual(first.data.resources.map(r => r.name), ["first"]);
  assert.equal(first.data.resourcesCursor, "second");
  assert.deepEqual(first.data.resourceTemplates.map(r => r.name), ["template"]);
  assert.equal(first.data.templatesCursor, "templates-second");
  assert.deepEqual((await f.inspect({ resourcesCursor: "second" })).data.resources.map(r => r.name), ["second"]);
  const templates = (await f.inspect({ templatesCursor: first.data.templatesCursor })).data;
  assert.deepEqual(templates.resourceTemplates.map(r => r.name), ["template-second"]);
  assert.deepEqual(templates.resources.map(r => r.name), ["first"]);
});
test("servers without resources still connect; optional template methods are empty", async t => {
  const f = await fixture(t, { resources: false });
  const { data } = await f.inspect();
  assert.equal(data.state, "connected"); assert.equal(data.resourcesSupported, false);
  assert.deepEqual(data.resources, []); assert.deepEqual(data.resourceTemplates, []);
});
test("resource failures do not turn a working tool connection into a connection failure", async t => {
  const f = await fixture(t, { failResources: true });
  const { data } = await f.inspect();
  assert.equal(data.state, "connected"); assert.equal(data.resourcesError, "mcp.resourceListFailed");
  assert.equal(data.templatesError, undefined); assert.equal(data.error, undefined);
});
test("status inspection reports expired credentials without connecting or exposing tokens", async t => {
  const f = await fixture(t, {}, { enabled: false, oauth: {} });
  await f.credentials.save({ tokens: { access_token: "expired-private", refresh_token: "private-refresh", token_type: "Bearer" }, tokensExpireAt: 1 });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8");
  const { status, data } = await f.inspect({ statusOnly: true });
  assert.equal(status, 200); assert.equal(data.hasOAuthCredentials, true); assert.equal(data.oauthConfigured, true);
  assert.equal(f.calls.length, 0); assert.doesNotMatch(JSON.stringify(data), /expired-private|private-refresh|access_token/);
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
  assert.equal((await f.inspect()).status, 409);
});
test("hidden, untrusted and replaced MCP cannot start management connections", async t => {
  const f = await fixture(t, {}, { exposure: "hidden" });
  assert.equal((await f.inspect()).data.state, "hidden"); assert.equal(f.calls.length, 0);
  await save(path.join(f.root, "settings.json"), { defaultProjectTrust: "never" });
  assert.equal((await f.inspect()).status, 403); assert.equal(f.calls.length, 0);
  await writeFile(path.join(f.root, "replacement.ts"), 'export default pi => pi.registerCommand("mcp", {handler: async () => {}});');
  await save(path.join(f.root, "settings.json"), { defaultProjectTrust: "always", extensions: ["./replacement.ts"] });
  assert.equal((await f.inspect()).status, 409); assert.equal(f.calls.length, 0);
});
test("explicit Authorization auth retains native OAuth exclusivity", async t => {
  const f = await fixture(t, {}, { headers: { Authorization: "private-header" } });
  assert.equal((await f.inspect({ statusOnly: true })).data.oauthAvailable, false);
  const response = await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "start" }));
  assert.match(await response.text(), /mcp.oauthAuthConflict/); assert.equal(f.calls.length, 0);
});
test("unauthorized workspace inspection remains forbidden before network I/O", async t => {
  const f = await fixture(t);
  const response = await resources.POST(request({ cwd: f.root, serverKey: "example", statusOnly: true }));
  assert.equal(response.status, 403); assert.equal(f.calls.length, 0);
});
test("native 401 challenge exposes authentication without an explicit OAuth opt-in", async t => {
  const f = await fixture(t, { requireAuth: true });
  const { data } = await f.inspect();
  assert.equal(data.state, "needs-auth"); assert.equal(data.oauthRequired, true); assert.equal(data.oauthConfigured, false);
  const run = await signIn(t, f), url = await callbackUrl(run);
  await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url }));
  await run.ended; assert.equal(run.events.at(-1).type, "success");
  assert.equal((await f.inspect()).data.state, "connected");
});
test("changed native configuration cancels callback submission without replacing credentials", async t => {
  const f = await fixture(t, {}, { oauth: {} });
  await f.credentials.save({ tokens: { access_token: "old-valid", token_type: "Bearer" } });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), run = await signIn(t, f);
  await save(path.join(f.root, "mcp.json"), { mcpServers: { example: { url: f.url, oauth: {}, headers: { "X-Revision": "changed" } } } });
  const response = await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url: await callbackUrl(run) }));
  assert.equal(response.status, 409); assert.equal((await response.json()).error, "mcp.configurationChanged");
  await run.ended; await waitFor(() => !globalThis.__pivotMcpOAuth.identities.size);
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
});
test("anonymous access can coexist with an explicit OAuth opt-in", async t => {
  const f = await fixture(t, {}, { oauth: {} });
  const { data } = await f.inspect();
  assert.equal(data.state, "connected"); assert.equal(data.oauthRequired, false);
  assert.equal(data.oauthConfigured, true); assert.equal(data.hasOAuthCredentials, false);
});
async function signIn(t, f) {
  const abort = new AbortController();
  const response = await auth.POST(new Request("http://localhost/api/mcp/auth", {
    method: "POST", body: JSON.stringify({ cwd: f.cwd, serverKey: "example", action: "start" }), signal: abort.signal }));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /event-stream/);
  const reader = response.body.getReader(), events = [];
  const ended = (async () => {
    const decoder = new TextDecoder(); let buffer = "";
    for (;;) {
      const { done, value } = await reader.read(); if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
      }
    }
  })();
  t.after(async () => { abort.abort(); await reader.cancel().catch(() => {}); await ended; });
  await waitFor(() => events.some(e => e.type === "prompt") || events.some(e => e.type === "error"));
  assert.equal(events.some(e => e.type === "error"), false, JSON.stringify(events));
  return { events, ended, token: events.find(e => e.type === "started").token,
    url: events.find(e => e.type === "auth").url, abort };
}
async function callbackUrl(run) {
  const response = await fetch(run.url, { redirect: "manual" });
  assert.equal(response.status, 302);
  return response.headers.get("location");
}
test("real SDK optional OAuth accepts a remote pasted URL and emits idle resource notification", async t => {
  const f = await fixture(t, {}, { oauth: {} });
  let changed = 0; const off = subscribeResourceChanges(f.cwd, () => changed++); t.after(off);
  const run = await signIn(t, f), url = await callbackUrl(run);
  const submit = () => auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url }));
  assert.equal((await submit()).status, 200); await run.ended;
  assert.equal(run.events.at(-1).type, "success"); assert.equal(changed, 1);
  assert.equal((await f.credentials.load()).tokens.access_token, "fixture-new-access");
  assert.equal((await submit()).status, 404);
  assert.doesNotMatch(JSON.stringify(run.events), /fixture-new-access|fixture-new-refresh|code_verifier/);
  assert.equal((await f.inspect({ statusOnly: true })).data.hasOAuthCredentials, true);
});
test("real SDK local loopback callback completes without pasted URL", async t => {
  const f = await fixture(t, {}, { oauth: {} }), run = await signIn(t, f);
  const response = await fetch(await callbackUrl(run));
  assert.equal(response.status, 200); await run.ended;
  assert.equal(run.events.at(-1).type, "success");
});
test("reauthentication opens a new authorization flow and cancellation preserves valid credentials", async t => {
  const f = await fixture(t);
  await f.credentials.save({ tokens: { access_token: "old-valid", refresh_token: "old-refresh", token_type: "Bearer" }, tokensExpireAt: Date.now() + 3600000 });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), run = await signIn(t, f);
  assert.ok(run.url.includes("/authorize"));
  assert.equal(f.calls.some(c => c.body.grant_type === "refresh_token"), false);
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
  assert.equal((await auth.POST(request({ cwd: f.cwd, serverKey: "example", token: run.token, action: "cancel" }))).status, 200);
  await run.ended; assert.equal(run.events.at(-1).type, "cancelled");
  await waitFor(() => !globalThis.__pivotMcpOAuth.identities.size);
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
});
test("wrong workspace, duplicate attempts and stale tokens cannot submit a callback", async t => {
  const f = await fixture(t, {}, { oauth: {} }), run = await signIn(t, f);
  assert.equal((await auth.POST(request({ cwd: f.cwd + "-other", serverKey: "example", action: "callback", token: run.token, url: "http://127.0.0.1/callback" }))).status, 403);
  const duplicate = await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "start" }));
  assert.match(await duplicate.text(), /mcp.oauthBusy/);
  assert.equal((await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url: "javascript:bad" }))).status, 400);
});
for (const invalid of ["state", "issuer", "redirect"]) test(`SDK rejects mismatched callback ${invalid} and preserves prior credential bytes`, async t => {
  const f = await fixture(t, {}, { oauth: {} });
  await f.credentials.save({ tokens: { access_token: "old-valid", token_type: "Bearer" } });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), run = await signIn(t, f);
  const url = new URL(await callbackUrl(run));
  if (invalid === "state") url.searchParams.set("state", "wrong");
  else if (invalid === "issuer") url.searchParams.set("iss", f.base + "/wrong-issuer");
  else url.pathname = "/wrong-callback";
  assert.equal((await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url: url.href }))).status, 200);
  await run.ended; assert.equal(run.events.at(-1).type, "error");
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
});
test("token endpoint failure preserves prior credentials", async t => {
  const f = await fixture(t, { failTokens: true }, { oauth: {} });
  await f.credentials.save({ tokens: { access_token: "old-valid", token_type: "Bearer" } });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), run = await signIn(t, f);
  const url = await callbackUrl(run);
  await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "callback", token: run.token, url }));
  await run.ended; assert.equal(run.events.at(-1).type, "error");
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
});
test("disconnect cancels the worker without publishing staged credentials", async t => {
  const f = await fixture(t, {}, { oauth: {} }), run = await signIn(t, f);
  run.abort.abort(); await run.ended;
  await waitFor(() => !globalThis.__pivotMcpOAuth.identities.size);
  assert.equal((await f.credentials.load())?.tokens, undefined);
});
test("parent expiry is bounded and preserves an existing grant", async t => {
  const f = await fixture(t, {}, { oauth: {} });
  await f.credentials.save({ tokens: { access_token: "old-valid", token_type: "Bearer" } });
  const before = await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 300000 ? 100 : ms, ...args);
  try {
    const response = await auth.POST(request({ cwd: f.cwd, serverKey: "example", action: "start" }));
    assert.match(await response.text(), /mcp.oauthExpired/);
  } finally { globalThis.setTimeout = original; }
  await waitFor(() => !globalThis.__pivotMcpOAuth.identities.size);
  assert.equal(await readFile(path.join(f.root, "mcp-auth.json"), "utf8"), before);
});
test("resource and authorization request schemas reject malformed bodies", async () => {
  for (const body of [null, {}, { cwd: "/", serverKey: "bad/name" }, { cwd: "/", serverKey: "ok", statusOnly: "yes" }])
    assert.notEqual((await resources.POST(request(body))).status, 200);
  assert.equal((await auth.POST(request({ cwd: "/", serverKey: "ok", action: "callback" }))).status, 400);
});
