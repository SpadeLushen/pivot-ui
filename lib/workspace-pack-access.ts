import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";
import { canonicalWorkspace, workspaceFile } from "./workspace-pack-files";

export class PackWorkspaceAccessError extends Error {}
export async function requirePackWorkspace(cwd: string): Promise<string> {
  const root = canonicalWorkspace(cwd);
  const roots = new Set([...await getAllowedFileRoots()].map((allowed) => {
    try { return canonicalWorkspace(allowed); } catch { return allowed; }
  }));
  if (!isFilePathAllowed(root, roots)) throw new PackWorkspaceAccessError("Workspace is not allowed");
  for (const file of ["skill-packs.json", "settings.json", "mcp.json"]) workspaceFile(root, file);
  return root;
}
