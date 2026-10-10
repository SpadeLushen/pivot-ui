import { NextResponse } from "next/server";
import { readToolsSnapshot } from "@/lib/tool-catalog";
import { getToolManagementSession } from "@/lib/rpc-manager";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { writeWorkspaceTool, ToolSettingsError } from "@/lib/workspace-tools";
import { TOOL_EXPOSURES, type ToolExposure } from "@/lib/tool-settings-types";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof ToolSettingsError || error instanceof PackWorkspaceAccessError ? error.message : "Unable to access workspace tools" },
    { status: error instanceof ToolSettingsError ? error.status : error instanceof PackWorkspaceAccessError ? 403 : 500 });
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams, cwd = params.get("cwd");
    if (!cwd) throw new ToolSettingsError("cwd required");
    const root = await requirePackWorkspace(cwd);
    return NextResponse.json(await readToolsSnapshot(root, getToolManagementSession(root, params.get("sessionId") ?? undefined)?.inner));
  } catch (error) { return failure(error); }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.cwd !== "string" || typeof body.name !== "string" || typeof body.revision !== "string" ||
        typeof body.enabled !== "boolean" || !TOOL_EXPOSURES.includes(body.exposure)) throw new ToolSettingsError("cwd, tool name, revision, enabled and exposure are required");
    const cwd = await requirePackWorkspace(body.cwd);
    const live = getToolManagementSession(cwd, typeof body.sessionId === "string" ? body.sessionId : undefined)?.inner;
    const snapshot = await readToolsSnapshot(cwd, live);
    const tool = snapshot.tools.find((item) => item.name === body.name);
    if (!tool) throw new ToolSettingsError("Tool is not registered in this workspace", 404);
    if (tool.ownerHidden && (body.enabled || body.exposure !== "hidden")) throw new ToolSettingsError("This tool has been withdrawn by its owner", 409);
    await writeWorkspaceTool(cwd, body.revision, body.name, { enabled: body.enabled, exposure: body.exposure as ToolExposure });
    return NextResponse.json(await readToolsSnapshot(cwd, live));
  } catch (error) { return failure(error); }
}
