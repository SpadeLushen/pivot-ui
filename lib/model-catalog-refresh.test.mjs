import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import swc from "next/dist/build/swc/index.js";
import * as cache from "./models-cache.ts";
const require = createRequire(import.meta.url);
await swc.loadBindings();
const source = await readFile(new URL("./model-catalog-refresh.ts", import.meta.url), "utf8");
const code = swc.transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" } }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const success = () => ({ aborted: false, errors: new Map() });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-catalog-120-"));
  const offline = process.env.PI_OFFLINE; delete process.env.PI_OFFLINE;
  cache.invalidateModelsCache(); delete globalThis.__pivotCatalogRefreshes;
  let creates = 0, notices = 0;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "@earendil-works/pi-coding-agent") return { getAgentDir: () => root };
    if (name === "./models-cache") return cache;
    if (name === "./session-resource-events") return { notifyResourceConfigurationChanged: () => notices++ };
    if (name === "./model-runtime") return { createPivotAgentSessionServices: async () => { creates++; throw Error("Unexpected factory"); } };
    return require(name);
  }, module, module.exports);
  t.after(async () => {
    cache.invalidateModelsCache(); delete globalThis.__pivotCatalogRefreshes;
    if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const calls = [];
  const runtime = {
    getProvider: () => ({ refreshModels() {} }), getError: () => undefined,
    checkAuth: async () => ({ type: "api_key" }),
    refresh: async options => { calls.push(options); return success(); },
  };
  return { ...module.exports, root, runtime, calls, get creates() { return creates; }, get notices() { return notices; } };
}

test("shares concurrent refreshes and throttles automatic opens, but manual refresh bypasses TTL", async t => {
  const f = await fixture(t), gate = deferred();
  f.runtime.refresh = async options => { f.calls.push(options); return gate.promise; };
  const a = f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  const b = f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  await tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "refreshing");
  gate.resolve(success()); assert.equal((await a).ok, true); assert.deepEqual(await b, await a);
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "fresh");
  assert.equal((await f.refreshModelCatalog("openrouter")).ok, true);
  assert.equal(f.creates, 0); assert.equal(f.calls.length, 1);
  await f.refreshModelCatalog("openrouter", { force: true, runtime: f.runtime });
  assert.equal(f.calls.length, 2); assert.equal(f.notices, 2);
  assert.equal(f.calls[0].allowNetwork, true); assert.deepEqual(f.calls[0].providers, ["openrouter"]);
});

test("one waiter cancelling does not cancel another; the final waiter cancels the SDK work", async t => {
  const f = await fixture(t), gate = deferred(), first = new AbortController();
  f.runtime.refresh = async options => { f.calls.push(options); return gate.promise; };
  const a = f.refreshModelCatalog("openrouter", { runtime: f.runtime, signal: first.signal });
  const b = f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  await tick(); first.abort();
  assert.equal((await a).error, "models.refreshCancelled");
  assert.equal(f.calls[0].signal.aborted, false);
  gate.resolve(success()); assert.equal((await b).ok, true);
  const last = new AbortController(), late = deferred();
  f.runtime.refresh = async options => { f.calls.push(options); return late.promise; };
  const c = f.refreshModelCatalog("openrouter", { force: true, runtime: f.runtime, signal: last.signal });
  await tick(); last.abort(); assert.equal((await c).ok, false);
  assert.equal(f.calls[1].signal.aborted, true);
  late.resolve(success()); await tick();
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "failed");
});

test("config invalidation supersedes pending refresh and a late success cannot replace its new status", async t => {
  const f = await fixture(t), late = deferred(); let call = 0;
  f.runtime.refresh = async options => { f.calls.push(options); return ++call === 1 ? late.promise : success(); };
  const old = f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  await tick(); cache.invalidateModelsCache();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "cached");
  const current = await f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  assert.equal(current.ok, true); assert.equal((await old).error, "models.refreshCancelled");
  late.resolve(success()); await tick();
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "fresh");
  assert.equal(f.notices, 1);
});

test("external credential/config edits invalidate fresh status and pending refresh", async t => {
  const f = await fixture(t);
  await f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  for (const file of ["auth.json", "models.json", "pivot-models.json"]) {
    await writeFile(path.join(f.root, file), JSON.stringify({ fixture: file }));
    assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "cached");
    assert.equal((await f.refreshModelCatalog("openrouter", { runtime: f.runtime })).ok, true);
  }
  const late = deferred();
  f.runtime.refresh = async options => { f.calls.push(options); return late.promise; };
  const old = f.refreshModelCatalog("openrouter", { force: true, runtime: f.runtime });
  await tick();
  await writeFile(path.join(f.root, "auth.json"), '{"changed":"new-test-key-with-a-different-size"}');
  f.runtime.refresh = async options => { f.calls.push(options); return success(); };
  assert.equal((await f.refreshModelCatalog("openrouter", { runtime: f.runtime })).ok, true);
  assert.equal((await old).error, "models.refreshCancelled");
  late.resolve(success()); await tick();
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "fresh");
});

test("different workspaces queue without cancelling the first caller", async t => {
  const f = await fixture(t), gate = deferred();
  f.runtime.refresh = async options => { f.calls.push(options); return f.calls.length === 1 ? gate.promise : success(); };
  const a = f.refreshModelCatalog("openrouter", { cwd: path.join(f.root, "a"), runtime: f.runtime });
  const b = f.refreshModelCatalog("openrouter", { cwd: path.join(f.root, "b"), runtime: f.runtime });
  await tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, false);
  gate.resolve(success()); assert.equal((await a).ok, true); assert.equal((await b).ok, true);
  assert.equal(f.calls.length, 2);
});

test("deadline releases refresh state even when a provider ignores cancellation, and retry succeeds", async t => {
  const f = await fixture(t), late = deferred();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  f.runtime.refresh = async options => { f.calls.push(options); return late.promise; };
  const pending = f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  await tick(); t.mock.timers.tick(29_999);
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "refreshing");
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { ok: false, error: "models.refreshCancelled", status: 408 });
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(globalThis.__piModelsCacheState.refreshControllers.size, 0);
  f.runtime.refresh = async options => { f.calls.push(options); return success(); };
  assert.equal((await f.refreshModelCatalog("openrouter", { runtime: f.runtime })).ok, true);
  late.resolve(success()); await tick();
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "fresh");
});

test("provider failures are sanitized, keep failed status and allow explicit retry", async t => {
  const f = await fixture(t);
  f.runtime.refresh = async () => ({ aborted: false, errors: new Map([["openrouter", new Error("secret-body")]]) });
  assert.deepEqual(await f.refreshModelCatalog("openrouter", { runtime: f.runtime }), {
    ok: false, error: "models.refreshFailed", status: 502,
  });
  assert.doesNotMatch(JSON.stringify(f.modelCatalogRefreshStatus("openrouter", process.cwd())), /secret-body/);
  f.runtime.refresh = async () => success();
  assert.equal((await f.refreshModelCatalog("openrouter", { runtime: f.runtime, force: true })).ok, true);
});

test("offline mode and pre-aborted callers never create services or invoke refresh", async t => {
  const f = await fixture(t); process.env.PI_OFFLINE = "1";
  assert.equal((await f.refreshModelCatalog("openrouter")).error, "models.refreshOffline");
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "offline");
  delete process.env.PI_OFFLINE;
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.refreshModelCatalog("openrouter", { signal: controller.signal })).error, "models.refreshCancelled");
  assert.equal(f.creates, 0); assert.equal(f.calls.length, 0);
});

test("unknown/unrefreshable/invalid/unconfigured providers fail before network work", async t => {
  const f = await fixture(t);
  for (const [patch, error, status] of [
    [{ getProvider: () => undefined }, "models.refreshInvalidProvider", 404],
    [{ getProvider: () => ({}) }, "models.refreshUnsupported", 501],
    [{ getError: () => "secret-config-error" }, "models.configurationInvalid", 409],
    [{ checkAuth: async () => undefined }, "models.refreshNeedsAuth", 409],
  ]) {
    assert.deepEqual(await f.refreshModelCatalog("openrouter", { runtime: { ...f.runtime, ...patch }, force: true }), { ok: false, error, status });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.notices, 0);
});

test("freshness expires and only expired automatic opens perform another refresh", async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  await f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  t.mock.timers.tick(59_999);
  await f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(1);
  assert.equal(f.modelCatalogRefreshStatus("openrouter", process.cwd()).state, "cached");
  await f.refreshModelCatalog("openrouter", { runtime: f.runtime });
  assert.equal(f.calls.length, 2);
});
