import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { saveModelConfiguration } = await jiti.import("./model-config-store.ts");
const { createPivotModelRuntime } = await jiti.import("./model-runtime.ts");
const { refreshModelCatalog, modelCatalogRefreshStatus } = await jiti.import("./model-catalog-refresh.ts");
const { invalidateModelsCache } = await jiti.import("./models-cache.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, typed = false) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-120-models-sdk-"));
  const old = process.env.PI_CODING_AGENT_DIR, offline = process.env.PI_OFFLINE, fetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = root; delete process.env.PI_OFFLINE;
  invalidateModelsCache(); delete globalThis.__pivotCatalogRefreshes;
  t.after(async () => {
    invalidateModelsCache(); delete globalThis.__pivotCatalogRefreshes;
    globalThis.fetch = fetch;
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await writeFile(path.join(root, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "local-fixture-key" } }));
  await saveModelConfiguration(path.join(root, "models.json"), { $schema: "https://pi.dev/schemas/models.schema.json", providers: {
    openrouter: { baseUrl: "http://local-catalog.invalid/v1", models: typed ? [
      { id: "fixture-classifier", type: "classifier", api: "typesafe-system-one", input: ["text"] },
      { id: "fixture-image", type: "image", api: "openrouter-images", input: ["text"] },
    ] : [] },
  } });
  const calls = [], state = { handler: async () => Response.json({ data: [] }) };
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url)); calls.push({ url: target.href, init });
    if (target.hostname === "pi.dev" && target.pathname.startsWith("/api/models/providers/")) return new Response("", { status: 404 });
    if (target.hostname === "local-catalog.invalid" && target.pathname === "/v1/models/user") return state.handler(url, init);
    throw Error(`Unexpected external request: ${target.hostname}`);
  };
  const runtime = await createPivotModelRuntime();
  assert.equal(runtime.getError(), undefined);
  const [allowed, excluded] = runtime.getModels("openrouter"); assert.ok(allowed && excluded);
  state.handler = async () => Response.json({ data: [entry(allowed.id)] });
  return { root, runtime, allowed, excluded, calls, state };
}
const entry = id => ({ id, context_length: 8192, top_provider: { context_length: 4096, max_completion_tokens: 321 },
  pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0", input_cache_write: "0" } });

test("real SDK personalized catalog filters chat, preserves typed models and restores offline after reopening", async t => {
  const f = await fixture(t, true);
  const otherTypes = ["classifier", "image"].map(type => f.runtime.getModelsOfType(type, "openrouter").map(m => m.id));
  assert.equal((await refreshModelCatalog("openrouter", { runtime: f.runtime, force: true })).ok, true);
  assert.deepEqual(f.runtime.getModels("openrouter").map(m => m.id), [f.allowed.id]);
  assert.equal(f.runtime.getModel("openrouter", f.excluded.id), undefined);
  const current = f.runtime.getModel("openrouter", f.allowed.id);
  assert.equal(current.contextWindow, 4096); assert.equal(current.maxTokens, 321);
  assert.equal(current.cost.input, 1); assert.equal(current.cost.output, 2);
  for (const [i, type] of ["classifier", "image"].entries()) {
    assert.deepEqual(f.runtime.getModelsOfType(type, "openrouter").map(m => m.id), otherTypes[i]);
  }
  const persisted = JSON.parse(await readFile(path.join(f.root, "models-store.json"), "utf8"));
  assert.deepEqual(persisted.openrouter.models.filter(m => (m.type ?? "chat") === "chat").map(m => m.id), [f.allowed.id]);
  const count = f.calls.length, reopened = await createPivotModelRuntime();
  assert.deepEqual(reopened.getModels("openrouter").map(m => m.id), [f.allowed.id]);
  assert.equal(f.calls.length, count, "read-only reopen must not access the network");
  assert.ok(f.calls.some(c => c.url === "http://local-catalog.invalid/v1/models/user"));
});

test("failed SDK refresh retains last usable catalog and reports failure, not fresh verification", async t => {
  const f = await fixture(t);
  await refreshModelCatalog("openrouter", { runtime: f.runtime, force: true });
  const before = await readFile(path.join(f.root, "models-store.json"), "utf8");
  f.state.handler = async () => new Response("secret-response", { status: 500 });
  const failed = await refreshModelCatalog("openrouter", { runtime: f.runtime, force: true });
  assert.equal(failed.error, "models.refreshFailed");
  assert.equal(modelCatalogRefreshStatus("openrouter", process.cwd()).state, "failed");
  assert.deepEqual(f.runtime.getModels("openrouter").map(m => m.id), [f.allowed.id]);
  assert.equal(await readFile(path.join(f.root, "models-store.json"), "utf8"), before);
  assert.doesNotMatch(JSON.stringify(failed), /secret-response/);
});

test("changed credentials abort real SDK publication; late response cannot overwrite new persisted list", async t => {
  const f = await fixture(t), entered = deferred(), late = deferred(); let requests = 0;
  f.state.handler = async (_url, init) => {
    if (++requests === 1) { entered.resolve(init); return late.promise; }
    assert.equal(init.headers.authorization, "Bearer new-fixture-key");
    return Response.json({ data: [entry(f.excluded.id)] });
  };
  const old = refreshModelCatalog("openrouter", { runtime: f.runtime, force: true });
  const init = await entered.promise;
  await writeFile(path.join(f.root, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "new-fixture-key" } }));
  invalidateModelsCache(); assert.equal(init.signal.aborted, true);
  const newRuntime = await createPivotModelRuntime();
  assert.equal((await refreshModelCatalog("openrouter", { runtime: newRuntime, force: true })).ok, true);
  assert.equal((await old).error, "models.refreshCancelled");
  late.resolve(Response.json({ data: [entry(f.allowed.id)] })); await tick(); await tick();
  const persisted = JSON.parse(await readFile(path.join(f.root, "models-store.json"), "utf8"));
  assert.deepEqual(persisted.openrouter.models.filter(m => (m.type ?? "chat") === "chat").map(m => m.id), [f.excluded.id]);
  assert.deepEqual(newRuntime.getModels("openrouter").map(m => m.id), [f.excluded.id]);
});

test("SDK catalog 401/403/404 fall back to general list without treating it as an access check", async t => {
  const f = await fixture(t), original = f.runtime.getModels("openrouter").map(m => m.id);
  for (const status of [401, 403, 404]) {
    f.state.handler = async () => new Response("", { status });
    assert.equal((await refreshModelCatalog("openrouter", { runtime: f.runtime, force: true })).ok, true);
    assert.deepEqual(f.runtime.getModels("openrouter").map(m => m.id), original);
  }
});

test("SDK rejects newly invalid positive token overrides and leaves the configuration file intact", async t => {
  const f = await fixture(t), file = path.join(f.root, "models.json");
  for (const value of [0, -1]) {
    const raw = JSON.stringify({ providers: { openrouter: { modelOverrides: { [f.allowed.id]: { contextWindow: value } } } } });
    await writeFile(file, raw);
    const runtime = await ModelRuntime.create({ modelsPath: file });
    assert.match(runtime.getError(), /contextWindow|schema/);
    const result = await refreshModelCatalog("openrouter", { runtime, force: true });
    assert.equal(result.error, "models.configurationInvalid");
    assert.equal(await readFile(file, "utf8"), raw);
  }
});
