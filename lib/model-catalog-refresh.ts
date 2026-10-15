import { getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { statSync } from "node:fs";
import { createPivotAgentSessionServices } from "./model-runtime";
import { invalidateModelsCache, modelCatalogGeneration, trackModelCatalogRefresh } from "./models-cache";
import { notifyResourceConfigurationChanged } from "./session-resource-events";
import type { ModelCatalogRefreshStatus, ModelRefreshError, ModelRefreshResult } from "./model-refresh-types";

interface RefreshEntry {
  cwd: string;
  generation: number;
  configurationRevision: string;
  controller: AbortController;
  promise: Promise<ModelRefreshResult>;
  result?: ModelRefreshResult;
  checkedAt?: number;
  waiters: number;
}
declare global { var __pivotCatalogRefreshes: Map<string, RefreshEntry> | undefined; }
const entries = () => globalThis.__pivotCatalogRefreshes ??= new Map();
const key = (provider: string) => `${getAgentDir()}\0${provider}`;
const failure = (error: ModelRefreshError, status: number): ModelRefreshResult => ({ ok: false, error, status });
const CACHE_MS = 60_000;

// File metadata only: never retain credentials or expose their fingerprints to the browser.
function configurationRevision(): string {
  return ["auth.json", "models.json", "pivot-models.json"].map((file) => {
    try {
      const stat = statSync(join(getAgentDir(), file));
      return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    } catch { return "unavailable"; }
  }).join("|");
}

export function modelCatalogRefreshStatus(provider: string, cwd: string): ModelCatalogRefreshStatus {
  if (process.env.PI_OFFLINE !== undefined) return { state: "offline", error: "models.refreshOffline" };
  const entry = entries().get(key(provider));
  if (!entry || entry.cwd !== resolve(cwd) || entry.generation !== modelCatalogGeneration()
    || entry.configurationRevision !== configurationRevision()) return { state: "cached" };
  if (!entry.result) return { state: "refreshing" };
  if (entry.result.ok && Date.now() - (entry.checkedAt ?? 0) >= CACHE_MS) return { state: "cached", checkedAt: entry.checkedAt };
  return { state: entry.result.ok && !entry.result.skipped ? "fresh" : "failed",
    checkedAt: entry.checkedAt, error: entry.result.error };
}

export async function refreshModelCatalog(provider: string, options: {
  cwd?: string; signal?: AbortSignal; force?: boolean; runtime?: ModelRuntime;
} = {}): Promise<ModelRefreshResult> {
  if (options.signal?.aborted) return failure("models.refreshCancelled", 408);
  if (process.env.PI_OFFLINE !== undefined) return failure("models.refreshOffline", 409);
  const cwd = resolve(options.cwd ?? process.cwd());
  const id = key(provider), generation = modelCatalogGeneration(), revision = configurationRevision();
  let entry = entries().get(id);
  if (entry && (entry.cwd !== cwd || entry.generation !== generation
    || entry.configurationRevision !== revision || entry.controller.signal.aborted)) {
    if (entry.generation !== generation || entry.configurationRevision !== revision) entry.controller.abort();
    // The store is provider-scoped. Queue different workspaces, rather than
    // cancelling another client merely because it has different project extensions.
    try { await withRefreshSignal(entry.promise, options.signal ?? new AbortController().signal); }
    catch { return failure("models.refreshCancelled", 408); }
    if (entries().get(id) === entry) entries().delete(id);
    return refreshModelCatalog(provider, options);
  }
  if (!entry || (entry.result && (options.force || Date.now() - (entry.checkedAt ?? 0) >= CACHE_MS))) {
    for (const [name, value] of entries()) {
      if (value.result && name !== id && Date.now() - (value.checkedAt ?? 0) >= CACHE_MS) entries().delete(name);
    }
    if (!entry && entries().size >= 32) return failure("models.refreshFailed", 503);
    entry = { cwd, generation, configurationRevision: revision, controller: new AbortController(), waiters: 0,
      promise: Promise.resolve(failure("models.refreshCancelled", 408)) };
    entries().set(id, entry);
    const current = entry;
    entry.promise = executeRefresh(provider, entry, options.runtime).then((result) => {
      current.result = result; current.checkedAt = Date.now();
      return result;
    });
  }
  return waitForRefresh(entry, options.signal);
}

async function waitForRefresh(entry: RefreshEntry, signal?: AbortSignal): Promise<ModelRefreshResult> {
  entry.waiters++;
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) return failure("models.refreshCancelled", 408);
    return await new Promise<ModelRefreshResult>((resolve) => {
      onAbort = () => resolve(failure("models.refreshCancelled", 408));
      signal?.addEventListener("abort", onAbort, { once: true });
      void entry.promise.then(resolve);
    });
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    entry.waiters--;
    if (!entry.waiters && !entry.result) entry.controller.abort();
  }
}

function withRefreshSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Catalog refresh cancelled"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    void work.then((value) => {
      signal.removeEventListener("abort", abort); resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

async function executeRefresh(providerId: string, entry: RefreshEntry, runtime?: ModelRuntime): Promise<ModelRefreshResult> {
  const signal = entry.controller.signal;
  const timeout = setTimeout(() => entry.controller.abort(), 30_000);
  const untrack = trackModelCatalogRefresh(entry.controller);
  let attempted = false;
  try {
    return await withRefreshSignal((async () => {
      runtime ??= (await createPivotAgentSessionServices({ cwd: entry.cwd, modelRuntimeSignal: signal })).modelRuntime;
      signal.throwIfAborted();
      const provider = runtime.getProvider(providerId);
      if (!provider) return failure("models.refreshInvalidProvider", 404);
      if (!provider.refreshModels) return failure("models.refreshUnsupported", 501);
      if (runtime.getError()) return failure("models.configurationInvalid", 409);
      if (!(await runtime.checkAuth(providerId, { signal }))) return failure("models.refreshNeedsAuth", 409);
      signal.throwIfAborted();
      attempted = true;
      const result = await runtime.refresh({ providers: [providerId], allowNetwork: true, force: true, signal });
      if (result.aborted || signal.aborted) return failure("models.refreshCancelled", 408);
      if (result.errors.size) return failure("models.refreshFailed", 502);
      return { ok: true, status: 200 };
    })(), signal);
  } catch {
    // Provider diagnostics can contain credentials. Only fixed error codes cross this boundary.
    return failure(signal.aborted ? "models.refreshCancelled" : "models.refreshFailed", signal.aborted ? 408 : 500);
  } finally {
    clearTimeout(timeout); untrack();
    if (attempted && entry.generation === modelCatalogGeneration()) {
      invalidateModelsCache({ catalogChanged: false });
      notifyResourceConfigurationChanged();
    }
  }
}
