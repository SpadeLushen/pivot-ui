"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { SessionIndexStatus } from "@/lib/session-index-types";

const endpoint = "/api/session-list-index";

async function requestStatus(init: RequestInit): Promise<SessionIndexStatus> {
  const response = await fetch(endpoint, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function SessionListIndexSettings({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SessionIndexStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    if (!active || starting) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const epoch = request.current;
      try {
        const next = await requestStatus({ signal: controller.signal });
        if (!controller.signal.aborted && request.current === epoch) {
          setStatus(next);
          setPollError("");
        }
      } catch (error) {
        if (!controller.signal.aborted && request.current === epoch) setPollError(String(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 2000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, starting]);

  const rebuild = async () => {
    request.current++;
    setStarting(true);
    setError("");
    try { setStatus(await requestStatus({ method: "POST" })); }
    catch (error) { setError(String(error)); }
    finally { setStarting(false); }
  };
  return <section>
    <h3>{t("storage.sessionListIndex")}</h3>
    <button type="button" disabled={starting || status?.rebuilding} onClick={() => void rebuild()}>
      {t("storage.rebuildSessionListIndex")}
    </button>
    {starting || status?.rebuilding ? (
      <p role="status">{!starting && status?.total
        ? t("storage.progress", { completed: status.completed, total: status.total })
        : t("storage.scanningSessionFiles")}</p>
    ) : !error && !pollError && status && !status.error && status.revision > 0 ? (
      <p role="status">{t("storage.sessionListRebuilt")}</p>
    ) : null}
    {(error || pollError || status?.error) && (
      <p role="alert" className="workspace-error">{error || pollError || status?.error}</p>
    )}
  </section>;
}
