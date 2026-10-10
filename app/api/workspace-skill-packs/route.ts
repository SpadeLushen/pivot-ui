import { NextResponse } from "next/server";
import { ensureLibraryRoot, getPackById, readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";
import { readWorkspaceState, workspacePackStateExists } from "@/lib/workspace-packs";
import { isWorkspacePlanBlocked, isWorkspaceRevisionConflict } from "@/lib/skill-pack-apply";
import { applyWorkspacePackSwitch } from "@/lib/workspace-pack-switch";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { notifyWorkspacePacks } from "@/lib/workspace-pack-events";
import { isMcpConfigUnavailable, mcpConfigUnavailableResponse } from "@/lib/mcp-config-phase";
import type { WorkspaceSkillPacksResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

function readState(cwd: string): WorkspaceSkillPacksResponse {
  const config = readConfig();
  const ws = readWorkspaceState({ cwd });
  return {
    configured: workspacePackStateExists(cwd),
    revision: ws.revision,
    appliedPacks: ws.appliedPacks.map((p) => ({
      ...p,
      packName: getPackById(config, p.packId)?.name ?? p.packId,
    })),
    disabledPacks: ws.disabledPacks?.map((pack) => ({ ...pack, packName: getPackById(config, pack.packId)?.name ?? pack.packId })),
    skippedConflicts: ws.skippedConflicts,
  };
}

// GET /api/workspace-skill-packs?cwd=<path>
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  try {
    return NextResponse.json(readState(await requirePackWorkspace(cwd)));
  } catch (e) {
    if (e instanceof PackWorkspaceAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/workspace-skill-packs?cwd=<path>&packId=<id>
// Disables this Pack without deleting Skills or native server definitions.
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const packId = searchParams.get("packId");
  const workspaceRevision = Number(searchParams.get("workspaceRevision"));
  if (!cwd || !packId || !searchParams.has("workspaceRevision") || !Number.isInteger(workspaceRevision) || workspaceRevision < 0) {
    return NextResponse.json({ error: "cwd, packId, and workspaceRevision required" }, { status: 400 });
  }
  try {
    const workspace = await requirePackWorkspace(cwd);
    const config = ensureLibraryRoot(readConfig());
    const libraryRoot = resolveLibraryRoot(config);
    if (!libraryRoot) return NextResponse.json({ error: "skill library not configured" }, { status: 400 });
    const state = readWorkspaceState({ cwd: workspace });
    if (!state.appliedPacks.some((pack) => pack.packId === packId)) return NextResponse.json({ error: "pack not applied" }, { status: 404 });
    const targetPackIds = state.appliedPacks.filter((pack) => pack.packId !== packId).map((pack) => pack.packId);
    await applyWorkspacePackSwitch(workspace, libraryRoot, targetPackIds, workspaceRevision, config);
    notifyWorkspacePacks(workspace);
    return NextResponse.json(readState(workspace));
  } catch (e) {
    if (isMcpConfigUnavailable(e)) return mcpConfigUnavailableResponse(e.message);
    if (e instanceof PackWorkspaceAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (isWorkspaceRevisionConflict(e)) return NextResponse.json({ error: e.message, workspaceRevision: e.revision }, { status: 409 });
    if (isWorkspacePlanBlocked(e)) return NextResponse.json({ error: e.message, plan: e.plan }, { status: 409 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
