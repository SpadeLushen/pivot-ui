import { NextResponse } from "next/server";
import { isWorkspacePlanBlocked, isWorkspaceRevisionConflict } from "@/lib/skill-pack-apply";
import { applyWorkspacePackSwitch } from "@/lib/workspace-pack-switch";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { notifyWorkspacePacks } from "@/lib/workspace-pack-events";
import { isMcpConfigUnavailable, mcpConfigUnavailableResponse } from "@/lib/mcp-config-phase";
import { ensureLibraryRoot, readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";

export const dynamic = "force-dynamic";

// POST /api/workspace-skill-packs/apply
// body: { cwd: string; packIds: string[]; workspaceRevision: number }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      cwd?: string;
      packIds?: string[];
      workspaceRevision?: number;
    };
    const cwd = body.cwd?.trim();
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const workspace = await requirePackWorkspace(cwd);
    const config = ensureLibraryRoot(readConfig());
    const libraryRoot = resolveLibraryRoot(config);
    if (!libraryRoot) return NextResponse.json({ error: "skill library not configured" }, { status: 400 });
    const packIds = Array.isArray(body.packIds) ? body.packIds : [];
    if (!Array.isArray(body.packIds) || packIds.some((id) => typeof id !== "string" || !id.trim()) || typeof body.workspaceRevision !== "number" || !Number.isInteger(body.workspaceRevision) || body.workspaceRevision < 0) {
      return NextResponse.json({ error: "packIds and workspaceRevision required" }, { status: 400 });
    }
    const result = await applyWorkspacePackSwitch(workspace, libraryRoot, packIds, body.workspaceRevision, config);
    notifyWorkspacePacks(workspace);
    return NextResponse.json({ success: true, installed: result.installed, skipped: result.plan.skipped, workspaceRevision: result.plan.workspaceRevision + 1 });
  } catch (e: unknown) {
    if (isMcpConfigUnavailable(e)) return mcpConfigUnavailableResponse(e.message);
    if (e instanceof PackWorkspaceAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (isWorkspaceRevisionConflict(e)) {
      return NextResponse.json({ error: e.message, workspaceRevision: e.revision }, { status: 409 });
    }
    if (isWorkspacePlanBlocked(e)) {
      return NextResponse.json({ error: e.message, plan: e.plan }, { status: 409 });
    }
    const err = e as { message?: string };
    return NextResponse.json({ error: err.message || String(e) }, { status: 500 });
  }
}
