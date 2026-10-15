import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { refreshModelCatalog } from "@/lib/model-catalog-refresh";

export const dynamic = "force-dynamic";

/** Explicit discovery only: no AgentSession, model invocation or MCP connection. */
export async function POST(req: Request) {
  const failure = (code: string, status: number) => NextResponse.json({ ok: false, error: `models.${code}` }, { status });
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || !("provider" in body) || typeof body.provider !== "string"
      || !body.provider.trim() || body.provider.length > 256) return failure("refreshInvalidProvider", 400);
    const input = body as { provider: string; cwd?: unknown; automatic?: unknown };
    if (input.cwd !== undefined && typeof input.cwd !== "string") return failure("refreshInvalidProvider", 400);
    const cwd = resolve(typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd());
    if (!(await stat(cwd)).isDirectory()) return failure("refreshInvalidProvider", 400);
    const result = await refreshModelCatalog(input.provider.trim(), {
      cwd, signal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]), force: input.automatic !== true,
    });
    return NextResponse.json(result, { status: result.status });
  } catch {
    return failure(req.signal.aborted ? "refreshCancelled" : "refreshFailed", req.signal.aborted ? 408 : 500);
  }
}
