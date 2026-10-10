import type { ContextUsage } from "./pi-types";

export function usableContextUsage(usage: ContextUsage | null | undefined): boolean {
  return !!usage && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
    && usage.tokens !== null && Number.isFinite(usage.tokens) && usage.tokens >= 0
    && usage.percent !== null && Number.isFinite(usage.percent) && usage.percent >= 0;
}

export function preferredContextUsage(primary: ContextUsage | null | undefined,
  fallback: ContextUsage | null | undefined): ContextUsage | null {
  if (primary && usableContextUsage(primary)) return primary;
  if (fallback && usableContextUsage(fallback)) return fallback;
  return primary?.contextWindow ? primary : fallback?.contextWindow ? fallback : null;
}
