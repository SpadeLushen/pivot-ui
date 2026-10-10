import { NextResponse } from "next/server";
import { editNativeMcpServer, readNativeMcpEditor, setNativeMcpWorkspaceEnabled, NativeMcpEditorError, type NativeMcpEdit } from "@/lib/native-mcp-editor";
import { PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import type { NativeMcpScope } from "@/lib/api-types";

export const dynamic = "force-dynamic";
function scope(value: unknown): NativeMcpScope {
  if (value === undefined || value === null || value === "project") return "project";
  if (value === "global") return "global";
  throw new NativeMcpEditorError("Scope must be global or project");
}
function failure(error: unknown) {
  const expected = error instanceof NativeMcpEditorError || error instanceof PackWorkspaceAccessError;
  return NextResponse.json({ error: expected ? error.message : "Unable to access native MCP configuration" }, {
    status: error instanceof NativeMcpEditorError ? error.status : error instanceof PackWorkspaceAccessError ? 403 : 500,
  });
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    return NextResponse.json(await readNativeMcpEditor(scope(params.get("scope")), params.get("cwd") ?? undefined));
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) { return change(req, "create"); }
export async function PATCH(req: Request) { return change(req, "update"); }
export async function DELETE(req: Request) { return change(req, "delete"); }

async function change(req: Request, action: "create" | "update" | "delete") {
  try {
    let body: Partial<NativeMcpEdit> & { enabled?: boolean };
    try { body = await req.json(); } catch { throw new NativeMcpEditorError("Invalid JSON request"); }
    if (!body || typeof body !== "object" || typeof body.serverKey !== "string" || typeof body.revision !== "string") {
      throw new NativeMcpEditorError("serverKey and configuration revision are required");
    }
    if (body.cwd !== undefined && typeof body.cwd !== "string") throw new NativeMcpEditorError("cwd must be a string");
    if (body.enabled !== undefined) {
      if (action !== "update" || typeof body.enabled !== "boolean") throw new NativeMcpEditorError("Workspace enabled state must be boolean");
      return NextResponse.json(await setNativeMcpWorkspaceEnabled({ ...body, scope: scope(body.scope) } as NativeMcpEdit, body.enabled));
    }
    return NextResponse.json(await editNativeMcpServer(action, { ...body, scope: scope(body.scope) } as NativeMcpEdit));
  } catch (error) { return failure(error); }
}
