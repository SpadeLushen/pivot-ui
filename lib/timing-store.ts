// Transient, tab-scoped timings. Each finished duration is one bounded record;
// active start times are deliberately never persisted.
const PREFIX = "pivot-timing:v1:";
const ORDER_KEY = `${PREFIX}order`;
export const MAX_TIMING_RECORDS = 1000;

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}

export function readTiming(key: string): number | undefined {
  const store = storage();
  if (!store) return undefined;
  try {
    const value = store.getItem(PREFIX + key);
    if (value === null) return undefined;
    const ms = Number(value);
    return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  } catch { return undefined; }
}

export function saveTiming(key: string, ms: number): void {
  saveTimings([[key, ms]]);
}

// Flush a completed turn as one batch; the order index and eviction are
// updated once, regardless of how many tools/thinking blocks it contained.
export function saveTimings(records: Iterable<readonly [string, number]>): void {
  const store = storage();
  if (!store) return;
  const entries = [...records].filter(([, ms]) => Number.isFinite(ms) && ms >= 0);
  if (entries.length === 0) return;
  try {
    const raw = store.getItem(ORDER_KEY);
    let parsed: unknown;
    try { parsed = raw ? JSON.parse(raw) : []; } catch { parsed = null; }
    // Recover an invalid index from actual storage entries instead of losing
    // track of old records (which would silently defeat the global cap).
    const recovered: string[] = [];
    if (!Array.isArray(parsed)) {
      for (let i = 0; i < store.length; i++) {
        const item = store.key(i);
        if (item?.startsWith(PREFIX) && item !== ORDER_KEY) recovered.push(item);
      }
    }
    const incoming = new Map(entries.map(([key, ms]) => [PREFIX + key, ms]));
    const order = (Array.isArray(parsed) ? parsed : recovered)
      .filter((item): item is string => typeof item === "string" && item.startsWith(PREFIX) && item !== ORDER_KEY && !incoming.has(item));
    order.push(...incoming.keys());
    // Evict before writing, so a full quota cannot prevent cleanup.
    while (order.length > MAX_TIMING_RECORDS) store.removeItem(order.shift()!);
    const retained = new Set(order);
    for (const [key, ms] of incoming) if (retained.has(key)) store.setItem(key, String(ms));
    store.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // Private browsing, quota errors, and disabled storage must not break chat.
  }
}

export function assistantTimingId(message: { timestamp?: number; provider?: string; model?: string; content?: unknown }): string {
  // A completed message's content distinguishes turns even when two provider
  // messages have the same millisecond timestamp. No session transcript is stored.
  const blocks = Array.isArray(message.content) ? message.content.map((block: { type?: string; text?: string; toolCallId?: string }) => (
    block.type === "thinking" ? "thinking" : block.type === "toolCall" ? ["toolCall", block.toolCallId] : [block.type, block.text]
  )) : [];
  const source = JSON.stringify([message.timestamp, message.provider, message.model, blocks]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${message.timestamp ?? "unknown"}:${(hash >>> 0).toString(36)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  return ms < 60_000 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

export function formatDisplayedElapsed(ms: number | undefined, running: boolean): string | undefined {
  if (ms === undefined || (running && ms < 1000)) return undefined;
  return formatElapsed(ms);
}

export function appendElapsedToUsage(usage: string, exact?: number, estimate?: number): string {
  const elapsed = exact !== undefined ? formatElapsed(exact)
    : estimate !== undefined ? formatElapsed(estimate) : "";
  return [usage, elapsed].filter(Boolean).join(" · ");
}
