"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences-context";
import { formatBytes } from "@/lib/types";
import type { SessionSearchAction, SessionSearchStatus } from "@/lib/session-search-types";

export function StorageSettings({ active = true }: { active?: boolean }) {
  const { t } = useI18n();
  const { preferences, updatePreferences, refresh } = usePreferences();
  const [status, setStatus] = useState<SessionSearchStatus | null>(null);
  const [path, setPath] = useState(preferences["session-search-path"]);
  const [workspaceParent, setWorkspaceParent] = useState(preferences["default-workspace-parent"]);
  const [pickerStart, setPickerStart] = useState(preferences["workspace-picker-start-directory"]);
  const [pickerError, setPickerError] = useState("");
  const [savingPicker, setSavingPicker] = useState(false);
  const [pickerSaved, setPickerSaved] = useState(false);
  const [parentError, setParentError] = useState("");
  const [savingParent, setSavingParent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => setWorkspaceParent(preferences["default-workspace-parent"]), [preferences["default-workspace-parent"]]);
  useEffect(() => setPath(preferences["session-search-path"]), [preferences["session-search-path"]]);
  useEffect(() => setPickerStart(preferences["workspace-picker-start-directory"]), [preferences["workspace-picker-start-directory"]]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const requestEpoch = epoch.current;
      try {
        const response = await fetch("/api/session-search", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? response.status);
        if (!controller.signal.aborted && requestEpoch === epoch.current) setStatus(data);
      } catch (error) {
        if (!controller.signal.aborted && requestEpoch === epoch.current) setError(String(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active]);

  const post = async (action: SessionSearchAction) => {
    const response = await fetch("/api/session-search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? response.status);
    return data as SessionSearchStatus;
  };
  const operate = async (action: SessionSearchAction) => {
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      const next = await post(action);
      if (mounted.current) setStatus(next);
    } catch (error) { if (mounted.current) setError(String(error)); }
    finally {
      epoch.current++;
      if (mounted.current) setBusy(false);
      await refresh();
    }
  };
  const toggle = (enabled: boolean) => {
    if (!window.confirm(t(enabled ? "storage.enableConfirm" : "storage.disableConfirm"))) return;
    void operate({ action: enabled ? "enable" : "disable" });
  };
  const move = async () => {
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      await post({ action: "check-path", path: path.trim() });
      if (!window.confirm(t("storage.moveConfirm"))) return;
      const next = await post({ action: "move", path: path.trim(), migrate: true });
      if (mounted.current) setStatus(next);
    } catch (error) { if (mounted.current) setError(String(error)); }
    finally {
      epoch.current++;
      if (mounted.current) setBusy(false);
      await refresh();
    }
  };
  const saveWorkspaceParent = async () => {
    setSavingParent(true);
    setParentError("");
    try {
      const next = await updatePreferences({ "default-workspace-parent": workspaceParent.trim() });
      setWorkspaceParent(next["default-workspace-parent"]);
    } catch { setParentError(t("settings.defaultWorkspaceParentError")); }
    finally { setSavingParent(false); }
  };
  const savePickerStart = async () => {
    setSavingPicker(true);
    setPickerError("");
    setPickerSaved(false);
    try {
      const next = await updatePreferences({ "workspace-picker-start-directory": pickerStart.trim() });
      setPickerStart(next["workspace-picker-start-directory"]);
      setPickerSaved(true);
    } catch { setPickerError(t("storage.workspacePickerStartError")); }
    finally { setSavingPicker(false); }
  };
  return <div className="storage-settings">
    <section>
      <h3>{t("storage.sessionTextSearch")}</h3>
      <p>{t("storage.description")}</p>
      <label className="storage-toggle">
        <input type="checkbox" checked={status?.enabled ?? preferences["session-search-enabled"]}
          disabled={busy || !status} onChange={(event) => toggle(event.target.checked)} />
        {t("storage.enable")}
      </label>
      <form className="storage-path-form" onSubmit={(event) => { event.preventDefault(); void move(); }}>
        <label htmlFor="session-search-path">{t("storage.databasePath")}</label>
        <div>
          <input id="session-search-path" value={path} disabled={busy}
            onChange={(event) => setPath(event.target.value)} />
          <button type="submit" disabled={busy || !status || !path.trim() || path.trim() === status.path}>
            {t("general.save")}
          </button>
        </div>
      </form>
      <p>{t("storage.databaseSize")}: {status ? formatBytes(status.bytes) : "—"}</p>
      <button type="button" disabled={busy || !status?.enabled} onClick={() => {
        if (window.confirm(t("storage.rebuildConfirm"))) void operate({ action: "rebuild" });
      }}>{t("storage.rebuild")}</button>
      <p role="status" aria-live="polite">
        {busy ? t("general.saving") : !status ? t("general.loading")
          : status.indexing ? t("storage.progress", { completed: status.completed, total: status.total })
          : !status.enabled ? t("storage.disabled")
          : status.error ? t("storage.incomplete") : t("storage.ready")}
      </p>
      {(error || status?.error) && <p role="alert" className="workspace-error">{error || status?.error}</p>}
    </section>
    <section>
      <h3 id="workspace-picker-start-heading">{t("storage.workspacePickerStart")}</h3>
      <p id="workspace-picker-start-description">{t("storage.workspacePickerStartDescription")}</p>
      <form className="storage-path-form" onSubmit={(event) => { event.preventDefault(); void savePickerStart(); }}>
        <div>
          <input
            aria-labelledby="workspace-picker-start-heading"
            aria-describedby="workspace-picker-start-description"
            value={pickerStart}
            disabled={savingPicker}
            onChange={(event) => { setPickerStart(event.target.value); setPickerError(""); setPickerSaved(false); }}
          />
          <button type="submit" disabled={savingPicker}>
            {t(savingPicker ? "general.saving" : "general.save")}
          </button>
        </div>
      </form>
      {pickerError && <p role="alert" className="workspace-error">{pickerError}</p>}
      {pickerSaved && <p role="status">{t("general.saved")}</p>}
    </section>
    {/* Default workspace parent on the server */}
    <section style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
        {t("settings.defaultWorkspaceParent")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        {t("settings.defaultWorkspaceParentDescription")}
      </p>
      <form onSubmit={(event) => { event.preventDefault(); void saveWorkspaceParent(); }} style={{ display: "flex", gap: 8 }}>
        <input
          aria-label={t("settings.defaultWorkspaceParent")}
          value={workspaceParent}
          onChange={(event) => { setWorkspaceParent(event.target.value); setParentError(""); }}
          style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
        />
        <button type="submit" disabled={savingParent || !workspaceParent.trim()} style={{ padding: "8px 14px", cursor: "pointer" }}>
          {t("settings.saveWorkspaceParent")}
        </button>
      </form>
      {parentError && <p role="alert" style={{ color: "var(--text)", fontSize: 12 }}>{parentError}</p>}
    </section>
  </div>;
}
