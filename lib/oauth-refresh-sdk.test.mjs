import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";
const sdkDir = path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
// Test the actual file-backed SDK store, not a dummy CredentialStore implementation.
const { AuthStorage } = await import(pathToFileURL(path.join(sdkDir, "core/auth-storage.js")));
const { getAuthStore } = await createJiti(import.meta.url).import("./auth-store.ts");
const fresh = { type: "oauth", access: "new-access", refresh: "rotated-refresh", expires: Date.now() + 3600000 };
const expired = { ...fresh, access: "expired-access", refresh: "old-refresh", expires: 0 };
async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("Timed out waiting for SDK credential persistence");
}

for (const operation of ["request", "model refresh", "superseded refresh"]) {
  test(`${operation} cancellation does not discard a rotated token`, { timeout: 10000 }, async (t) => {
    const f = await fixture(t, operation !== "request");
    const controller = new AbortController();
    const pending = operation === "request" ? f.models.getAuth("p0-refresh", { signal: controller.signal })
      : f.models.refresh({ signal: controller.signal });
    const finished = operation === "request" ? assert.rejects(pending, { name: "AbortError" }) : pending;
    await f.started.promise;
    let newer;
    if (operation === "superseded refresh") newer = f.models.refresh();
    else controller.abort();
    f.gate.resolve();
    await finished;
    if (newer) await newer;
    await waitFor(async () => JSON.parse(await readFile(f.file, "utf8"))["p0-refresh"].refresh === fresh.refresh);
    assert.equal(f.state.signal.aborted, false, "once started, refresh has its own bounded signal");
    assert.equal(f.state.calls, 1);
    const restored = AuthStorage.create(f.file);
    assert.deepEqual(await restored.read("p0-refresh"), fresh);
    assert.equal((await f.models.getAuth("p0-refresh")).auth.apiKey, fresh.access);
  });
}

test("API-key writes share the SDK lock and retain a concurrent rotated OAuth token", { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const refreshing = f.models.getAuth("p0-refresh");
  await f.started.promise;
  const saving = getAuthStore().modify("other-provider", async () => ({ type: "api_key", key: "local-key" }));
  await new Promise((r) => setTimeout(r, 50));
  f.gate.resolve();
  await Promise.all([refreshing, saving]);
  const data = JSON.parse(await readFile(f.file, "utf8"));
  assert.deepEqual(data["p0-refresh"], fresh);
  assert.deepEqual(data["other-provider"], { type: "api_key", key: "local-key" });
});

test("delete waits for a running SDK refresh and cannot be undone by its late write", { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const refreshing = f.models.getAuth("p0-refresh");
  await f.started.promise;
  const deleting = getAuthStore().delete("p0-refresh");
  await new Promise((r) => setTimeout(r, 50));
  f.gate.resolve();
  await Promise.all([refreshing, deleting]);
  assert.equal(await AuthStorage.create(f.file).read("p0-refresh"), undefined);
  assert.equal(await f.models.getAuth("p0-refresh"), undefined);
});

test("cancelled lock waiter does not start another refresh; concurrent requests refresh once", { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const first = f.models.getAuth("p0-refresh");
  await f.started.promise;
  const controller = new AbortController();
  const cancelled = assert.rejects(f.models.getAuth("p0-refresh", { signal: controller.signal }), { name: "AbortError" });
  controller.abort();
  await cancelled;
  const concurrent = f.models.getAuth("p0-refresh");
  f.gate.resolve();
  const results = await Promise.all([first, concurrent]);
  assert.equal(f.state.calls, 1);
  assert.ok(results.every((r) => r.auth.apiKey === fresh.access));
});

test("malformed auth cannot be overwritten or expose parser snippets", async (t) => {
  const f = await fixture(t);
  const damaged = '{"secret":"private-content",';
  await writeFile(f.file, damaged);
  await assert.rejects(getAuthStore().modify("other", async () => ({ type: "api_key", key: "key" })),
    /Cannot read auth.json; credentials left unchanged/);
  assert.equal(await readFile(f.file, "utf8"), damaged);
});

test("another process's API-key write cannot clobber the SDK refresh", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const refreshing = f.models.getAuth("p0-refresh");
  await f.started.promise;
  const program = `import { createJiti } from 'jiti';
    const { getAuthStore } = await createJiti(${JSON.stringify(import.meta.url)}).import('./auth-store.ts');
    console.log('ready');
    await getAuthStore().modify('child-key', async () => ({ type: 'api_key', key: 'local-child-key' }));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", program], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exit = new Promise((resolve) => child.once("exit", resolve));
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(() => { assert.equal(child.exitCode, null, output); return output.includes('ready'); }, 10000);
  f.gate.resolve();
  await refreshing;
  assert.equal(await exit, 0, output);
  const data = JSON.parse(await readFile(f.file, "utf8"));
  assert.deepEqual(data["p0-refresh"], fresh);
  assert.equal(data["child-key"].key, "local-child-key");
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
async function fixture(t, dynamic = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-refresh-103-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const gate = deferred();
  t.after(async () => {
    gate.resolve();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "auth.json");
  await writeFile(file, JSON.stringify({ "p0-refresh": expired }));
  const credentials = AuthStorage.create(file);
  const started = deferred();
  const state = { calls: 0, signal: undefined };
  const models = createModels({ credentials });
  models.setProvider(createProvider({ id: "p0-refresh", name: "Local OAuth fixture", models: [],
    api: { stream() { throw new Error("No network in this test"); }, streamSimple() { throw new Error("No network in this test"); } },
    auth: { oauth: { label: "Local", login: async () => fresh, toAuth: async (c) => ({ apiKey: c.access }),
      refresh: async (_c, signal) => { state.calls++; state.signal = signal; started.resolve(); await gate.promise; return fresh; } } },
    ...(dynamic ? { fetchModels: async () => [] } : {}),
  }));
  return { dir, file, gate, started, state, models, credentials, dynamic };
}
