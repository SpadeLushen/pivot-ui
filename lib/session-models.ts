import { VIRTUAL_MODEL_STATE_ENTRY, type VirtualModelStateData } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";
import { successfulResponseModel, VIRTUAL_CHAT_API } from "./response-model";
export interface SelectedModel {
  provider: string;
  modelId: string;
  virtual?: boolean;
  contextWindow?: number | null;
  maxTokens?: number | null;
}
export interface RoutedModel extends SelectedModel {
  api?: string;
  thinkingLevel?: string;
}
export interface ModelPickerEntry {
  id: string;
  name: string;
  provider: string;
  virtual?: boolean;
  contextWindow?: number | null;
  maxTokens?: number | null;
}
export interface SessionModelSelection {
  selectedModel: SelectedModel | null;
  routedModel: RoutedModel | null;
  /** SDK-compatible physical fallback when a saved router is no longer registered. */
  legacyModel: SelectedModel | null;
}

/** Whole ancestor path, including compacted-away metadata; never creates a session runtime. */
export function branchModelSelection(entries: readonly SessionEntry[], leafId?: string | null): SessionModelSelection {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  let entry = leafId === null ? undefined : (leafId ? byId.get(leafId) : undefined) ?? entries.at(-1);
  let selectedModel: SelectedModel | null = null;
  let legacyModel: SelectedModel | null = null;
  let routedModel: RoutedModel | null = null;
  const virtualRefs = new Set<string>();
  const seen = new Set<string>();
  while (entry && !seen.has(entry.id)) {
    seen.add(entry.id);
    if (entry.type === "model_change") {
      const ref = { provider: entry.provider, modelId: entry.modelId };
      selectedModel ??= ref;
      legacyModel ??= ref;
    }
    if (entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY) {
      const data = entry.data as Partial<VirtualModelStateData> | undefined;
      if (data?.provider && data.modelId) virtualRefs.add(JSON.stringify([data.provider, data.modelId]));
    }
    if (entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message;
      if (message.api !== VIRTUAL_CHAT_API) legacyModel ??= { provider: message.provider, modelId: message.model };
      else virtualRefs.add(JSON.stringify([message.provider, message.model]));
      routedModel ??= successfulResponseModel(message);
    }
    entry = entry.parentId ? byId.get(entry.parentId) : undefined;
  }
  selectedModel ??= legacyModel;
  if (selectedModel && virtualRefs.has(JSON.stringify([selectedModel.provider, selectedModel.modelId]))) {
    selectedModel = { ...selectedModel, virtual: true };
  }
  return { selectedModel, routedModel, legacyModel };
}
