import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const endpoint = "/api/settings/model-http-timeout";
export function ModelHttpTimeoutSettings() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async res => {
      if (!res.ok) throw Error();
      const { timeoutMs } = await res.json();
      if (!controller.signal.aborted) { setSaved(timeoutMs); setDraft(String(timeoutMs / 1000)); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  const ms = Math.round(Number(draft) * 1000);
  async function save() {
    setBusy(true); setError(false);
    try {
      const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeoutMs: ms }) });
      if (!res.ok) throw Error();
      setSaved((await res.json()).timeoutMs);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <form onSubmit={e => { e.preventDefault(); void save(); }} style={{ marginTop: 32, fontSize: 13 }}>
    <label htmlFor="model-http-timeout" style={{ display: "block", fontWeight: 600, marginBottom: 10 }}>{t("settings.modelHttpTimeout")}</label>
    <input id="model-http-timeout" type="number" min={0} max={2147483.647} step={0.001} required disabled={saved === null || busy}
      value={draft} onChange={e => setDraft(e.target.value)} style={{ width: 96, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5 }} />
    {saved !== null && saved !== ms && <button disabled={busy} style={{ marginLeft: 8, color: "var(--accent)" }}>{t("general.save")}</button>}
    {error && (saved === null ? <button type="button" onClick={() => retry(n => n + 1)}>{t("general.refresh")}</button> : <p role="alert">{t("settings.idleSaveError")}</p>)}
  </form>;
}
