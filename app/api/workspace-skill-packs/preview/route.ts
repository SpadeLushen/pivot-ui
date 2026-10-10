import { NextResponse } from "next/server";
import { previewWorkspacePackSwitch } from "@/lib/workspace-pack-switch";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { isMcpConfigUnavailable, mcpConfigUnavailableResponse } from "@/lib/mcp-config-phase";
import { ensureLibraryRoot, readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";
import type { ApplyPreviewResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

// POST /api/workspace-skill-packs/preview
// body: { cwd: string; packIds: string[] }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { cwd?: string; packIds?: string[] };
    const cwd = body.cwd?.trim();
    const packIds = Array.isArray(body.packIds) ? body.packIds : [];
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!Array.isArray(body.packIds) || packIds.some((id) => typeof id !== "string" || !id.trim())) return NextResponse.json({ error: "packIds required" }, { status: 400 });
    const workspace = await requirePackWorkspace(cwd);
    const config = ensureLibraryRoot(readConfig());
    const libraryRoot = resolveLibraryRoot(config);
    if (!libraryRoot) return NextResponse.json({ error: "skill library not configured" }, { status: 400 });
    const plan = await previewWorkspacePackSwitch(workspace, libraryRoot, packIds, config);
    return NextResponse.json(plan as ApplyPreviewResponse);
  } catch (e) {
    if (isMcpConfigUnavailable(e)) return mcpConfigUnavailableResponse(e.message);
    if (e instanceof PackWorkspaceAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
