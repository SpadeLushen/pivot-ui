import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const runtime = await ModelRuntime.create();
  const oauthProviders = runtime.getProviders().filter((p) => p.auth.oauth);
  if (!oauthProviders.some((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await runtime.logout(provider);
  invalidateModelsCache();
  return Response.json({ ok: true });
}
