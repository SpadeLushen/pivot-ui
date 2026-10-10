import { workspaceKey } from "./workspace-pack-files";

declare global {
  var __pivotResourceChanges: { global: number; workspaces: Map<string, number>; listeners: Map<string, Set<() => void>> } | undefined;
}
function state() { return globalThis.__pivotResourceChanges ??= { global: 0, workspaces: new Map(), listeners: new Map() }; }
export function resourceRevision(cwd: string): string {
  const value = state(); return `${value.global}:${value.workspaces.get(workspaceKey(cwd)) ?? 0}`;
}
export function subscribeResourceChanges(cwd: string, listener: () => void) {
  const value = state(), key = workspaceKey(cwd), set = value.listeners.get(key) ?? new Set<() => void>();
  value.listeners.set(key, set); set.add(listener);
  return () => { set.delete(listener); if (!set.size) value.listeners.delete(key); };
}
export function notifyMcpConfigurationChanged(cwd?: string): void {
  const value = state();
  if (cwd) { const key = workspaceKey(cwd); value.workspaces.set(key, (value.workspaces.get(key) ?? 0) + 1); }
  else value.global++;
  const groups = cwd ? [value.listeners.get(workspaceKey(cwd)) ?? []] : value.listeners.values();
  for (const group of groups) for (const listener of group) {
    try { listener(); } catch { /* Persisted config remains authoritative. */ }
  }
}
