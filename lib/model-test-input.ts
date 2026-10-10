import type { ClassifierContext, ClassifierQuestion, Usage } from "@earendil-works/pi-ai";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4000;

/** Validate before resolving auth or issuing any billable request. */
export function classifierTestInput(value: unknown): ClassifierContext | null {
  if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.questions) || value.images !== undefined) return null;
  const entries = Object.entries(value.questions);
  if (!entries.length || entries.length > 16 || JSON.stringify(value).length > 65536) return null;
  for (const [key, question] of entries) {
    if (!key || key.length > 128 || !isRecord(question) || !text(question.instructions)) return null;
    if (question.type === "score") {
      if (!Array.isArray(question.criteria) || !question.criteria.length || question.criteria.length > 16 || !question.criteria.every(text)) return null;
    } else if (question.type === "choice" || question.type === "bool") {
      if (!isRecord(question.criteria)) return null;
      const criteria = Object.entries(question.criteria);
      if (!criteria.length || criteria.length > 16 || !criteria.every(([k, v]) => text(k) && text(v))) return null;
      if (question.type === "bool" && (criteria.length !== 2 || !text(question.criteria.true) || !text(question.criteria.false))) return null;
    } else return null;
  }
  return { state: value.state as ClassifierContext["state"], questions: value.questions as Record<string, ClassifierQuestion> };
}

/** Whitelist numeric usage fields; never return the provider response object. */
export function modelTestUsage(usage?: Usage) {
  if (!usage) return undefined;
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    input: numeric(usage.input), output: numeric(usage.output),
    cacheRead: numeric(usage.cacheRead), cacheWrite: numeric(usage.cacheWrite),
    cost: usage.cost ? {
      input: numeric(usage.cost.input), output: numeric(usage.cost.output),
      cacheRead: numeric(usage.cost.cacheRead), cacheWrite: numeric(usage.cost.cacheWrite),
      total: numeric(usage.cost.total),
    } : undefined,
  };
}
