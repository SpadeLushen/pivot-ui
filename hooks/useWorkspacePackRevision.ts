"use client";

import { useCallback, useSyncExternalStore } from "react";

type Entry = { revision: number; listeners: Set<() => void>; stop?: () => void; pending?: Promise<void> };
const entries = new Map<string, Entry>();
const EVENT = "pivot-workspace-packs-changed";
function key(cwd: string) {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}
async function refresh(cwd: string, entry: Entry) {
  if (entry.pending) return entry.pending;
  const task = (async () => {
    try {
      const response = await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return;
      const data = await response.json() as { revision?: number };
      if (typeof data.revision !== "number" || data.revision === entry.revision) return;
      entry.revision = data.revision;
      for (const listener of entry.listeners) listener();
    } catch { /* Focus/poll retries; read failures never create a send gate. */ }
  })();
  entry.pending = task;
  try { await task; } finally { entry.pending = undefined; }
}
function entryFor(cwd: string) {
  const id = key(cwd);
  let entry = entries.get(id);
  if (!entry) { entry = { revision: -1, listeners: new Set() }; entries.set(id, entry); }
  return entry;
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
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key(cwd)) reload();
    };
    const timer = setInterval(reload, 3000);
    window.addEventListener("focus", reload);
    window.addEventListener(EVENT, changed);
    entry.stop = () => {
      clearInterval(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener(EVENT, changed);
    };
    reload();
  }
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) { entry.stop?.(); entry.stop = undefined; }
  };
}
export function useWorkspacePackRevision(cwd: string | null | undefined): number {
  const subscribeCwd = useCallback((listener: () => void) => subscribe(cwd ?? "", listener), [cwd]);
  const snapshot = useCallback(() => cwd ? entryFor(cwd).revision : -1, [cwd]);
  return useSyncExternalStore(subscribeCwd, snapshot, () => -1);
}
