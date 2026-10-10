import { NextResponse } from "next/server";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { notifyMcpConfigurationChanged } from "@/lib/session-resource-events";

export const dynamic = "force-dynamic";

// Only an explicit confirmation grants trust to this exact workspace, not its parent.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; trusted?: unknown } | null;
    if (!body || typeof body.cwd !== "string" || !body.cwd.trim() || body.trusted !== true) {
      return NextResponse.json({ error: "cwd and explicit workspace trust confirmation required" }, { status: 400 });
    }
    const cwd = await requirePackWorkspace(body.cwd.trim());
    new ProjectTrustStore(getAgentDir()).set(cwd, true);
    // Same-cwd sessions reload at idle boundaries, including when the Pack retry fails.
    notifyMcpConfigurationChanged(cwd);
    return NextResponse.json({ cwd, trusted: true });
  } catch (error) {
    if (error instanceof PackWorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "Unable to save workspace trust" }, { status: 500 });
  }
}
