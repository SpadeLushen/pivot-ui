import type { TypedModelEntry } from "./model-catalog";
import type { ModelPickerEntry } from "./session-models";

export interface ModelScopeDiagnosticDto {
  code: "no-match" | "invalid-thinking-level" | "ambiguous" | "fallback" | "unavailable";
  pattern: string;
}

export interface ModelsData {
  modelScopeDiagnostics?: ModelScopeDiagnosticDto[];
  typedCatalog: TypedModelEntry[];
  catalogUnavailable?: boolean;
  catalogError?: string;
  models: Record<string, string>;
  modelList: ModelPickerEntry[];
  defaultModel: { provider: string; modelId: string } | null;
  defaultThinkingLevel: string | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
  catalogGeneration?: number;
  refreshControllers?: Set<AbortController>;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
const MAX_MODELS_CACHE_ENTRIES = 32;

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function modelCatalogGeneration(): number {
  return getModelsCacheState().catalogGeneration ?? 0;
}

/** Config/auth edits cancel old publications; snapshot-only refreshes do not. */
export function invalidateModelsCache(options: { catalogChanged?: boolean } = {}): void {
  const state = getModelsCacheState();
  state.generation += 1;
  if (options.catalogChanged !== false) {
    state.catalogGeneration = (state.catalogGeneration ?? 0) + 1;
    for (const controller of state.refreshControllers ?? []) controller.abort();
    state.refreshControllers?.clear();
  }
  state.entries.clear();
  state.inFlight.clear();
}

export function trackModelCatalogRefresh(controller: AbortController): () => void {
  const controllers = getModelsCacheState().refreshControllers ??= new Set();
  controllers.add(controller);
  return () => { controllers.delete(controller); };
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now() && Array.isArray(cached.data.typedCatalog)) return Promise.resolve(cached.data);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      // A config/auth change during the read must not return an old account's snapshot.
      if (state.generation !== generation) return loadModelsWithCache(cwd, loader);
      if (state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
