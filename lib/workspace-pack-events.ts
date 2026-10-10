import { workspaceKey } from "./workspace-pack-files";

type Listener = () => void;
const state = globalThis as typeof globalThis & { __pivotWorkspacePackListeners?: Map<string, Set<Listener>> };
function listeners() { return state.__pivotWorkspacePackListeners ??= new Map(); }
export function subscribeWorkspacePacks(cwd: string, listener: Listener): () => void {
  const key = workspaceKey(cwd), all = listeners();
  const set = all.get(key) ?? new Set<Listener>();
  set.add(listener); all.set(key, set);
  return () => { set.delete(listener); if (!set.size) all.delete(key); };
}
export function notifyWorkspacePacks(cwd: string): void {
  for (const listener of listeners().get(workspaceKey(cwd)) ?? []) {
    try { listener(); } catch { /* Commit succeeded; runtime reload failures remain retryable. */ }
  }
}
