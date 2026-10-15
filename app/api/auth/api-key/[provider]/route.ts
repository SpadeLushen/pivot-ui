import { createPivotModelRuntime, LEGACY_AZURE_PROVIDER } from "@/lib/model-runtime";
import { NextResponse } from "next/server";
import { getAuthStore, deleteStoredCredential } from "@/lib/auth-store";
import { cancelProviderLogin } from "@/lib/provider-login";
import { notifyMcpConfigurationChanged } from "@/lib/session-resource-events";
import { invalidateModelsCache } from "@/lib/models-cache";
import { refreshModelCatalog } from "@/lib/model-catalog-refresh";
import { modelTypeCounts } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const runtime = await createPivotModelRuntime({}, provider === LEGACY_AZURE_PROVIDER);
  const status = runtime.getProviderAuthStatus(provider);
  const displayName = runtime.getProvider(provider)?.name ?? provider;
  const modelCounts = modelTypeCounts(runtime, provider);
  const models = Object.values(modelCounts).reduce((sum, count) => sum + count, 0);
  const storedType = (await runtime.listCredentials()).find((credential) => credential.providerId === provider)?.type;
  return NextResponse.json({ provider, displayName, configured: status.configured && !runtime.isUsingOAuth(provider), source: status.source, models, modelCounts, storedType });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey, replaceOAuth } = await req.json() as { apiKey?: string; replaceOAuth?: boolean };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const authStore = getAuthStore();
    await authStore.modify(provider, async (current) => {
      if (current?.type === "oauth" && replaceOAuth !== true) throw new Error("auth.replaceOAuth");
      cancelProviderLogin(provider);
      return current?.type === "api_key" ? { ...current, key: apiKey.trim() } : { type: "api_key", key: apiKey.trim() };
    });
    invalidateModelsCache();
    notifyMcpConfigurationChanged();
    if (provider === "openrouter") void refreshModelCatalog(provider).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    const conflict = error instanceof Error && error.message === "auth.replaceOAuth";
    return NextResponse.json({ error: conflict ? "auth.replaceOAuth" : "auth.credentialsWriteFailed" }, { status: conflict ? 409 : 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    if ((await getAuthStore().read(provider))?.type === "api_key") cancelProviderLogin(provider);
    await deleteStoredCredential(provider, "api_key");
    invalidateModelsCache();
    notifyMcpConfigurationChanged();
    if (provider === "openrouter") void refreshModelCatalog(provider).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "auth.credentialsWriteFailed" }, { status: 500 });
  }
}
