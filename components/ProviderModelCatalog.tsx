"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { usePreferences } from "@/lib/preferences-context";
import { modelVisibilityKey } from "@/lib/model-visibility";
import { useModelCatalogRefresh } from "@/hooks/useModelCatalogRefresh";
import type { ModelCatalogRefreshStatus } from "@/lib/model-refresh-types";
import { ModelCatalogRefreshNotice } from "./ModelCatalogRefreshNotice";
import type { TypedModelEntry } from "@/lib/model-catalog";
import { useI18n } from "@/lib/i18n";

/** Static discovery only: opening this view never tests a model. */
export function ProviderModelCatalog({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const { preferences, ready, updatePreferences } = usePreferences();
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState(false);
  const hiddenModels = new Set(preferences["hidden-models"]);
  const toggleVisibility = async (model: TypedModelEntry) => {
    const key = modelVisibilityKey(model.provider, model.id);
    const next = new Set(hiddenModels);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSavingVisibility(true);
    setVisibilityError(false);
    try {
      await updatePreferences({ "hidden-models": [...next] });
    } catch {
      setVisibilityError(true);
    } finally {
      setSavingVisibility(false);
    }
  };
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
      {models.some((model) => model.type === "chat") && (
        <p style={{ color: "var(--text-muted)" }}>{t("models.visibilityHelp")}</p>
      )}
      {visibilityError && <p role="alert" style={{ color: "#f87171" }}>{t("models.visibilitySaveFailed")}</p>}
      <div>
        {models.map((model) => {
          const hidden = hiddenModels.has(modelVisibilityKey(model.provider, model.id));
          const action = t(hidden ? "models.showModel" : "models.hideModel", { name: model.name });
          return (
            <div key={JSON.stringify([model.type, model.provider, model.id])}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <strong>{model.type}</strong>
              <span title={model.id} style={{ flex: 1, overflowWrap: "anywhere" }}>{model.name} · {model.id}</span>
              <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{t(`models.catalog.${model.availability}`)}</span>
              {model.type === "chat" && (
                <button type="button" onClick={() => { void toggleVisibility(model); }}
                  disabled={!ready || savingVisibility} aria-pressed={!hidden} aria-label={action} title={action}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, width: 24, height: 24, padding: 0,
                    border: "none", borderRadius: 4, background: "transparent",
                    color: hidden ? "var(--text-muted)" : "var(--text)",
                    cursor: !ready || savingVisibility ? "wait" : "pointer" }}>
                  {hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
