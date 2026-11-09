"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { WorkspaceSkillPacksResponse, WorkspacePackMcpSyncResponse } from "@/lib/api-types";

export interface WorkspacePackSnapshot {
  revision: number;
  definitionsRevision: string;
  pendingServers: string[];
  application?: "applied" | "pending" | "failed";
  syncError: string | null;
}
const empty: WorkspacePackSnapshot = { revision: -1, definitionsRevision: "", pendingServers: [], syncError: null };
type Entry = { snapshot: WorkspacePackSnapshot; listeners: Set<() => void>; stop?: () => void;
  pending?: Promise<void>; activate?: boolean; rerun?: boolean };
const entries = new Map<string, Entry>();
const EVENT = "pivot-workspace-packs-changed";
function key(cwd: string) {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}
async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
async function refresh(cwd: string, entry: Entry, activate = false): Promise<void> {
  entry.activate ||= activate;
  if (entry.pending) { entry.rerun = true; return entry.pending; }
  const task = (async () => {
    do {
      entry.rerun = false;
      const shouldSync = entry.activate === true;
      entry.activate = false;
      await refreshSnapshot(cwd, entry, shouldSync);
    } while (entry.rerun && entry.listeners.size);
  })();
  entry.pending = task;
  try { await task; } finally { entry.pending = undefined; }
}
async function refreshSnapshot(cwd: string, entry: Entry, activate: boolean): Promise<void> {
  let next = entry.snapshot;
  try {
    const data = await json<WorkspaceSkillPacksResponse>(await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }));
    next = { revision: data.revision, definitionsRevision: data.definitionsRevision ?? "",
      pendingServers: data.pendingNativeMcpServers ?? [], application: data.application, syncError: null };
    if (activate || data.mcpSyncNeeded || entry.snapshot.syncError) next = await synchronize(cwd, next);
  } catch (error) { next = { ...next, syncError: error instanceof Error ? error.message : String(error) }; }
  if (JSON.stringify(next) === JSON.stringify(entry.snapshot)) return;
  entry.snapshot = next;
  for (const listener of entry.listeners) listener();
}
async function synchronize(cwd: string, snapshot: WorkspacePackSnapshot): Promise<WorkspacePackSnapshot> {
  const data = await json<WorkspacePackMcpSyncResponse>(await fetch("/api/workspace-skill-packs/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }),
  }));
  return { ...snapshot, revision: data.revision, definitionsRevision: data.definitionsRevision,
    pendingServers: data.pendingServers, application: data.application };
}
function entryFor(cwd: string) {
  const id = key(cwd);
  let entry = entries.get(id);
  if (!entry) { entry = { snapshot: empty, listeners: new Set() }; entries.set(id, entry); }
  return entry;
}
export function announcePackDefinitionChange(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}
export function announceWorkspacePackChange(cwd: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key(cwd) }));
}

function subscribe(cwd: string, listener: () => void) {
  if (!cwd) return () => {};
  const entry = entryFor(cwd);
  entry.listeners.add(listener);
  if (!entry.stop) {
    const reload = () => { void refresh(cwd, entry); };
    const activate = () => { void refresh(cwd, entry, true); };
    const changed = (event: Event) => {
      const target = (event as CustomEvent<string | undefined>).detail;
      if (!target || target === key(cwd)) activate();
    };
    const timer = setInterval(reload, 3000);
    window.addEventListener("focus", activate);
    window.addEventListener(EVENT, changed);
    entry.stop = () => {
      clearInterval(timer);
      window.removeEventListener("focus", activate);
      window.removeEventListener(EVENT, changed);
    };
    activate();
  }
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) { entry.stop?.(); entry.stop = undefined; }
  };
}
export function useWorkspacePackState(cwd: string | null | undefined): WorkspacePackSnapshot {
  const subscribeCwd = useCallback((listener: () => void) => subscribe(cwd ?? "", listener), [cwd]);
  const snapshot = useCallback(() => cwd ? entryFor(cwd).snapshot : empty, [cwd]);
  return useSyncExternalStore(subscribeCwd, snapshot, () => empty);
}
export function useWorkspacePackRevision(cwd: string | null | undefined): number {
  return useWorkspacePackState(cwd).revision;
}
