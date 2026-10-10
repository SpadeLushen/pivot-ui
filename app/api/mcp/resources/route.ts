import { NativeMcpManagementError, readMcpResources } from "@/lib/native-mcp-management";
import { PackWorkspaceAccessError } from "@/lib/workspace-pack-access";

export const dynamic = "force-dynamic";

// Explicit Tools management inspection only: no model tool execution or AgentSession creation.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; serverKey?: unknown; resourcesCursor?: unknown; templatesCursor?: unknown; statusOnly?: unknown } | null;
    if (!body || typeof body.cwd !== "string" || typeof body.serverKey !== "string" ||
      (body.statusOnly !== undefined && typeof body.statusOnly !== "boolean") ||
      [body.resourcesCursor, body.templatesCursor].some((cursor) => cursor !== undefined && (typeof cursor !== "string" || cursor.length > 8192))) {
      throw new NativeMcpManagementError("mcp.invalidRequest");
    }
    const result = await readMcpResources(body.cwd, body.serverKey, req.signal, {
      resources: body.resourcesCursor as string | undefined, templates: body.templatesCursor as string | undefined, statusOnly: body.statusOnly as boolean | undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: NativeMcpManagementError.is(error) ? error.message : "mcp.managementFailed" }, {
      status: NativeMcpManagementError.is(error) ? error.status : error instanceof PackWorkspaceAccessError ? 403 : 500,
    });
  }
}
