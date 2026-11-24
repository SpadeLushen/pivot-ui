import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

import { useAutosaveNumber } from "@/hooks/useAutosaveNumber";
import { TimerReset } from "lucide-react";
import { SettingsHeading } from "./SettingsHeading";

const defaultSeconds = 300;
const endpoint = "/api/settings/model-http-timeout";
export function ModelHttpTimeoutSettings() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async res => {
      if (!res.ok) throw Error();
      const { timeoutMs } = await res.json();
      if (!controller.signal.aborted) setSaved(timeoutMs);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  const enabled = saved !== null && saved > 0;
  async function save(ms: number) {
    const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeoutMs: ms }) });
    if (!res.ok) throw Error();
    setSaved((await res.json()).timeoutMs);
  }
  const field = useAutosaveNumber((saved ?? 0) / 1000, seconds => save(Math.round(seconds * 1000)), defaultSeconds);
  async function toggle(next: boolean) {
    setBusy(true); setError(false);
    try {
      await field.settle();
      await save(next ? defaultSeconds * 1000 : 0);
      field.reset();
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section style={{ marginTop: 32, fontSize: 13 }}>
    <SettingsHeading icon={TimerReset}>{t("settings.modelHttpTimeout")}</SettingsHeading>
    <label className="settings-enable">
      <input type="checkbox" checked={enabled} disabled={saved === null || busy}
        onChange={e => void toggle(e.target.checked)} />
      {t("settings.enable")}
    </label>
    {enabled && <div
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
      <label htmlFor="model-http-timeout">{t("settings.idleSeconds")}</label>
      <input id="model-http-timeout" type="number" min={0} max={2147483.647} step={1} required disabled={busy}
        {...field.input}
        style={{ width: 96, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5 }} />
    </div>}
    {(error || field.error) && (saved === null ? <button type="button" onClick={() => retry(n => n + 1)}>{t("general.refresh")}</button> : <p role="alert">{t("settings.idleSaveError")}</p>)}
  </section>;
}
