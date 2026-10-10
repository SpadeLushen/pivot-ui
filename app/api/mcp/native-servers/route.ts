import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { nativeMcpServerInfo } from "@/lib/native-mcp-config";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    return NextResponse.json(await nativeMcpServerInfo(cwd ? await requirePackWorkspace(cwd) : getAgentDir(), Boolean(cwd)));
  } catch (e) {
    if (!(e instanceof PackWorkspaceAccessError) && e instanceof Error) console.error("[pivot-ui] native configuration read failed", {
      name: e.name, code: "code" in e ? e.code : undefined,
      frames: e.stack?.split("\n").filter((line) => line.trim().startsWith("at ")),
    });
    return NextResponse.json({ error: e instanceof PackWorkspaceAccessError ? e.message : "Unable to read native MCP configuration" },
      { status: e instanceof PackWorkspaceAccessError ? 403 : 500 });
  }
}
