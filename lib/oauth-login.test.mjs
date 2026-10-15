import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test, { after } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
// Set isolation before importing SDK/routes: login now reads credentials and device settings.
const agentDir = await mkdtemp(path.join(tmpdir(), "pivot-provider-login-"));
const previousDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
  delete globalThis.__pivotLoginSettings;
  await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../app/api/auth/login/[provider]/route.ts");
const params = (provider = "anthropic") => ({ params: Promise.resolve({ provider }) });
const post = (token, code, provider) => route.POST(new Request("http://localhost/login", {
  method: "POST", body: JSON.stringify({ token, code }),
}), params(provider));
test("browser selection owns a fresh one-use token separate from the manual code", async (t) => {
  fakeRuntime(t, async (_provider, method, ui) => {
    assert.equal(method, "oauth");
    assert.equal(await ui.prompt(selection), "browser");
    ui.notify({ type: "auth_url", url: "http://unused.invalid/auth" });
    assert.equal(await ui.prompt({ type: "manual_code", message: "Paste code" }), "test-code");
  });
  const flow = await stream();
  const choice = await flow.event();
  assert.equal(choice.type, "select_request");
  assert.deepEqual(choice.options, selection.options);
  assert.equal((await post(choice.token, "not-a-choice")).status, 400);
  assert.equal((await post(choice.token, "browser", "anthropic-other")).status, 400);
  assert.equal((await post(choice.token, "browser")).status, 200);
  assert.equal((await post(choice.token, "browser")).status, 404);
  const auth = await flow.event();
  const code = await flow.event();
  assert.equal(auth.type, "auth");
  assert.equal(code.type, "prompt_request");
  assert.equal(auth.token, code.token);
  assert.notEqual(code.token, choice.token);
  assert.equal((await post(code.token, "test-code")).status, 200);
  assert.equal((await flow.event()).type, "success");
  assert.equal((await flow.reader.read()).done, true);
  assert.equal(globalThis.__piLoginCallbacks.size, 0);
});

test("post-login catalog refresh failure warns but preserves successful login", async t => {
  fakeRuntime(t, async () => {}, async () => { throw new Error("fixture catalog failure"); });
  const flow = await stream();
  assert.deepEqual(await flow.event(), { type: "info", message: "auth.savedReloadFailed" });
  assert.deepEqual(await flow.event(), { type: "success" });
  assert.equal((await flow.reader.read()).done, true);
  assert.equal(globalThis.__piLoginCallbacks.size, 0);
});

test("disconnect cancels selection and revokes its token", async (t) => {
  fakeRuntime(t, async (_provider, _method, ui) => { await ui.prompt(selection); });
  const flow = await stream();
  const choice = await flow.event();
  await flow.reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await post(choice.token, "browser")).status, 404);
  assert.equal(globalThis.__piLoginCallbacks.size, 0);
});

test("abort during runtime creation cannot leave a pending token", async (t) => {
  let release, enteredLogin = false, created;
  const creating = new Promise(resolve => { created = resolve; });
  const original = ModelRuntime.create;
  ModelRuntime.create = () => new Promise((resolve) => { release = resolve; created(); });
  t.after(() => { ModelRuntime.create = original; delete globalThis.__piLoginCallbacks; });
  const abort = new AbortController();
  const flow = await stream(abort.signal);
  await creating; // credentials are read asynchronously before ModelRuntime.create
  abort.abort();
  release({ getProviders: () => [{ id: "anthropic", auth: { oauth: {} } }],
    login: async (_provider, _method, ui) => { enteredLogin = true; await ui.prompt(selection); } });
  assert.equal((await flow.reader.read()).done, true);
  assert.equal(enteredLogin, false);
  assert.equal(globalThis.__piLoginCallbacks?.size ?? 0, 0);
});

test("login UI renders option ids and submits them, not the labels", async () => {
  const source = await readFile(new URL("../components/ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(source, /data\.type === "select_request"/);
  assert.ok(source.includes("submitSelection(loginState.token, option.id)"));
  assert.ok(source.includes("{option.label}"));
});

const selection = { type: "select", message: "Select Anthropic login method:", options: [
  { id: "browser", label: "Browser login (default)" }, { id: "copy_code", label: "Copy code login (headless)" },
] };

function fakeRuntime(t, login, refresh = async options => {
  assert.deepEqual(options.providers, ["anthropic"]);
  assert.equal(options.allowNetwork, true);
  return { errors: new Map(), aborted: false };
}) {
  const original = ModelRuntime.create;
  ModelRuntime.create = async () => ({
    getProviders: () => [{ id: "anthropic", auth: { oauth: {} } }],
    getProvider: id => id === "anthropic" ? { auth: { oauth: {} }, refreshModels() {} } : undefined,
    getError: () => undefined, checkAuth: async () => ({ type: "oauth" }), login, refresh,
  });
  t.after(() => { ModelRuntime.create = original; delete globalThis.__piLoginCallbacks; });
}
async function stream(signal) {
  const response = await route.GET(new Request("http://localhost/login", { signal }), params());
  const reader = response.body.getReader();
  return { reader, event: async () => {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    return JSON.parse(new TextDecoder().decode(value).slice(6).trim());
  } };
}
