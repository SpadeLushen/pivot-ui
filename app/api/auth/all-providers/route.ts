import { createPivotModelRuntime } from "@/lib/model-runtime";
import { modelTypeCounts, type ModelTypeCounts } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await createPivotModelRuntime();
  const credentials = new Map((await runtime.listCredentials()).map((c) => [c.providerId, c.type]));

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
    modelCounts: ModelTypeCounts;
    storedType?: "api_key" | "oauth";
  }[] = [];

  for (const provider of runtime.getProviders()) {
    if (!provider.auth.apiKey?.login) continue;
    const status = runtime.getProviderAuthStatus(provider.id);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const displayName = provider.name;
    const modelCounts = modelTypeCounts(runtime, provider.id);
    const modelCount = Object.values(modelCounts).reduce((sum, count) => sum + count, 0);
    result.push({
      id: provider.id,
      displayName,
      configured: status.configured && !runtime.isUsingOAuth(provider.id),
      source: status.source,
      modelCount,
      modelCounts,
      storedType: credentials.get(provider.id),
    });
  }

  return Response.json({ providers: result });
}
