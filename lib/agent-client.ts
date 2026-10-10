import type { InputReceipt } from "./pi-types";

/** Old servers returned null: unknown is not the same as handled. */
export function readInputReceipt(value: unknown): InputReceipt | null {
  if (value == null) return null;
  if (typeof value === "object" && "disposition" in value
    && (value.disposition === "started" || value.disposition === "queued" || value.disposition === "handled")) {
    return { disposition: value.disposition };
  }
  throw new Error("Invalid input receipt");
}

// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}
