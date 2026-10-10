import { NextResponse } from "next/server";
import { requirePackWorkspace, PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import { readBuiltinSnapshot } from "@/lib/builtin-extension-snapshot";
import { writeBuiltinSetting } from "@/lib/builtin-extension-settings";
import { isToolSettingsError } from "@/lib/workspace-tools";
import { getToolManagementSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const status = isToolSettingsError(error) ? error.status : error instanceof PackWorkspaceAccessError ? 403 : 500;
  return NextResponse.json({ error: isToolSettingsError(error) ? error.message : "plugins.builtinRequestFailed" }, { status });
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const requested = params.get("cwd");
    if (!requested) return NextResponse.json({ error: "plugins.builtinInvalid" }, { status: 400 });
    const cwd = await requirePackWorkspace(requested);
    return NextResponse.json(await readBuiltinSnapshot(cwd, params.get("sessionId") ?? undefined));
  } catch (error) { return failure(error); }
}
export async function PATCH(req: Request) {
  try {
    const input = await req.json();
    if (!input || typeof input.cwd !== "string") return NextResponse.json({ error: "plugins.builtinInvalid" }, { status: 400 });
    const cwd = await requirePackWorkspace(input.cwd);
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : undefined;
    if (input.action === "retry") {
      const session = getToolManagementSession(cwd, sessionId);
      if (!session) return NextResponse.json({ error: "plugins.builtinNoSession" }, { status: 409 });
      try { await session.refreshWorkspaceTools(); }
      catch { return NextResponse.json({ error: "plugins.builtinApplyFailed" }, { status: 409 }); }
    } else if (input.action === "save") {
      await writeBuiltinSetting(cwd, input);
    } else return NextResponse.json({ error: "plugins.builtinInvalid" }, { status: 400 });
    return NextResponse.json(await readBuiltinSnapshot(cwd, sessionId));
  } catch (error) { return failure(error); }
}
