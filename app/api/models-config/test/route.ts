import { NextResponse } from "next/server";
import { mkdtempSync, rmSync } from "fs";
import { stat } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createPivotAgentSessionServices, createPivotModelRuntime, LEGACY_AZURE_PROVIDER } from "@/lib/model-runtime";
import { classifierTestInput, isRecord, modelTestUsage } from "@/lib/model-test-input";
import { saveModelConfiguration } from "@/lib/model-config-store";
import { ModelConfigurationError } from "@/lib/typed-model-config";

export const dynamic = "force-dynamic";
const TEST_TIMEOUT_MS = 20_000;

export async function POST(req: Request) {
  let tempDir: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const signal = AbortSignal.any([req.signal, controller.signal]);
  let status: number | undefined;
  const startedAt = Date.now();
  const failed = (error: string, code: string, httpStatus = 200) => NextResponse.json({
    ok: false, error, code, status, latencyMs: Date.now() - startedAt,
  }, { status: httpStatus });
  try {
    const body: unknown = await req.json();
    if (!isRecord(body) || typeof body.providerName !== "string" || !body.providerName.trim()) return failed("providerName is required", "input", 400);
    if (!isRecord(body.model) || typeof body.model.id !== "string" || !body.model.id.trim()) return failed("Model ID is required", "input", 400);
    const providerName = body.providerName.trim();
    const modelId = body.model.id.trim();
    const type = body.model.type ?? "chat";
    if (type !== "chat" && type !== "classifier" && type !== "image") return failed("Unsupported model type", "type", 400);
    // Generating an image is billable work, not a silent connection probe.
    if (type === "image") return failed("Image generation is not supported by this test entry. Use an explicit generation workflow.", "unsupported", 501);
    const classifierInput = type === "classifier" ? classifierTestInput(body.classifierInput) : null;
    if (type === "classifier" && !classifierInput) return failed("Provide valid classifier JSON: state and 1–16 choice/bool/score questions. Image inputs are not supported by this entry.", "input", 400);
    const fromCatalog = body.source === "catalog";
    if (!fromCatalog && !isRecord(body.provider)) return failed("provider is required for a draft test", "input", 400);
    if (body.source !== undefined && body.source !== "catalog" && body.source !== "draft") return failed("Unsupported test source", "input", 400);
    timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let modelsPath: string | undefined;
    if (!fromCatalog) {
      tempDir = mkdtempSync(join(tmpdir(), "pivot-ui-model-test-"));
      modelsPath = join(tempDir, "models.json");
      await saveModelConfiguration(modelsPath, { providers: { [providerName]: {
        ...body.provider as Record<string, unknown>,
        models: [{ ...body.model, id: modelId }],
      } } });
    }
    const cwd = resolve(typeof body.cwd === "string" ? body.cwd : process.cwd());
    if (fromCatalog && !(await stat(cwd)).isDirectory()) return failed("Invalid workspace directory", "input", 400);
    const runtime = fromCatalog
      ? (await createPivotAgentSessionServices({ cwd, modelRuntimeSignal: signal })).modelRuntime
      : await createPivotModelRuntime({ modelsPath, signal }, providerName === LEGACY_AZURE_PROVIDER);
    if (runtime.getError()) return failed("Model configuration is invalid or unsupported", "configuration");
    // Availability applies SDK credential precedence and per-operation filters,
    // including OpenAI classifiers unavailable under ChatGPT OAuth.
    const available = await runtime.getAvailableOfType(type, providerName, { signal });
    if (!available.some((m) => m.id === modelId)) return failed("Model is unavailable for its type and current authentication", "unavailable");
    const options = {
      signal, timeoutMs: TEST_TIMEOUT_MS, maxRetries: 0,
      onResponse: (response: { status: number }) => { status = response.status; },
    };
    if (type === "classifier" && classifierInput) {
      const model = runtime.getModelOfType("classifier", providerName, modelId);
      if (!model) return failed("Classifier model not found", "unavailable");
      const result = await runtime.classify(model, classifierInput, options);
      if (result.stopReason !== "stop") return failed(result.stopReason === "aborted" ? "Classifier request cancelled or timed out" : "Classifier request failed", result.stopReason);
      return NextResponse.json({ ok: true, type, status, latencyMs: Date.now() - startedAt,
        responseText: JSON.stringify(result.answers).slice(0, 300), usage: modelTestUsage(result.usage) });
    }
    const model = runtime.getModelOfType("chat", providerName, modelId);
    if (!model) return failed("Chat model not found", "unavailable");
    // models.json accepts arbitrary API strings. A known non-chat API must
    // not become a chat operation just because the draft omitted its type.
    const sameApi = runtime.getAllModels().filter((entry) => entry.api === model.api);
    if (!fromCatalog && sameApi.some((entry) => entry.type === "classifier" || entry.type === "image")
      && !sameApi.some((entry) => entry.id !== modelId && (entry.type ?? "chat") === "chat")) {
      return failed("API belongs to a non-chat model; provide the correct model type", "type", 400);
    }
    const message = await runtime.completeSimple(model, {
      messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }],
    }, { ...options, maxTokens: 16, cacheRetention: "none" });
    if (message.stopReason === "error" || message.stopReason === "aborted") return failed(message.stopReason === "aborted" ? "Chat request cancelled or timed out" : "Chat request failed", message.stopReason);
    return NextResponse.json({ ok: true, type, status, latencyMs: Date.now() - startedAt,
      responseText: message.content.filter((block) => block.type === "text").map((block) => block.text).join("").slice(0, 300),
      usage: modelTestUsage(message.usage) });
  } catch (error) {
    if (error instanceof ModelConfigurationError) return failed(error.message, "configuration", 400);
    // Provider/configuration errors may contain credentials or response bodies.
    return failed(signal.aborted ? (req.signal.aborted ? "Request cancelled" : "Test timed out") : "Model request or configuration failed", signal.aborted ? "aborted" : "request", 500);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
