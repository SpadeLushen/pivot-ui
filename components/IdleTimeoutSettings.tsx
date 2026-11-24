import { SettingsHeading } from "./SettingsHeading";
import { Timer } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences-context";
import { useAutosaveNumber } from "@/hooks/useAutosaveNumber";
import { MAX_IDLE_MINUTES } from "@/lib/preferences-types";

export function IdleTimeoutSettings() {
  const { t } = useI18n();
  const { preferences, updatePreferences } = usePreferences();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const enabled = preferences["idle-timeout-enabled"];
  const minutes = preferences["idle-timeout-minutes"];
  const field = useAutosaveNumber(minutes, async next => { await updatePreferences({ "idle-timeout-minutes": next }); });
  async function toggle(next: boolean) {
    setSaving(true);
    setError(false);
    try {
      await field.settle();
      await updatePreferences({ "idle-timeout-enabled": next });
      field.reset();
    } catch { setError(true); }
    finally { setSaving(false); }
  }
  return (
    <section style={{ marginTop: 32, fontSize: 13 }}>
      <SettingsHeading icon={Timer}>{t("settings.idleEnabled")}</SettingsHeading>
      <label className="settings-enable">
        <input type="checkbox" checked={enabled} disabled={saving} style={{ accentColor: "var(--accent)" }}
          onChange={e => void toggle(e.target.checked)} />
        {t("settings.enable")}
      </label>
      {enabled && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label htmlFor="idle-minutes">{t("settings.idleMinutes")}</label>
        <input id="idle-minutes" type="number" required min={1} max={MAX_IDLE_MINUTES} step={1} disabled={saving}
          {...field.input} style={{ width: 80, border: "1px solid var(--border)", padding: "4px 8px", borderRadius: 5 }} />
      </div>}
      {(error || field.error) && <p role="alert">{t("settings.idleSaveError")}</p>}
    </section>
  );
}
