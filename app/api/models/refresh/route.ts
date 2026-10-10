import { NextResponse } from "next/server";
import { createPivotAgentSessionServices } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { notifyResourceConfigurationChanged } from "@/lib/session-resource-events";

export const dynamic = "force-dynamic";

/** Explicit discovery only: never create a session or invoke a model. */
export async function POST(req: Request) {
  const controller = new AbortController();
  const signal = AbortSignal.any([req.signal, controller.signal]);
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const failure = (code: string, status: number) => NextResponse.json({ ok: false, error: `models.${code}` }, { status });
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || !("provider" in body) || typeof body.provider !== "string" || !body.provider.trim() || body.provider.length > 256) {
      return failure("refreshInvalidProvider", 400);
    }
    const providerId = body.provider.trim();
    const { modelRuntime: runtime } = await createPivotAgentSessionServices({ cwd: process.cwd(), modelRuntimeSignal: signal });
    signal.throwIfAborted();
    const provider = runtime.getProvider(providerId);
    if (!provider) return failure("refreshInvalidProvider", 404);
    if (!provider.refreshModels) return failure("refreshUnsupported", 501);
    if (runtime.getError()) return failure("refreshFailed", 409);
    if (!(await runtime.checkAuth(providerId, { signal }))) return failure("refreshNeedsAuth", 409);
    try {
      const result = await runtime.refresh({ allowNetwork: true, force: true, providers: [providerId], signal });
      if (result.aborted || signal.aborted) return failure("refreshCancelled", 408);
      if (result.errors.size) return failure("refreshFailed", 502);
      return NextResponse.json({ ok: true });
    } finally {
      // A partial publication can survive a later error. Clear stale snapshots
      // and let existing wrappers reload only through their idle resource queue.
      invalidateModelsCache();
      notifyResourceConfigurationChanged();
    }
  } catch {
    // SDK errors can contain credential responses; return no raw error details.
    return failure(signal.aborted ? "refreshCancelled" : "refreshFailed", signal.aborted ? 408 : 500);
  } finally { clearTimeout(timeout); }
}
