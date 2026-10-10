import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import swc from "next/dist/build/swc/index.js";
import path from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("./model-config-store.ts");
const typed = await jiti.import("./typed-model-runtime.ts");
const { runtimeCatalog, modelTypeCounts } = await jiti.import("./model-catalog.ts");
const { validateModelConfiguration } = await jiti.import("./typed-model-config.ts");
const route = await jiti.import("../app/api/models-config/test/route.ts");
const { classifierTestInput, modelTestUsage } = await jiti.import("./model-test-input.ts");
test("D2 classifier draft uses the real SDK classification protocol, not chat; errors are sanitized", async t => {
  await fixture(t); const requests = []; let fail = false;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader("Content-Type", "application/json");
    res.statusCode = fail ? 400 : 200;
    res.end(JSON.stringify(fail ? { error: "secret-fixture-token" } : { answers: { q: { type: "noul", noul: 0.9 } } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = { providerName: "fixture", source: "draft", provider: { apiKey: "local-fixture",
    baseUrl: "http://127.0.0.1:" + server.address().port },
    model: { id: "shared", type: "classifier", api: "typesafe-system-one" },
    classifierInput: { state: { text: "classify" }, questions: { q: { type: "bool", instructions: "Decide",
      criteria: { true: "yes", false: "no" } } } } };
  const send = () => route.POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) }));
  const result = await (await send()).json(); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.type, "classifier"); assert.match(result.responseText, /0.9/);
  assert.equal(requests[0].url, "/systemone"); assert.equal(requests[0].body.questions.q.type, "noul");
  fail = true; const error = await (await send()).json();
  assert.equal(error.ok, false); assert.doesNotMatch(JSON.stringify(error), /secret-fixture-token/);
});

test("D2 cancellation reaches an in-flight SDK classifier request without leaking its response", async t => {
  await fixture(t); let received; const started = new Promise(resolve => { received = resolve; });
  const server = createServer((req, res) => { req.resume(); received(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const controller = new AbortController();
  const request = new Request("http://localhost/test", { method: "POST", signal: controller.signal,
    body: JSON.stringify({ providerName: "fixture", provider: { apiKey: "local-fixture",
      baseUrl: "http://127.0.0.1:" + server.address().port },
      model: { id: "shared", type: "classifier", api: "typesafe-system-one" },
      classifierInput: { state: {}, questions: { q: { type: "bool", instructions: "Decide",
        criteria: { true: "yes", false: "no" } } } } }) });
  const pending = route.POST(request); await started; controller.abort();
  const result = await (await pending).json();
  assert.equal(result.ok, false); assert.equal(result.code, "aborted");
  assert.match(result.error, /cancel/i);
});

test("D2 invalid input and image Test never issue network requests", async t => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call"); };
  t.after(() => { globalThis.fetch = previous; });
  for (const [model, status] of [[{ id: "x", type: "image" }, 501],
    [{ id: "x", type: "classifier" }, 400], [{ id: "x", type: "unknown" }, 400]]) {
    const response = await route.POST(new Request("http://localhost/test", { method: "POST",
      body: JSON.stringify({ providerName: "fixture", model }) }));
    assert.equal(response.status, status); assert.equal((await response.json()).ok, false);
  }
  assert.equal(calls, 0);
});

test("D2 classifier validation and numeric usage retain zero but exclude secrets and invalid numbers", () => {
  const input = { state: { text: "fixture" }, questions: { q: { type: "bool", instructions: "Decide",
    criteria: { true: "yes", false: "no" } } } };
  assert.deepEqual(classifierTestInput(input), input);
  for (const invalid of [{ ...input, images: [] }, { ...input, questions: {} },
    { ...input, questions: { q: { ...input.questions.q, criteria: { true: "yes" } } } }]) {
    assert.equal(classifierTestInput(invalid), null);
  }
  assert.deepEqual(modelTestUsage({ input: 0, output: -1, cacheRead: Infinity, secret: "token",
    cost: { total: 0, output: NaN, secret: "token" } }), {
    input: 0, output: undefined, cacheRead: undefined, cacheWrite: undefined,
    cost: { input: undefined, output: undefined, cacheRead: undefined, cacheWrite: undefined, total: 0 }
  });
});
const sampling = { temperature: 0, enabled: false, future: null, nested: { values: [0, false, null] } };
function config() {
  return { futureRoot: { keep: true }, providers: { fixture: {
    api: "openai-completions", apiKey: "fixture-only", baseUrl: "http://unused.invalid/v1",
    modelOverrides: { shared: { samplingParams: sampling } },
    models: [undefined, "classifier", "image"].map(type => ({ id: "shared", ...(type ? { type } : {}),
      name: "Shared", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      api: type === "classifier" ? "typesafe-system-one" : type === "image" ? "openrouter-images" : "openai-completions",
      samplingParams: sampling, samplingParamsByThinkingLevel: { future: sampling, off: null }, futureField: false }))
  } } };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-d-models-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old; await rm(root, { recursive: true, force: true }); });
  return path.join(root, "models.json");
}

test("D2b/D4 split, edit, reopen and fresh runtime retain all three identities and opaque sampling", async t => {
  const file = await fixture(t), original = config();
  await store.saveModelConfiguration(file, original);
  const draft = await store.readModelConfiguration(file);
  draft.providers.fixture.models = draft.providers.fixture.models.map(m => ({ ...m, name: "Edited" }));
  await store.saveModelConfiguration(file, draft);
  assert.deepEqual(await store.readModelConfiguration(file), draft);
  const chat = JSON.parse(await readFile(file, "utf8"));
  const nonChat = JSON.parse(await readFile(store.typedModelsPath(file), "utf8"));
  assert.equal(chat.providers.fixture.models.length, 1);
  assert.equal(nonChat.providers.fixture.models.length, 2);
  // Persistence accepts opaque hand-edited values; SDK loading has a narrower schema.
  // Verify restoration separately with SDK-supported thinking-level objects.
  const loadable = structuredClone(draft);
  for (const model of loadable.providers.fixture.models) {
    model.samplingParamsByThinkingLevel = { off: { temperature: 0 } };
  }
  await store.saveModelConfiguration(file, loadable);
  for (let i = 0; i < 2; i++) {
    const runtime = await ModelRuntime.create({ modelsPath: file });
    await typed.loadPivotTypedModels(runtime, file);
    assert.equal(runtime.getError(), undefined);
    for (const type of ["chat", "classifier", "image"]) assert.ok(runtime.getModelOfType(type, "fixture", "shared"), type);
    assert.equal(runtime.getModelsOfType("chat", "fixture").length, 1);
    assert.deepEqual(modelTypeCounts(runtime, "fixture"), { chat: 1, classifier: 1, image: 1 });
    const catalog = runtimeCatalog(runtime).filter(m => m.provider === "fixture");
    assert.equal(catalog.length, 3);
    assert.equal(new Set(catalog.map(m => m.type)).size, 3);
    assert.doesNotMatch(JSON.stringify(catalog), /fixture-only|baseUrl|headers|apiKey/);
    assert.equal(runtime.getModelOfType("classifier", "fixture", "shared").samplingParams.temperature, 0);
    typed.clearPivotTypedModels(runtime);
  }
  const script = `import { createJiti } from "jiti";
    import { ModelRuntime } from "@earendil-works/pi-coding-agent";
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { loadPivotTypedModels } = await jiti.import("./lib/typed-model-runtime.ts");
    const runtime = await ModelRuntime.create({ modelsPath: ${JSON.stringify(file)} });
    await loadPivotTypedModels(runtime, ${JSON.stringify(file)});
    console.log(JSON.stringify(runtime.getAllModels("fixture").map(m => [m.type ?? "chat", m.id])));`;
  const child = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd() });
  assert.deepEqual(JSON.parse(child.stdout), [["chat", "shared"], ["classifier", "shared"], ["image", "shared"]]);
});

test("D2b second file replacement failure rolls back both configuration documents", async t => {
  const file = await fixture(t); await store.saveModelConfiguration(file, config());
  const files = [file, store.typedModelsPath(file)];
  const before = await Promise.all(files.map(f => readFile(f, "utf8")));
  const rename = fsPromises.rename; let calls = 0;
  // Compile the unchanged production module with a narrowly injected fs failure.
  // jiti caches named fs imports, so patching fsPromises after import has no effect.
  await swc.loadBindings();
  const source = await readFile(new URL("./model-config-store.ts", import.meta.url), "utf8");
  const code = swc.transformSync(source, { jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" } }).code;
  const configModule = await jiti.import("./typed-model-config.ts");
  const require = createRequire(import.meta.url), module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "./typed-model-config") return configModule;
    if (name === "node:fs/promises") return { ...fsPromises, rename: async (...args) => {
      if (++calls === 2) throw new Error("injected second replacement failure");
      return rename(...args);
    } };
    return require(name);
  }, module, module.exports);
  const changed = config(); changed.providers.fixture.models[0].name = "must rollback";
  await assert.rejects(module.exports.saveModelConfiguration(file, changed), /previous files restored/);
  assert.equal(calls, 4);
  assert.deepEqual(await Promise.all(files.map(f => readFile(f, "utf8"))), before);
});

test("D2b malformed files and future versions are never overwritten", async t => {
  const file = await fixture(t);
  await store.saveModelConfiguration(file, config());
  const before = await readFile(file, "utf8"), typedFile = store.typedModelsPath(file);
  for (const broken of ["{", '{"version":99,"providers":{}}']) {
    await writeFile(typedFile, broken);
    await assert.rejects(store.readModelConfiguration(file));
    await assert.rejects(store.saveModelConfiguration(file, config()));
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal(await readFile(typedFile, "utf8"), broken);
  }
});

test("D2b rename/delete reload removes owned registrations without replacing extension owners", async t => {
  const file = await fixture(t); await store.saveModelConfiguration(file, config());
  const runtime = await ModelRuntime.create({ modelsPath: file });
  await typed.loadPivotTypedModels(runtime, file);
  await store.saveModelConfiguration(file, { providers: {} });
  await typed.loadPivotTypedModels(runtime, file);
  assert.equal(runtime.getModelOfType("classifier", "fixture", "shared"), undefined);
  runtime.registerProvider("fixture", { models: [] });
  const owner = runtime.getRegisteredProviderConfig("fixture");
  await store.saveModelConfiguration(file, config());
  await assert.rejects(typed.loadPivotTypedModels(runtime, file), /conflicts/);
  assert.equal(runtime.getRegisteredProviderConfig("fixture"), owner);
});

test("D2b invalid duplicate/type/API/URL configurations are rejected", () => {
  for (const mutate of [c => c.providers.fixture.models.push(c.providers.fixture.models[0]),
    c => c.providers.fixture.models[1].api = "openai-completions",
    c => c.providers.fixture.models[0].api = "openrouter-images",
    c => c.providers.fixture.baseUrl = "file:///private"]) {
    const c = config(); mutate(c); assert.throws(() => validateModelConfiguration(c));
  }
});
