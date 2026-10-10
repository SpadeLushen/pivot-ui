import { NextResponse } from "next/server";
import { getAgentDir, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { notifyMcpConfigurationChanged } from "@/lib/session-resource-events";
import { nativeProjectTrusted } from "@/lib/native-mcp-runtime";

export const dynamic = "force-dynamic";

// Read effective trust without loading project resources or creating a session.
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd?.trim()) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  try {
    const root = await requirePackWorkspace(cwd.trim()), agentDir = getAgentDir();
    const settings = SettingsManager.create(root, agentDir, { projectTrusted: false });
    if (settings.drainErrors().length) throw new Error("Unable to read settings");
    return NextResponse.json({ cwd: root, trusted: nativeProjectTrusted(root, agentDir, settings) });
  } catch (error) {
    if (error instanceof PackWorkspaceAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "workspaceTrust.readFailed" }, { status: 500 });
  }
}

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
