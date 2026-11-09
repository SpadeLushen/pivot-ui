import { getAllowedFileRoots } from "./file-access";
import { readWorkspaces } from "./workspace-store";
import { requirePackWorkspace } from "./workspace-pack-access";
import { workspaceKey } from "./workspace-pack-files";
import { workspacePackStateExists } from "./workspace-packs";
import { reconcileWorkspacePackMcp } from "./workspace-pack-mcp-sync";

const jobs = globalThis as typeof globalThis & { __pivotPackMcpSweep?: Promise<void>; __pivotPackMcpSweepAgain?: boolean };
async function sync(cwd: string): Promise<void> {
  try {
    const workspace = await requirePackWorkspace(cwd);
    if (workspacePackStateExists(workspace)) await reconcileWorkspacePackMcp(workspace);
  }
  catch (error) { console.warn("[packs] MCP synchronization deferred", cwd, String(error)); }
}

/** Best-effort fan-out; one unavailable workspace never rolls back a saved definition. */
export function schedulePackMcpSync(cwd?: string): void {
  if (cwd) { void sync(cwd); return; }
  jobs.__pivotPackMcpSweepAgain = true;
  if (jobs.__pivotPackMcpSweep) return;
  jobs.__pivotPackMcpSweep = Promise.resolve().then(async () => {
    do {
      jobs.__pivotPackMcpSweepAgain = false;
      const roots = new Set(await getAllowedFileRoots());
      // Registry metadata discovers candidates, but never grants filesystem access.
      try { for (const workspace of (await readWorkspaces()).workspaces) roots.add(workspace.path); } catch { /* Known roots still work. */ }
      const seen = new Set<string>();
      for (const root of roots) {
        const key = workspaceKey(root);
        if (seen.has(key)) continue;
        seen.add(key);
        await sync(root);
      }
    } while (jobs.__pivotPackMcpSweepAgain);
  }).catch((error) => console.warn("[packs] MCP synchronization deferred", String(error)))
    .finally(() => { jobs.__pivotPackMcpSweep = undefined; });
}
