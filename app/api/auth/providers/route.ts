import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getOAuthProviders } from "@/lib/model-runtime";
import { getAuthStore } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await ModelRuntime.create();
  const oauthProviders = getOAuthProviders(runtime);

  const authStore = getAuthStore();
  const result = await Promise.all(
    oauthProviders.map(async (p) => {
      const credential = await authStore.read(p.id);
      const method = p.auth.oauth!;
      return {
        id: p.id,
        name: p.id === "openai-codex" ? p.name : method.name,
        loginLabel: method.loginLabel ?? (p.id === "openai-codex" ? p.name : method.name),
        loggedIn: credential?.type === "oauth",
        storedType: credential?.type,
        supportsApiKey: !!p.auth.apiKey,
      };
    })
  );

  return Response.json({ providers: result });
}
