import { NextResponse } from "next/server";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { reconcileWorkspacePackMcp } from "@/lib/workspace-pack-mcp-sync";
import { getWorkspacePackApplication } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// Workspace activation/catch-up is an explicit write entry point. GETs remain read-only.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown } | null;
    if (!body || typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const cwd = await requirePackWorkspace(body.cwd.trim());
    const result = await reconcileWorkspacePackMcp(cwd);
    return NextResponse.json({ ...result, application: getWorkspacePackApplication(cwd) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: error instanceof PackWorkspaceAccessError ? 403 : 409 });
  }
}
