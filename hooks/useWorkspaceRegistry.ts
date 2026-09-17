"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspacePatch, WorkspaceRecord, WorkspaceRegistry } from "@/lib/workspace-registry";

export function useWorkspaceRegistry() {
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(operation: () => Promise<T>) => {
    const run = chain.current.then(operation);
    chain.current = run.catch(() => undefined);
    return run;
  }, []);
  const refresh = useCallback(() => enqueue(async () => {
    try {
      setRecords((await requestRegistry()).workspaces);
      setReady(true);
      setError(null);
    } catch (error) { setError(String(error)); }
  }), [enqueue]);
  const update = useCallback((patch: WorkspacePatch) => enqueue(async () => {
    try {
      setRecords((await requestRegistry("PATCH", patch)).workspaces);
      setError(null);
    } catch (error) {
      setError(String(error));
      throw error;
    }
  }), [enqueue]);

  useEffect(() => {
    void refresh();
    const sync = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = window.setInterval(sync, 15_000);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
    };
  }, [refresh]);
  return { records, ready, error, refresh, update };
}

async function requestRegistry(method: "GET" | "PATCH" = "GET", body?: unknown): Promise<WorkspaceRegistry> {
  const response = await fetch("/api/workspaces", {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as WorkspaceRegistry;
}
