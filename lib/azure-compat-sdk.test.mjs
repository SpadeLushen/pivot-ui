import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPivotModelRuntime, createPivotAgentSessionServices, LEGACY_AZURE_PROVIDER: legacy } = await jiti.import("./model-runtime.ts");
const { startRpcSession } = await jiti.import("./rpc-manager.ts");

async function fixture(t, auth = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-azure-103-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, "auth.json"), JSON.stringify(auth));
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ defaultProvider: legacy,
    defaultModel: "gpt-5.4", enabledModels: [`${legacy}/gpt-5.4`],
    modelThinkingLevels: { [`${legacy}/gpt-5.4`]: "high" }, defaultProjectTrust: "always" }));
  return dir;
}

test("legacy Azure still resolves unchanged environment API-key configuration", async (t) => {
  const dir = await fixture(t);
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = "local-env-key";
  t.after(() => { if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY; else process.env.AZURE_OPENAI_API_KEY = previous; });
  const { modelRuntime } = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const model = modelRuntime.getModel(legacy, "gpt-5.4");
  assert.equal(model.api, "azure-openai-responses");
  assert.equal((await modelRuntime.getAuth(model)).auth.apiKey, "local-env-key");
  assert.equal(await readFile(path.join(dir, "auth.json"), "utf8"), "{}");
});

test("Web models/defaults/auth endpoints retain old identity and do not expose credentials", async (t) => {
  const dir = await fixture(t, { [legacy]: { type: "api_key", key: "endpoint-private-key",
    env: { AZURE_OPENAI_RESOURCE_NAME: "fixture-resource" } } });
  const { invalidateModelsCache } = await jiti.import("./models-cache.ts");
  invalidateModelsCache();
  const models = await jiti.import("../app/api/models/route.ts");
  const response = await models.GET(new Request(`http://local/api/models?cwd=${encodeURIComponent(dir)}`));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.defaultModel, { provider: legacy, modelId: "gpt-5.4" });
  assert.deepEqual(data.modelList.map((m) => `${m.provider}/${m.id}`), [`${legacy}/gpt-5.4`]);
  const defaults = await jiti.import("../app/api/models/defaults/route.ts");
  const saved = await defaults.PATCH(new Request("http://local/api/models/defaults", { method: "PATCH",
    body: JSON.stringify({ cwd: dir, provider: legacy, modelId: "gpt-5.4" }) }));
  assert.equal(saved.status, 200, await saved.clone().text());
  const keys = await jiti.import("../app/api/auth/api-key/[provider]/route.ts");
  const status = await keys.GET(new Request("http://local"), { params: Promise.resolve({ provider: legacy }) });
  const json = await status.json();
  assert.equal(json.configured, true);
  assert.ok(json.models > 0);
  assert.doesNotMatch(JSON.stringify(json), /endpoint-private-key/);
  const changedKey = await keys.POST(new Request("http://local", { method: "POST", body: '{"apiKey":"replacement-private-key"}' }),
    { params: Promise.resolve({ provider: legacy }) });
  assert.equal(changedKey.status, 200);
  const credential = JSON.parse(await readFile(path.join(dir, "auth.json"), "utf8"))[legacy];
  assert.equal(credential.key, "replacement-private-key");
  assert.deepEqual(credential.env, { AZURE_OPENAI_RESOURCE_NAME: "fixture-resource" });
  const providerList = await jiti.import("../app/api/auth/all-providers/route.ts");
  assert.ok((await (await providerList.GET()).json()).providers.some((p) => p.id === legacy && p.configured));
});

test("new users get no legacy catalog; a custom old-name provider is not replaced", async (t) => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, "settings.json"), "{}");
  assert.equal((await createPivotModelRuntime()).getProvider(legacy), undefined);
  await writeFile(path.join(dir, "models.json"), JSON.stringify({ providers: { [legacy]: {
    api: "openai-completions", apiKey: "custom-key", baseUrl: "http://unused.invalid/v1",
    models: [{ id: "custom" }],
  } } }));
  const runtime = await createPivotModelRuntime({}, true);
  assert.equal(runtime.getModel(legacy, "custom").api, "openai-completions");
  assert.equal(runtime.getModel(legacy, "gpt-5.4"), undefined);
});

test("missing old Azure auth refuses fallback before touching the session file", async (t) => {
  const dir = await fixture(t, { azure: { type: "api_key", key: "not-the-old-identity" } });
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  t.after(() => { if (previousKey !== undefined) process.env.AZURE_OPENAI_API_KEY = previousKey; });
  const manager = SessionManager.create(dir, path.join(dir, "sessions"));
  manager.appendModelChange(legacy, "gpt-5.4");
  manager.appendMessage({ role: "user", content: "unanswered", timestamp: 1 });
  manager.appendMessage({ role: "assistant", provider: legacy, model: "gpt-5.4", api: legacy,
    content: [], stopReason: "stop", timestamp: 2 });
  const file = manager.getSessionFile();
  const before = await readFile(file, "utf8");
  const starting = startRpcSession(manager.getSessionId(), file, dir);
  starting.then(({ session }) => session.destroy(), () => {});
  await assert.rejects(starting, /Saved Azure model could not be restored/);
  assert.equal(await readFile(file, "utf8"), before);
  const { cacheSessionPath } = await jiti.import("./session-reader.ts");
  cacheSessionPath(manager.getSessionId(), file);
  const route = await jiti.import("../app/api/agent/[id]/route.ts");
  const params = { params: Promise.resolve({ id: manager.getSessionId() }) };
  const invalid = await route.POST(new Request("http://local", { method: "POST",
    body: JSON.stringify({ type: "set_model", provider: "azure", modelId: "missing-model" }) }), params);
  assert.equal(invalid.status, 500);
  assert.equal(await readFile(file, "utf8"), before);
  const changed = await route.POST(new Request("http://local", { method: "POST",
    body: JSON.stringify({ type: "set_model", provider: "azure", modelId: "gpt-5.4", persist: true }) }), params);
  const { getRpcSession } = await jiti.import("./rpc-manager.ts");
  t.after(() => getRpcSession(manager.getSessionId())?.destroy());
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await changed.json()).data.provider, "azure");
  assert.equal(JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8")).defaultProvider, "azure");
  const restored = SessionManager.open(file);
  assert.equal(restored.buildSessionContext().model.provider, "azure");
  const historical = restored.getEntries().find((entry) => entry.type === "message" && entry.message.role === "assistant");
  assert.equal(historical.message.provider, legacy);
});

test("old Azure session restores, reloads and forks without rewriting historical identities", async (t) => {
  const dir = await fixture(t, { [legacy]: { type: "api_key", key: "local-old-key" } });
  const manager = SessionManager.create(dir, path.join(dir, "sessions"));
  manager.appendModelChange(legacy, "gpt-5.4");
  manager.appendThinkingLevelChange("high");
  manager.appendMessage({ role: "user", content: "saved question", timestamp: 1 });
  manager.appendMessage({ role: "assistant", provider: legacy, model: "gpt-5.4", api: legacy,
    content: [{ type: "text", text: "saved reply" }], stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const file = manager.getSessionFile();
  const original = await readFile(file, "utf8");
  const { session } = await startRpcSession(manager.getSessionId(), file, dir);
  t.after(() => session.destroy());
  assert.equal(session.inner.model.provider, legacy);
  assert.equal(session.inner.thinkingLevel, "high");
  await session.send({ type: "reload" });
  assert.equal(session.inner.model.provider, legacy);
  assert.ok(session.inner.modelRuntime.getModel(legacy, "gpt-5.4"));
  assert.equal(await readFile(file, "utf8"), original);
  const entryId = manager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "user").id;
  const forked = await session.send({ type: "fork", entryId });
  const { resolveSessionPath } = await jiti.import("./session-reader.ts");
  const { session: child } = await startRpcSession(forked.newSessionId, await resolveSessionPath(forked.newSessionId), dir);
  t.after(() => child.destroy());
  assert.equal(child.inner.model.provider, legacy);
});

test("old Azure credentials, catalog overrides and settings remain readable without migration", async (t) => {
  const dir = await fixture(t, { [legacy]: { type: "api_key", key: "old-key" },
    azure: { type: "api_key", key: "new-key" } });
  await writeFile(path.join(dir, "models.json"), JSON.stringify({ providers: { [legacy]: {
    baseUrl: "https://old.invalid/openai/v1", headers: { "x-original": "retained" },
    modelOverrides: { "gpt-5.4": { samplingParams: { temperature: 0.2 } } },
  }, azure: { baseUrl: "https://new.invalid/openai/v1" } } }));
  const originals = await Promise.all(["auth.json", "settings.json", "models.json"].map((file) => readFile(path.join(dir, file), "utf8")));
  const { modelRuntime: runtime, settingsManager } = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const old = runtime.getModel(legacy, "gpt-5.4");
  assert.ok(old);
  assert.equal(old.api, "azure-openai-responses");
  assert.equal(old.baseUrl, "https://old.invalid/openai/v1");
  assert.equal((await runtime.getAuth(old)).auth.headers["x-original"], "retained");
  assert.deepEqual(old.samplingParams, { temperature: 0.2 });
  assert.equal((await runtime.getAuth(old)).auth.apiKey, "old-key");
  assert.equal((await runtime.getAuth(runtime.getModel("azure", "gpt-5.4"))).auth.apiKey, "new-key");
  assert.equal(settingsManager.getDefaultProvider(), legacy);
  assert.deepEqual(settingsManager.getEnabledModels(), [`${legacy}/gpt-5.4`]);
  assert.equal(settingsManager.getModelThinkingLevel(legacy, "gpt-5.4"), "high");
  await runtime.refresh({ allowNetwork: false });
  assert.ok(runtime.getAvailableSnapshot().some((m) => m.provider === legacy));
  assert.deepEqual(await Promise.all(["auth.json", "settings.json", "models.json"].map((file) => readFile(path.join(dir, file), "utf8"))), originals);
});
