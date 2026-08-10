import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getAuthStore } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await ModelRuntime.create();
  const oauthProviders = runtime.getProviders().filter((p) => p.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const authStore = getAuthStore();
  const result = await Promise.all(
    oauthProviders
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        const credential = await authStore.read(p.id);
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: false,
          loggedIn: credential !== undefined,
        };
      })
  );

  return Response.json({ providers: result });
}
