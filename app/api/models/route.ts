import { stat } from "fs/promises";
import { join, resolve } from "path";
import { getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { loadModelsWithCache, type ModelsData } from "@/lib/models-cache";
import { createPivotAgentSessionServices } from "@/lib/model-runtime";
import { configuredNonChatRefs, modelIdentity, runtimeCatalog } from "@/lib/model-catalog";
import { ModelConfigurationError } from "@/lib/typed-model-config";
import type { ModelPickerEntry } from "@/lib/session-models";
import { knownModelLimit, VIRTUAL_CHAT_API } from "@/lib/response-model";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.substring(colonIndex + 1);
  return THINKING_SUFFIXES.has(suffix) ? trimmed.substring(0, colonIndex) : trimmed;
}

function filterByExactEnabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
): readonly T[] {
  if (!enabledModels || enabledModels.length === 0) return available;

  const refs = new Set(enabledModels.map(stripThinkingSuffix).filter(Boolean));
  const visible = available.filter((m) => refs.has(`${m.provider}/${m.id}`) || refs.has(m.id));
  return visible.length > 0 ? visible : available;
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let modelList: ModelPickerEntry[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const agentDir = getAgentDir();
  const services = await createPivotAgentSessionServices({ cwd, agentDir });
  const runtime = services.modelRuntime;
  const excluded = await configuredNonChatRefs(join(agentDir, "models.json"));
  const typedCatalog = runtimeCatalog(runtime, excluded);
  const available = runtime.getAvailableSnapshot().filter((m) => !excluded.has(modelIdentity("chat", m.provider, m.id)));
  const settings: SettingsManager = services.settingsManager;
  const enabledModels = settings.getEnabledModels();
  const visible = filterByExactEnabledModels(available, enabledModels);
  modelList = visible.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    virtual: m.api === VIRTUAL_CHAT_API,
    contextWindow: knownModelLimit(m.contextWindow),
    maxTokens: knownModelLimit(m.maxTokens),
  })).sort(compareModelEntries);
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = getSupportedThinkingLevels(m);
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
  }

  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  const defaultThinkingLevel = settings.getDefaultThinkingLevel() ?? null;
  if (provider && modelId && visible.some((m) => m.provider === provider && m.id === modelId)) {
    defaultModel = { provider, modelId };
  }

  return { typedCatalog, catalogUnavailable: !!runtime.getError(), models: Object.fromEntries(nameMap), modelList, defaultModel, defaultThinkingLevel, thinkingLevels, thinkingLevelMaps };
}

const EMPTY_MODELS: ModelsData = {
  typedCatalog: [],
  catalogUnavailable: true,
  models: {},
  modelList: [],
  defaultModel: null,
  defaultThinkingLevel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
};

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  try {
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch (error) {
    return Response.json({ ...EMPTY_MODELS,
      ...(error instanceof ModelConfigurationError ? { catalogError: error.message } : {}),
    });
  }
}
