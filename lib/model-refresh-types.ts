export type ModelRefreshError = "models.refreshInvalidProvider" | "models.refreshUnsupported"
  | "models.refreshNeedsAuth" | "models.refreshFailed" | "models.refreshCancelled"
  | "models.refreshOffline" | "models.configurationInvalid";

export interface ModelRefreshResult {
  ok: boolean;
  status: number;
  error?: ModelRefreshError;
  skipped?: boolean;
}

/** Fresh means refreshed, not that the Provider verified permission to call every model. */
export interface ModelCatalogRefreshStatus {
  state: "cached" | "refreshing" | "fresh" | "failed" | "offline";
  checkedAt?: number;
  error?: ModelRefreshError;
}
