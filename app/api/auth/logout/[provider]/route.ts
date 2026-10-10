import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOAuthProviders } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { deleteStoredCredential } from "@/lib/auth-store";
import { cancelProviderLogin } from "@/lib/provider-login";
import { notifyMcpConfigurationChanged } from "@/lib/session-resource-events";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const runtime = await ModelRuntime.create();
  const oauthProviders = getOAuthProviders(runtime);
  if (!oauthProviders.some((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  cancelProviderLogin(provider);
  await deleteStoredCredential(provider, "oauth");
  invalidateModelsCache();
  notifyMcpConfigurationChanged();
  return Response.json({ ok: true });
}
