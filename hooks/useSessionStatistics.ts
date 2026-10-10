"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionStatsInfo } from "@/lib/pi-types";

/** Replace snapshots, never increment from transient/replayed SSE messages. */
export function useSessionStatistics(sid: string | null, leafId: string | null, live: boolean, revision: unknown, runId: number) {
  const key = `${sid ?? ""}\0${leafId ?? ""}\0${live}\0${runId}`;
  const [snapshot, setSnapshot] = useState<{ key: string; stats: SessionStatsInfo | null }>({ key: "", stats: null });
  const [refreshId, setRefreshId] = useState(0);
  const refresh = useCallback(() => setRefreshId(value => value + 1), []);
  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const read = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      let failed = true;
      const params = new URLSearchParams();
      if (leafId) params.set("leafId", leafId);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sid)}/stats?${params}`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error("Statistics unavailable");
        const stats = await response.json() as SessionStatsInfo;
        failed = false;
        if (!cancelled && !request.signal.aborted) setSnapshot({ key, stats });
      } catch {
        if (!cancelled && !request.signal.aborted) setSnapshot(previous => ({ key,
          stats: previous.key === key && previous.stats ? { ...previous.stats, statsUnavailable: true } : null }));
      }
      if (!cancelled && controller === request && (live || failed)) timer = setTimeout(read, live ? 3000 : 15000);
    };
    void read();
    const reconcile = () => { clearTimeout(timer); void read(); };
    window.addEventListener("online", reconcile);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", reconcile);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [sid, leafId, live, revision, runId, key, refreshId]);
  return { stats: snapshot.key === key ? snapshot.stats : null, refresh };
}
