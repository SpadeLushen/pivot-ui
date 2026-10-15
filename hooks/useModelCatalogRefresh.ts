"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelRefreshError, ModelRefreshResult } from "@/lib/model-refresh-types";

const safeErrors: ModelRefreshError[] = ["models.refreshInvalidProvider", "models.refreshUnsupported",
  "models.refreshNeedsAuth", "models.refreshFailed", "models.refreshCancelled",
  "models.refreshOffline", "models.configurationInvalid"];

/** Discovery only; shares server work and never invokes a model. */
export function useModelCatalogRefresh(provider: string, cwd: string | undefined,
  onRefreshed: (signal: AbortSignal) => Promise<void>,
) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ModelRefreshError | null>(null);
  const request = useRef<{ controller: AbortController; promise: Promise<boolean> } | null>(null);
  const identity = `${provider}\0${cwd ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    setRefreshing(false); setRefreshError(null);
    return () => { request.current?.controller.abort(); request.current = null; };
  }, [identity]);

  const refresh = useCallback((force = true): Promise<boolean> => {
    if (request.current) return request.current.promise;
    const controller = new AbortController();
    const current = { controller, promise: Promise.resolve(false) };
    request.current = current;
    setRefreshing(true); setRefreshError(null);
    const active = () => request.current === current && identityRef.current === identity && !controller.signal.aborted;
    current.promise = (async () => {
      try {
        const response = await fetch("/api/models/refresh", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ provider, cwd, automatic: !force }),
        });
        const result = await response.json() as ModelRefreshResult;
        if (!active()) return false;
        if (!response.ok || !result.ok) {
          setRefreshError(safeErrors.includes(result.error as ModelRefreshError) ? result.error! : "models.refreshFailed");
        }
        // Even a failed refresh may publish partial data. Reload the cached snapshot,
        // but keep the previous list if this read also fails.
        await onRefreshed(controller.signal);
        return response.ok && result.ok;
      } catch {
        if (active()) setRefreshError("models.refreshFailed");
        return false;
      } finally {
        if (request.current === current) { request.current = null; setRefreshing(false); }
      }
    })();
    return current.promise;
  }, [provider, cwd, identity, onRefreshed]);
  return { refresh, refreshing, refreshError };
}
