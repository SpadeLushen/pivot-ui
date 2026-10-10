import { buildSessionProjection, calculateContextTokens, estimateTokens, getAgentDir,
  type SessionManager } from "@earendil-works/pi-coding-agent";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSessionLike, ContextUsage } from "./pi-types";
import { branchModelSelection } from "./session-models";
import { knownModelLimit } from "./response-model";
import type { SessionEntry } from "./types";

/** Pure, branch-scoped projection: no session runtime, resource loading or model requests. */
export async function offlineContextUsage(sm: SessionManager, leafId: string | null,
  live?: AgentSessionLike, windowHint?: number): Promise<ContextUsage | undefined> {
  const branch = leafId ? sm.getBranch(leafId) : [];
  const projection = buildSessionProjection(sm.getEntries(), leafId);
  const selection = branchModelSelection(branch as SessionEntry[], leafId);
  const ref = selection.selectedModel?.virtual ? selection.routedModel : selection.selectedModel;
  const sameLeaf = leafId === sm.getLeafId();
  let contextWindow = knownModelLimit(windowHint);
  if (!contextWindow && sameLeaf && live) {
    contextWindow = knownModelLimit((live.routedModel?.model ?? live.model)?.contextWindow);
  }
  if (!contextWindow && ref) contextWindow = await modelContextWindow(ref.provider, ref.modelId);
  if (!contextWindow) return undefined;
  const tokens = projectedTokens(projection, branch);
  return { tokens, contextWindow, percent: tokens / contextWindow * 100 };
}

function projectedTokens(projection: ReturnType<typeof buildSessionProjection>,
  branch: ReturnType<SessionManager["getBranch"]>): number {
  let invalidation = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction" || branch[i].type === "context_edit") {
      invalidation = i;
      break;
    }
  }
  const indexes = new Map(branch.map((entry, index) => [entry.id, index]));
  const messages = projection.entries.flatMap(entry => entry.messages.map(message => ({ message,
    index: indexes.get(entry.sourceEntry.id) ?? -1 })));
  let tokens = 0;
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const { message, index } = messages[i];
    if (index <= invalidation || message.role !== "assistant" || message.stopReason === "error"
      || message.stopReason === "aborted" || !message.usage) continue;
    const usageTokens = calculateContextTokens(message.usage);
    if (!Number.isFinite(usageTokens) || usageTokens <= 0) continue;
    tokens = usageTokens;
    start = i + 1;
    break;
  }
  if (start === 0) {
    const system = getCurrentSystemMessage(projection.messages);
    tokens = system ? estimateTokens(system) : 0;
  }
  for (let i = start; i < messages.length; i++) {
    if (start === 0 && messages[i].message.role === "system") continue;
    tokens += estimateTokens(messages[i].message);
  }
  return tokens;
}

async function modelContextWindow(provider: string, modelId: string): Promise<number | null> {
  // Read metadata only; never resolve configured credential commands.
  try {
    const config = JSON.parse(await readFile(join(getAgentDir(), "models.json"), "utf8"));
    const savedProvider = config.providers?.[provider];
    const saved = savedProvider?.models?.find((model: { id: string; type?: string }) =>
      model.id === modelId && (!model.type || model.type === "chat"));
    const override = savedProvider?.modelOverrides?.[modelId];
    const window = knownModelLimit(override?.contextWindow ?? saved?.contextWindow);
    if (window) return window;
  } catch { /* A missing catalog must not make recorded statistics unavailable. */ }
  const builtin = getBuiltinProviders().find(id => id === provider);
  return builtin ? knownModelLimit(getBuiltinModels(builtin).find(model => model.id === modelId)?.contextWindow) : null;
}
