import type { SessionStatsInfo } from "./pi-types";

/** Recorded values only: no repricing, reasoning or nested-call additions. */
export interface RecordedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  reasoning?: number;
  cost?: { total?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}
export type UsageCategory = "chat" | "tools" | "other";
export interface UsageSummary {
  records: number;
  costRecords: number;
  missingCostRecords: number;
  tokens: SessionStatsInfo["tokens"];
  cost: number;
}
export interface ModelUsageSummary extends UsageSummary {
  provider: string | null;
  model: string | null;
}
export interface UsageScope extends UsageSummary {
  /** Actual recorded identity only; null means aggregate usage cannot be allocated. */
  models: ModelUsageSummary[];
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  categories: Record<UsageCategory, UsageSummary>;
}
export interface SessionAccounting {
  full: UsageScope;
  branch: UsageScope;
  leafId: string | null;
  source: "sdk" | "history";
}
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
export function recordedCost(usage?: RecordedUsage): number | null {
  const cost = usage?.cost?.total;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}
function emptyUsage(): UsageSummary {
  return { records: 0, costRecords: 0, missingCostRecords: 0, cost: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
function addUsage(summary: UsageSummary, usage?: RecordedUsage) {
  summary.records++;
  const cost = recordedCost(usage);
  if (cost === null) summary.missingCostRecords++;
  else { summary.costRecords++; summary.cost += cost; }
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    summary.tokens[key] += amount(usage?.[key]);
  }
  summary.tokens.total = summary.tokens.input + summary.tokens.output + summary.tokens.cacheRead + summary.tokens.cacheWrite;
}
export function summarizeUsage(usage?: RecordedUsage): UsageSummary {
  const summary = emptyUsage();
  addUsage(summary, usage);
  return summary;
}

/** Matches SDK entry accounting; a parent's usage already includes its children. */
export function aggregateSessionUsage(entries: readonly unknown[]): UsageScope {
  const result: UsageScope = { ...emptyUsage(), userMessages: 0, assistantMessages: 0,
    toolCalls: 0, toolResults: 0, totalMessages: 0,
    categories: { chat: emptyUsage(), tools: emptyUsage(), other: emptyUsage() }, models: [] };
  const models = new Map<string, ModelUsageSummary>();
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = raw as { id?: string; type: string; usage?: RecordedUsage; provider?: string; model?: string;
      message?: { role: string; api?: string; provider?: string; model?: string; content?: { type: string }[]; usage?: RecordedUsage } };
    if (entry.id && seen.has(entry.id)) continue;
    if (entry.id) seen.add(entry.id);
    let category: UsageCategory | null = null;
    let usage = entry.usage;
    if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") category = "other";
    if (entry.type === "message" && entry.message) {
      result.totalMessages++;
      const message = entry.message;
      usage = message.usage;
      if (message.role === "user") result.userMessages++;
      if (message.role === "toolResult") {
        result.toolResults++;
        // Ordinary tools need not make a model call; absence is not missing billing.
        if (usage) category = "tools";
      }
      if (message.role === "assistant") {
        result.assistantMessages++;
        category = "chat";
        if (Array.isArray(message.content)) result.toolCalls += message.content.filter(block => block.type === "toolCall").length;
      }
    }
    if (category) {
      addUsage(result, usage);
      addUsage(result.categories[category], usage);
      // Tool/summary totals may include several models: never attribute the parent to the router.
      const identity = category === "chat" && entry.message?.api !== "pi-virtual" ? entry.message
        : entry.type === "usage" ? entry : undefined;
      const provider = typeof identity?.provider === "string" && identity.provider ? identity.provider : null;
      const model = typeof identity?.model === "string" && identity.model ? identity.model : null;
      const allocated = provider !== null && model !== null;
      const key = JSON.stringify(allocated ? [provider, model] : [null, null]);
      let group = models.get(key);
      if (!group) {
        group = { ...emptyUsage(), provider: allocated ? provider : null, model: allocated ? model : null };
        models.set(key, group);
      }
      addUsage(group, usage);
    }
  }
  result.models = [...models.values()].sort((a, b) =>
    (a.provider === b.provider ? 0 : a.provider === null ? 1 : b.provider === null ? -1 : a.provider.localeCompare(b.provider))
    || (a.model ?? "").localeCompare(b.model ?? ""));
  return result;
}
