import { MODEL_APIS, type SavedModel } from "./typed-model-config";

export interface ProviderCatalogModel {
  id: string;
  name?: string;
  type?: keyof typeof MODEL_APIS;
  input?: string[];
  output?: string[];
  vision?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: SavedModel["cost"];
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function modalities(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const supported = [...new Set(value.filter((m): m is string => m === "text" || m === "image"))];
  return supported.length ? supported : undefined;
}
const positiveInteger = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

export function normalizeProviderCatalog(body: unknown): ProviderCatalogModel[] {
  if (!isObject(body) || !Array.isArray(body.data)) return [];
  const models: ProviderCatalogModel[] = [];
  for (const item of body.data) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    const m: ProviderCatalogModel = { id: item.id.trim() };
    if (typeof item.name === "string" && item.name.trim()) m.name = item.name.trim();
    if (item.type === "chat" || item.type === "image" || item.type === "classifier") m.type = item.type;
    if (positiveInteger(item.context_length)) m.contextWindow = item.context_length;
    if (positiveInteger(item.max_output_tokens)) m.maxTokens = item.max_output_tokens;
    if (isObject(item.modalities)) {
      m.input = modalities(item.modalities.input);
      m.output = modalities(item.modalities.output);
    }
    if (isObject(item.capabilities)) {
      if (typeof item.capabilities.reasoning === "boolean") m.reasoning = item.capabilities.reasoning;
      if (typeof item.capabilities.vision === "boolean" && !Array.isArray(isObject(item.modalities) ? item.modalities.input : undefined)) m.vision = item.capabilities.vision;
    }
    if (isObject(item.pricing)) {
      for (const [field, key] of [["input", "input"], ["output", "output"], ["cache_read", "cacheRead"], ["cache_write", "cacheWrite"]] as const) {
        const price = item.pricing[field];
        if (typeof price === "number" && Number.isFinite(price) && price >= 0) (m.cost ??= {})[key] = price;
      }
    }
    models.push(m);
  }
  return models;
}

export function withModelType<T extends SavedModel>(model: T, type: keyof typeof MODEL_APIS): T {
  return { ...model, type, api: type === "chat" ? undefined : MODEL_APIS[type][0],
    ...(type === "image" && !model.output?.includes("image") ? { output: ["image"] } : {}) };
}

export function applyCatalogModel<T extends SavedModel>(model: T, m: ProviderCatalogModel): T {
  const type = m.type ?? model.type ?? "chat";
  const base = type !== (model.type ?? "chat") ? withModelType(model, type) : model;
  return { ...base, id: m.id,
    ...(m.name !== undefined && { name: m.name }),
    ...(m.input ? { input: m.input } : m.vision !== undefined ? { input: m.vision ? ["text", "image"] : ["text"] } : {}),
    ...(type === "image" && m.output?.includes("image") && { output: m.output }),
    ...(type !== "image" && m.contextWindow !== undefined && { contextWindow: m.contextWindow }),
    ...(type === "chat" && m.reasoning !== undefined && { reasoning: m.reasoning }),
    ...(type === "chat" && m.maxTokens !== undefined && { maxTokens: m.maxTokens }),
    ...(m.cost && { cost: { ...model.cost, ...m.cost } }),
  };
}
