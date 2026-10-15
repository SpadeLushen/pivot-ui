"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModelCatalogRefresh } from "@/hooks/useModelCatalogRefresh";
import type { ModelCatalogRefreshStatus } from "@/lib/model-refresh-types";
import { ModelCatalogRefreshNotice } from "./ModelCatalogRefreshNotice";
import type { TypedModelEntry } from "@/lib/model-catalog";
import { useI18n } from "@/lib/i18n";

/** Static discovery only: opening this view never tests a model. */
export function ProviderModelCatalog({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const [models, setModels] = useState<TypedModelEntry[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ModelCatalogRefreshStatus | null>(null);
  const readRevision = useRef(0);
  const reload = useCallback(async (signal: AbortSignal) => {
    const revision = ++readRevision.current;
    const response = await fetch("/api/models", { signal });
    if (!response.ok) throw new Error("Catalog unavailable");
    const data = await response.json() as { typedCatalog?: TypedModelEntry[]; catalogUnavailable?: boolean;
      catalogError?: string; openRouterCatalog?: ModelCatalogRefreshStatus };
    signal.throwIfAborted();
    if (revision !== readRevision.current) return;
    setModels((data.typedCatalog ?? []).filter((model) => model.provider === providerId));
    setUnavailable(!!data.catalogUnavailable || !Array.isArray(data.typedCatalog));
    setError(data.catalogError ?? null);
    setStatus(providerId === "openrouter" ? data.openRouterCatalog ?? null : null);
  }, [providerId]);
  const { refresh, refreshing, refreshError } = useModelCatalogRefresh(providerId, undefined, reload);
  useEffect(() => {
    const controller = new AbortController();
    setModels([]); setStatus(null);
    setUnavailable(false); setError(null);
    void reload(controller.signal).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (status?.state === "refreshing") void refresh(false);
  }, [status?.state, refresh]);
  return (
    <details style={{ marginTop: 16, fontSize: 12 }} onToggle={(event) => {
      if (event.currentTarget.open && status) void refresh(false);
    }}>
      <summary style={{ cursor: "pointer" }}>{t("models.catalogModels")} ({models.length})</summary>
      <p style={{ color: "var(--text-dim)" }}>{t("models.catalogStatus")}</p>
      {unavailable && <p role="status">{error ? t(error) : t("models.catalogUnavailable")}</p>}
      {status && <ModelCatalogRefreshNotice status={status} refreshing={refreshing} error={refreshError}
        onRefresh={() => { void refresh(true); }} />}
      <div>
        {models.map((model) => (
          <div key={JSON.stringify([model.type, model.provider, model.id])}
            style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
            <strong>{model.type}</strong>
            <span title={model.id} style={{ flex: 1, overflowWrap: "anywhere" }}>{model.name} · {model.id}</span>
            <span style={{ color: "var(--text-dim)" }}>{t(`models.catalog.${model.availability}`)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
