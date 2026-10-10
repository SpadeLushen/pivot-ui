import { NextResponse } from "next/server";
import { readToolsSnapshot } from "@/lib/tool-catalog";
import { getToolManagementSession } from "@/lib/rpc-manager";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { writeWorkspaceTool, ToolSettingsError, isToolSettingsError } from "@/lib/workspace-tools";
import { TOOL_EXPOSURES, type ToolExposure } from "@/lib/tool-settings-types";
import { readOrchestration, writeOrchestration } from "@/lib/tool-orchestration";
import { saveToolSettings, type ToolSettingsChanges } from "@/lib/tool-settings-save";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const toolError = isToolSettingsError(error) ? error : null;
  return NextResponse.json({ error: toolError?.message ?? (error instanceof PackWorkspaceAccessError ? error.message : "Unable to access workspace tools") },
    { status: toolError?.status ?? (error instanceof PackWorkspaceAccessError ? 403 : 500) });
}
async function snapshot(cwd: string, sessionId?: string) {
  const session = getToolManagementSession(cwd, sessionId);
  return readToolsSnapshot(cwd, session?.inner, session?.getToolApplicationState?.(readOrchestration(cwd)));
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams, cwd = params.get("cwd");
    if (!cwd) throw new ToolSettingsError("cwd required");
    const root = await requirePackWorkspace(cwd);
    return NextResponse.json(await snapshot(root, params.get("sessionId") ?? undefined));
  } catch (error) { return failure(error); }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.cwd !== "string") throw new ToolSettingsError("cwd required");
    const cwd = await requirePackWorkspace(body.cwd);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
    if (body.action === "save") {
      const changes: ToolSettingsChanges = { target: body.target, revision: body.revision,
        orchestrationRevision: body.orchestrationRevision, tools: body.tools, codemode: body.codemode };
      await saveToolSettings(cwd, changes, async () => {
        const current = await snapshot(cwd, sessionId);
        for (const [name, patch] of Object.entries(changes.tools)) {
          const tool = current.tools.find(item => item.name === name);
          if (!tool) throw new ToolSettingsError("Tool is not registered in this workspace", 404);
          if (tool.ownerHidden && (patch.enabled === true || (patch.exposure != null && patch.exposure !== "hidden"))) {
            throw new ToolSettingsError("This tool has been withdrawn by its owner", 409);
          }
        }
        if (changes.codemode && current.orchestration.nativeState !== "available") throw new ToolSettingsError("tools.nativeUnavailable", 409);
        return Object.fromEntries(current.tools.map(tool => [tool.name, tool.inherited.exposure]));
      });
      return NextResponse.json(await snapshot(cwd, sessionId));
    }
    if (body.action === "retry") {
      const session = getToolManagementSession(cwd, sessionId);
      if (!session) throw new ToolSettingsError("No live session selected", 409);
      try { await session.refreshWorkspaceTools(); }
      catch { throw new ToolSettingsError("tools.applyFailed", 409); }
      return NextResponse.json(await snapshot(cwd, sessionId));
    }
    if (body.action === "orchestration") {
      if (typeof body.revision !== "string") throw new ToolSettingsError("Orchestration revision required");
      await writeOrchestration(cwd, body.revision,
        body.reset === true ? { reset: true } : { mode: body.mode, inlineBudget: body.inlineBudget }, async () => {
          const current = await snapshot(cwd, sessionId);
          if (current.orchestration.nativeState !== "available") throw new ToolSettingsError("tools.nativeUnavailable", 409);
        });
      return NextResponse.json(await snapshot(cwd, sessionId));
    }
    if (body.action !== undefined) throw new ToolSettingsError("Unknown tool settings action");
    if (typeof body.name !== "string" || typeof body.revision !== "string" ||
        typeof body.enabled !== "boolean" || !TOOL_EXPOSURES.includes(body.exposure)) throw new ToolSettingsError("cwd, tool name, revision, enabled and exposure are required");
    const current = await snapshot(cwd, sessionId);
    const tool = current.tools.find((item) => item.name === body.name);
    if (!tool) throw new ToolSettingsError("Tool is not registered in this workspace", 404);
    if (tool.ownerHidden && (body.enabled || body.exposure !== "hidden")) throw new ToolSettingsError("This tool has been withdrawn by its owner", 409);
    await writeWorkspaceTool(cwd, body.revision, body.name, { enabled: body.enabled, exposure: body.exposure as ToolExposure },
      Object.fromEntries(current.tools.map(item => [item.name, item.inherited.exposure])));
    return NextResponse.json(await snapshot(cwd, sessionId));
  } catch (error) { return failure(error); }
}
