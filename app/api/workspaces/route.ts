import { parseWorkspacePatch, readWorkspaces, updateWorkspaces } from "@/lib/workspace-store";
import type { WorkspacePatch } from "@/lib/workspace-registry";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    return Response.json(await readWorkspaces(), noStore);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let patch: WorkspacePatch;
  try {
    patch = parseWorkspacePatch(await request.json());
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
  try {
    // Metadata only: this never grants filesystem access or deletes sessions.
    return Response.json(await updateWorkspaces([patch]), noStore);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
