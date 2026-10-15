"use client";

import type { ModelCatalogRefreshStatus } from "@/lib/model-refresh-types";
import { useI18n } from "@/lib/i18n";

export function ModelCatalogRefreshNotice({ status, refreshing, error, onRefresh }: {
  status?: ModelCatalogRefreshStatus | null;
  refreshing: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const message = error ?? status?.error;
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, maxWidth: 380 }}>
      <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}
        style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "4px 8px",
          background: "var(--bg-panel)", color: "var(--text-muted)", cursor: refreshing ? "wait" : "pointer" }}>
        {t(refreshing ? "models.refreshingModels" : "models.refreshModels")}
      </button>
      <p role="status" style={{ margin: "6px 0 0", color: message ? "var(--warning, #d97706)" : "var(--text-dim)", whiteSpace: "normal" }}>
        {message ? `${t(message)} ${t("models.catalogMayBeStale")}`
          : t(refreshing || status?.state === "refreshing" ? "models.catalogRefreshing"
            : status?.state === "fresh" ? "models.catalogRefreshed" : "models.catalogCached")}
      </p>
      <p style={{ margin: "4px 0 0", color: "var(--text-dim)", whiteSpace: "normal" }}>{t("models.openRouterCatalogBoundary")}</p>
    </div>
  );
}
