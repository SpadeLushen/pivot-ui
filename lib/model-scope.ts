import { resolveModelScopeWithDiagnostics, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { trackModelCatalogRefresh, type ModelScopeDiagnosticDto } from "./models-cache";

import { piSdkModule } from "./pi-sdk-module";

type ModelResolver = {
  findInitialModel(options: { modelRuntime: ModelRuntime; scopedModels: []; isContinuing: false }):
    Promise<{ model?: { provider: string; id: string } }>;
};

/** Same provider defaults as session creation, from the local SDK catalog (no network or AgentSession). */
export async function sdkInitialModel(modelRuntime: ModelRuntime) {
  const resolver = piSdkModule<ModelResolver>("core/model-resolver.js");
  return (await resolver.findInitialModel({ modelRuntime, scopedModels: [], isContinuing: false })).model;
}

/** Resolve only during a cached load. Auth availability refresh is cancellable and bounded. */
export async function resolveEnabledModels(runtime: ModelRuntime, patterns: string[] | undefined) {
  const snapshot = runtime.getAvailableSnapshot();
  const diagnostics: ModelScopeDiagnosticDto[] = [];
  if (!patterns?.length) return { models: snapshot, diagnostics, scoped: false };
  const controller = new AbortController();
  const untrack = trackModelCatalogRefresh(controller);
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      resolveModelScopeWithDiagnostics(patterns, runtime, { signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("Model scope resolution cancelled"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    diagnostics.push(...result.diagnostics.map(({ code, pattern }) => ({ code, pattern })));
    const models = result.scopedModels.map(({ model }) => model);
    if (models.length) return { models, diagnostics, scoped: true };
    diagnostics.push({ code: "fallback", pattern: "" });
    return { models: runtime.getAvailableSnapshot(), diagnostics, scoped: false };
  } catch {
    // Never return SDK error text: availability failures can contain credential diagnostics.
    return { models: snapshot, scoped: false, diagnostics: [{ code: "unavailable", pattern: "" }] as ModelScopeDiagnosticDto[] };
  } finally {
    clearTimeout(timeout);
    untrack();
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
