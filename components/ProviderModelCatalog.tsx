"use client";

import { useEffect, useState } from "react";
import type { TypedModelEntry } from "@/lib/model-catalog";
import { useI18n } from "@/lib/i18n";

/** Static discovery only: opening this view never tests a model. */
export function ProviderModelCatalog({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const [models, setModels] = useState<TypedModelEntry[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setModels([]);
    setUnavailable(false); setError(null);
    void fetch("/api/models", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        return response.json() as Promise<{ typedCatalog?: TypedModelEntry[]; catalogUnavailable?: boolean; catalogError?: string }>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setModels((data.typedCatalog ?? []).filter((model) => model.provider === providerId));
        setUnavailable(!!data.catalogUnavailable || !Array.isArray(data.typedCatalog));
        setError(data.catalogError ?? null);
      })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [providerId]);
  return (
    <details style={{ marginTop: 16, fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }}>{t("models.catalogModels")} ({models.length})</summary>
      <p style={{ color: "var(--text-dim)" }}>{t("models.catalogStatus")}</p>
      {unavailable && <p role="status">{error ?? t("models.catalogUnavailable")}</p>}
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
