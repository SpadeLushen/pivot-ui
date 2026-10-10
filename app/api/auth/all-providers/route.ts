import { createPivotModelRuntime } from "@/lib/model-runtime";
import { getAuthStore } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await createPivotModelRuntime();
  const all = runtime.getModels();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
    storedType?: "api_key" | "oauth";
  }[] = [];

  for (const m of all) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    const provider = runtime.getProvider(m.provider);
    if (!provider?.auth.apiKey?.login) continue;
    const status = runtime.getProviderAuthStatus(m.provider);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const displayName = provider.name;
    const credential = await getAuthStore().read(m.provider);
    const modelCount = all.filter((x) => x.provider === m.provider).length;
    result.push({
      id: m.provider,
      displayName,
      configured: status.configured && !runtime.isUsingOAuth(m.provider),
      source: status.source,
      modelCount,
      storedType: credential?.type,
    });
  }

  return Response.json({ providers: result });
}
