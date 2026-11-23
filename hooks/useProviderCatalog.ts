import { useEffect, useRef, useState } from "react";
import type { ProviderCatalogModel } from "@/lib/provider-catalog";

type Entry = { body: string; controller: AbortController; result: Promise<ProviderCatalogModel[]> };
type Connection = { baseUrl?: string; apiKey?: string; api?: string; headers?: Record<string, string>; authHeader?: unknown };

export function useProviderCatalog(name: string | undefined, index: number | undefined, p?: Connection) {
  const body = p?.baseUrl?.trim() ? JSON.stringify({ baseUrl: p.baseUrl.trim(), api: p.api,
    apiKey: p.apiKey, headers: p.headers, authHeader: p.authHeader }) : undefined;
  const cache = useRef(new Map<string, Entry>()).current;
  const [shown, setShown] = useState<{ name: string; body: string; models: ProviderCatalogModel[] }>();
  useEffect(() => () => {
    for (const entry of cache.values()) entry.controller.abort();
    cache.clear();
  }, [cache]);
  useEffect(() => {
    if (!name || !body) { setShown(undefined); return; }
    let entry = cache.get(name);
    if (entry?.body !== body) {
      entry?.controller.abort();
      const controller = new AbortController();
      const result = fetch("/api/models-config/catalog", { method: "POST", headers: { "Content-Type": "application/json" },
        body, signal: controller.signal }).then(async response => {
        const models: unknown = response.ok ? (await response.json()).models : undefined;
        return Array.isArray(models) ? models as ProviderCatalogModel[] : [];
      }).catch(() => []);
      entry = { body, controller, result };
      cache.set(name, entry);
    }
    let active = true;
    void entry.result.then(models => {
      if (!models.length && cache.get(name) === entry) cache.delete(name);
      if (active) setShown({ name, body, models });
    });
    return () => { active = false; };
  }, [cache, name, index, body]);
  return shown && shown.name === name && shown.body === body ? shown.models : [];
}
