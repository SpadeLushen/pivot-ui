import { createPivotModelRuntime, getOAuthProviders } from "@/lib/model-runtime";
import { modelTypeCounts } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await createPivotModelRuntime();
  const oauthProviders = getOAuthProviders(runtime);

  const credentials = new Map((await runtime.listCredentials()).map((c) => [c.providerId, c.type]));
  const result = await Promise.all(
    oauthProviders.map(async (p) => {
      const storedType = credentials.get(p.id);
      const method = p.auth.oauth!;
      return {
        id: p.id,
        name: p.id === "openai-codex" ? p.name : method.name,
        loginLabel: method.loginLabel ?? (p.id === "openai-codex" ? p.name : method.name),
        loggedIn: storedType === "oauth",
        storedType,
        modelCounts: modelTypeCounts(runtime, p.id),
        supportsApiKey: !!p.auth.apiKey,
      };
    })
  );

  return Response.json({ providers: result });
}
