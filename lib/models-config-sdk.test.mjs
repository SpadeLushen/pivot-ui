import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { calculateCost } from "@earendil-works/pi-ai";
import swc from "next/dist/build/swc/index.js";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const configRoute = await jiti.import("../app/api/models-config/route.ts");
const testRoute = await jiti.import("../app/api/models-config/test/route.ts");
const byLevel = { off: { temperature: 0.2 }, high: { temperature: 0.7, top_p: 0.8 }, max: { temperature: 0.001 } };
const modelConfig = { id: "stub", reasoning: true, contextWindow: 100000, maxTokens: 2048,
  samplingParams: { temperature: 1, top_p: 0.1 }, samplingParamsByThinkingLevel: byLevel,
  thinkingLevelMap: { max: null } };

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-models-102-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function responsesStream() {
  const item = { id: "m1", type: "message", role: "assistant", content: [] };
  const events = [
    { type: "response.created", response: { id: "r1", status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.content_part.added", item_id: "m1", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", item_id: "m1", output_index: 0, content_index: 0, delta: "OK" },
    { type: "response.output_item.done", output_index: 0, item: { ...item, content: [{ type: "output_text", text: "OK" }] } },
    { type: "response.completed", response: { id: "r1", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

test("models GET/PUT preserves sampling overrides and unknown fields", async (t) => {
  await fixture(t);
  const config = { extra: { retained: true }, providers: { local: {
    api: "openai-completions", baseUrl: "http://unused.invalid/v1", apiKey: "local-only",
    models: [{ ...modelConfig, futureField: { keep: true } }],
    modelOverrides: { "catalog-model": { samplingParamsByThinkingLevel: byLevel } },
  } } };
  const response = await configRoute.PUT(new Request("http://localhost/config", { method: "PUT", body: JSON.stringify(config) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await (await configRoute.GET()).json(), config);
});

for (const api of ["openai-completions", "openai-responses", "azure-openai-responses"]) {
  test(`${api}: off/high/clamped thinking and request sampling reach the provider`, async (t) => {
    const root = await fixture(t);
    const modelsPath = path.join(root, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers: { local: { api,
      baseUrl: "http://unused.invalid/v1", apiKey: "local-only", models: [modelConfig] } } }));
    const runtime = await ModelRuntime.create({ modelsPath });
    assert.equal(runtime.getError(), undefined);
    const model = runtime.getModel("local", "stub");
    assert.deepEqual(model.samplingParamsByThinkingLevel, byLevel);
    for (const [reasoning, request, expected] of [
      [undefined, undefined, { temperature: 0.2, top_p: 0.1 }],
      ["high", undefined, { temperature: 0.7, top_p: 0.8 }],
      ["max", { temperature: 0.6 }, { temperature: 0.6, top_p: 0.8 }],
    ]) {
      let payload;
      const result = await completeSimple(model, { messages: [{ role: "user", content: "OK", timestamp: 0 }] }, {
        apiKey: "local-only", reasoning, samplingParams: request, maxRetries: 0, transport: "sse",
        fetch: async (_url, init) => {
          payload = JSON.parse(init.body);
          return new Response(responseStream(api), { headers: { "Content-Type": "text/event-stream" } });
        },
      });
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.equal(payload.temperature, expected.temperature);
      assert.equal(payload.top_p, expected.top_p);
    }
  });
}

test("existing editor callbacks preserve sampling and unknown JSON when changing other fields", async () => {
  const source = await readFile(new URL("../components/ModelsConfig.tsx", import.meta.url), "utf8");
  const detail = source.slice(source.indexOf("function ModelDetail("));
  const callbacks = detail.slice(detail.indexOf("  const set ="), detail.indexOf("  const testSummary"));
  await swc.loadBindings();
  const code = swc.transformSync(callbacks, { jsc: { parser: { syntax: "typescript", tsx: true } } }).code;
  const original = { ...modelConfig, futureField: { keep: true }, cost: { input: 1, tiers: [{ above: 100000 }] } };
  let changed;
  const { set, setCost } = new Function("model", "onChange", `${code}\nreturn { set, setCost };`)(original, (value) => { changed = value; });
  set("name", "Updated");
  assert.deepEqual(changed.samplingParamsByThinkingLevel, byLevel);
  assert.deepEqual(changed.futureField, original.futureField);
  setCost("input", "2");
  assert.deepEqual(changed.cost.tiers, original.cost.tiers);
  assert.deepEqual(changed.samplingParams, original.samplingParams);
});

test("catalog modelOverrides expose thinking sampling without replacing the provider", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "models.json"), JSON.stringify({ providers: { openai: {
    modelOverrides: { "gpt-4.1": { samplingParams: { top_p: 0.3 }, samplingParamsByThinkingLevel: byLevel } },
  } } }));
  const runtime = await ModelRuntime.create();
  assert.equal(runtime.getError(), undefined);
  const model = runtime.getModel("openai", "gpt-4.1");
  assert.ok(model);
  assert.deepEqual(model.samplingParamsByThinkingLevel, byLevel);
  assert.equal(model.samplingParams.top_p, 0.3);
});

test("SDK long-context pricing tiers keep existing cost totals usable", () => {
  const model = { cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25,
    tiers: [{ inputTokensAbove: 200000, input: 2, output: 3, cacheRead: 1, cacheWrite: 2 }] } };
  const usage = { input: 200001, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 200011,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const cost = calculateCost(model, usage);
  assert.ok(Math.abs(cost.input - 0.400002) < 1e-10);
  assert.ok(Math.abs(cost.total - (cost.input + cost.output)) < 1e-10);
});

test("non-finite retry-after falls back instead of failing or hanging", { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "models.json"), JSON.stringify({ providers: { local: {
    api: "openai-completions", baseUrl: "http://unused.invalid/v1", apiKey: "local-only", models: [modelConfig],
  } } }));
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel("local", "stub");
  let calls = 0;
  const result = await completeSimple(model, { messages: [{ role: "user", content: "OK", timestamp: 0 }] }, {
    apiKey: "local-only", maxRetries: 1, maxRetryDelayMs: 2000,
    fetch: async () => ++calls === 1
      ? new Response(JSON.stringify({ error: { message: "model is at capacity" } }),
        { status: 503, headers: { "Content-Type": "application/json", "retry-after-ms": "Infinity" } })
      : new Response(responseStream("openai-completions"), { headers: { "Content-Type": "text/event-stream" } }),
  });
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(calls, 2);
});

test("existing model-test POST preserves thinking sampling and returns the SDK reply", async (t) => {
  await fixture(t);
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let payload;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(responseStream("openai-completions"), { headers: { "Content-Type": "text/event-stream" } });
  };
  const response = await testRoute.POST(new Request("http://localhost/test", { method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { api: "openai-completions",
      baseUrl: "http://unused.invalid/v1", apiKey: "local-only" }, model: modelConfig }),
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.responseText, "OK");
  assert.equal(payload.temperature, byLevel.off.temperature);
  assert.equal(payload.top_p, modelConfig.samplingParams.top_p);
});

function responseStream(api) {
  if (api === "openai-completions") return [
    { choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  ].map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n";
  return responsesStream();
}
