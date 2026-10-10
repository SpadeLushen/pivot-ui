import type { ModelType } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { knownModelLimit, VIRTUAL_CHAT_API } from "./response-model";

export type CatalogModelType = ModelType;
export interface TypedModelEntry {
  type: CatalogModelType;
  provider: string;
  id: string;
  name: string;
  input: string[];
  configured: boolean;
  virtual?: boolean;
  contextWindow?: number | null;
  maxTokens?: number | null;
  availability: "available" | "unknown" | "unavailable";
}
export type ModelTypeCounts = Record<CatalogModelType, number>;
export const modelIdentity = (type: CatalogModelType, provider: string, id: string) => JSON.stringify([type, provider, id]);

/** models.json currently constructs chat entries, even for unknown type fields. */
export async function configuredNonChatRefs(path: string): Promise<Set<string>> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as { providers?: Record<string, { models?: { id?: string; type?: string }[] }> };
    const types = new Map<string, string>();
    for (const [provider, config] of Object.entries(data.providers ?? {})) {
      for (const model of config.models ?? []) {
        if (typeof model.id === "string") types.set(modelIdentity("chat", provider, model.id), model.type ?? "chat");
      }
    }
    return new Set([...types].filter(([, type]) => type !== "chat").map(([key]) => key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw new Error("Unable to read model configuration");
  }
}

/** Static DTO only. No request auth, OAuth refresh, or model call. */
export function runtimeCatalog(runtime: ModelRuntime, excluded = new Set<string>()): TypedModelEntry[] {
  const chatAvailable = new Set(runtime.getAvailableSnapshot().map((m) => modelIdentity("chat", m.provider, m.id)));
  const entries = new Map<string, TypedModelEntry>();
  for (const model of runtime.getAllModels()) {
    const type = model.type ?? "chat";
    const key = modelIdentity(type, model.provider, model.id);
    if (type === "chat" && excluded.has(key)) continue;
    const configured = runtime.getProviderAuthStatus(model.provider).configured;
    entries.set(key, {
      type, provider: model.provider, id: model.id, name: model.name,
      input: [...model.input], configured,
      ...(type === "chat" ? { virtual: model.api === VIRTUAL_CHAT_API,
        contextWindow: knownModelLimit("contextWindow" in model ? model.contextWindow : undefined),
        maxTokens: knownModelLimit("maxTokens" in model ? model.maxTokens : undefined) } : {}),
      availability: type === "chat" && chatAvailable.has(key) ? "available" : configured ? "unknown" : "unavailable",
    });
  }
  return [...entries.values()].sort((a, b) => a.provider.localeCompare(b.provider)
    || a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function modelTypeCounts(runtime: ModelRuntime, provider: string): ModelTypeCounts {
  const counts: ModelTypeCounts = { chat: 0, classifier: 0, image: 0 };
  for (const model of runtime.getAllModels(provider)) counts[model.type ?? "chat"] += 1;
  return counts;
}
