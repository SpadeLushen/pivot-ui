import type { ModelType } from "@earendil-works/pi-ai";

export const MODEL_APIS = {
  chat: ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"],
  classifier: ["typesafe-system-one", "openai-decisions", "cloudflare-workers-ai-system-one", "llama-cpp-classify"],
  image: ["openrouter-images"],
} as const;
/** Opaque, hand-edited JSON: preserve unknown keys, nulls and future thinking levels.
 * These fields are carried through editing/storage, never normalized by the UI.
 */
export interface SavedSamplingFields {
  samplingParams?: Record<string, unknown> | null;
  samplingParamsByThinkingLevel?: Record<string, Record<string, unknown> | null> | null;
}
export interface SavedModel extends SavedSamplingFields {
  [key: string]: unknown;
  id: string;
  type?: ModelType;
  name?: string;
  api?: string;
  baseUrl?: string;
  input?: string[];
  output?: string[];
  contextWindow?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}
export interface SavedProvider {
  [key: string]: unknown;
  baseUrl?: string;
  api?: string;
  models?: SavedModel[];
  // Includes sampling overrides; keep the entire hand-edited value opaque.
  modelOverrides?: Record<string, unknown> | null;
}
export interface ModelConfiguration {
  [key: string]: unknown;
  providers?: Record<string, SavedProvider>;
}
export interface TypedConfiguration {
  version: 1;
  providers: Record<string, { models: SavedModel[] }>;
}
export class ModelConfigurationError extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new ModelConfigurationError(message); }

export function validateModelConfiguration(value: unknown): asserts value is ModelConfiguration {
  if (!record(value) || (value.providers !== undefined && !record(value.providers))) fail("Invalid Provider configuration");
  for (const [name, provider] of Object.entries(value.providers ?? {})) {
    if (!name.trim() || !record(provider)) fail("Invalid Provider definition");
    for (const key of ["api", "baseUrl", "apiKey"]) {
      if (provider[key] !== undefined && typeof provider[key] !== "string") fail("Invalid Provider connection field");
    }
    if (provider.models !== undefined && !Array.isArray(provider.models)) fail("Models must be an array");
    const identities = new Set<string>();
    for (const model of (provider.models ?? []) as unknown[]) {
      if (!record(model) || typeof model.id !== "string" || !model.id.trim()) fail("Model ID is required");
      const type = model.type ?? "chat";
      if (type !== "chat" && type !== "classifier" && type !== "image") fail("Unsupported model type");
      const identity = JSON.stringify([type, model.id]);
      if (identities.has(identity)) fail("Duplicate model ID within the same type");
      identities.add(identity);
      for (const key of ["api", "baseUrl", "name"]) {
        if (model[key] !== undefined && typeof model[key] !== "string") fail("Invalid model metadata");
      }
      for (const key of ["contextWindow", "maxTokens"]) {
        if (model[key] !== undefined && (typeof model[key] !== "number" || !Number.isFinite(model[key]) || model[key] <= 0)) fail("Token limits must be positive numbers");
      }
      if (model.input !== undefined && (!Array.isArray(model.input) || !model.input.length || !model.input.every((v) => v === "text" || v === "image"))) fail("Invalid model input modalities");
      if (type === "chat") {
        const api = model.api ?? provider.api;
        if ([...MODEL_APIS.classifier, ...MODEL_APIS.image].includes(api as never)) fail("A non-chat API cannot be used by a chat model");
        continue;
      }
      if (typeof model.api !== "string" || !(MODEL_APIS[type] as readonly string[]).includes(model.api)) fail("Choose a supported API for the non-chat model type");
      const url = model.baseUrl ?? provider.baseUrl;
      if (typeof url !== "string" || !url.trim()) fail("Base URL is required for non-chat models");
      try { if (!["http:", "https:"].includes(new URL(url).protocol)) fail("Base URL must use HTTP or HTTPS"); }
      catch { fail("Invalid Base URL"); }
      if (type === "image" && model.output !== undefined && (!Array.isArray(model.output) || !model.output.includes("image") || !model.output.every((v) => v === "text" || v === "image"))) fail("Image output must include image");
      const cost = model.cost;
      if (cost !== undefined) {
        if (!record(cost)) fail("Invalid model cost");
        for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
          const amount = cost[key];
          if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)) fail("Invalid model cost");
        }
      }
    }
  }
}

export function splitModelConfiguration(config: ModelConfiguration) {
  const typed: TypedConfiguration = { version: 1, providers: {} };
  const providers = Object.fromEntries(Object.entries(config.providers ?? {}).map(([name, provider]) => {
    const nonChat = (provider.models ?? []).filter((model) => (model.type ?? "chat") !== "chat");
    if (nonChat.length) Object.defineProperty(typed.providers, name, { value: { models: nonChat }, enumerable: true });
    return [name, { ...provider, ...(provider.models ? { models: provider.models.filter((model) => (model.type ?? "chat") === "chat") } : {}) }];
  }));
  return { chat: { ...config, providers }, typed };
}

