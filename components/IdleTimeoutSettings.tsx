import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences-context";
import { isIdleMinutes, MAX_IDLE_MINUTES, type PreferencePatch } from "@/lib/preferences-types";

export function IdleTimeoutSettings() {
  const { t } = useI18n();
  const { preferences, updatePreferences } = usePreferences();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const enabled = preferences["idle-timeout-enabled"];
  const minutes = preferences["idle-timeout-minutes"];
  async function save(patch: PreferencePatch) {
    setSaving(true);
    setError(false);
    try {
      await updatePreferences(patch);
      setDraft(null);
    } catch { setError(true); }
    finally { setSaving(false); }
  }
  return (
    <section style={{ marginTop: 32, fontSize: 13 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} disabled={saving} style={{ accentColor: "var(--accent)" }}
          onChange={e => void save({ "idle-timeout-enabled": e.target.checked })} />
        {t("settings.idleEnabled")}
      </label>
      {enabled && <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }} onSubmit={e => {
        e.preventDefault();
        if (draft !== null && isIdleMinutes(Number(draft))) void save({ "idle-timeout-minutes": Number(draft) });
      }}>
        <label htmlFor="idle-minutes">{t("settings.idleMinutes")}</label>
        <input id="idle-minutes" type="number" required min={1} max={MAX_IDLE_MINUTES} step={1} disabled={saving}
          value={draft ?? minutes} onChange={e => setDraft(e.target.value)} style={{ width: 80, border: "1px solid var(--border)", padding: "4px 8px", borderRadius: 5 }} />
        {draft !== null && Number(draft) !== minutes && <button type="submit" disabled={saving} style={{ color: "var(--accent)" }}>{t("general.save")}</button>}
      </form>}
      {error && <p role="alert">{t("settings.idleSaveError")}</p>}
    </section>
  );
}
