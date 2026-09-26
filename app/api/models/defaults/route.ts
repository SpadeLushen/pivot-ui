import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// Persist a selection made before a new session has been created.
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; provider?: string; modelId?: string; thinkingLevel?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return Response.json({ error: "cwd is required" }, { status: 400 });
    }
    const { settingsManager, modelRuntime } = await createAgentSessionServices({ cwd: body.cwd, agentDir: getAgentDir() });
    if (body.provider !== undefined || body.modelId !== undefined) {
      if (!body.provider || !body.modelId || !modelRuntime.getModel(body.provider, body.modelId)) {
        return Response.json({ error: "Invalid model" }, { status: 400 });
      }
      settingsManager.setDefaultModelAndProvider(body.provider, body.modelId);
    } else if (body.thinkingLevel && THINKING_LEVELS.has(body.thinkingLevel)) {
      settingsManager.setDefaultThinkingLevel(body.thinkingLevel as Parameters<typeof settingsManager.setDefaultThinkingLevel>[0]);
    } else {
      return Response.json({ error: "Invalid thinking level" }, { status: 400 });
    }
    await settingsManager.flush();
    const errors = settingsManager.drainErrors();
    if (errors.length) throw errors[0];
    invalidateModelsCache();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
