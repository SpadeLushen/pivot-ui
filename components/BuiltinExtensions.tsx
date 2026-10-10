"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useWorkspaceTrust } from "@/hooks/useWorkspaceTrust";
import { WorkspaceTrustNotice } from "./WorkspaceTrustNotice";
import { ToolError, ToolSwitch } from "./tools/ToolsControls";
import type { BuiltinExtensionName, BuiltinExtensionsSnapshot } from "@/lib/builtin-extension-types";

export function BuiltinExtensions({ cwd, sessionId, active = true, onClose }: {
  cwd: string; sessionId: string | null; active?: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const trust = useWorkspaceTrust(cwd, active);
  const [data, setData] = useState<BuiltinExtensionsSnapshot | null>(null);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [selected, setSelected] = useState<BuiltinExtensionName>("mcp");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), writing = useRef(false);
  const load = useCallback(async () => {
    if (!active || writing.current) return;
    const epoch = ++generation.current;
    try {
      const response = await fetch(`/api/plugins/builtins?cwd=${encodeURIComponent(cwd)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const next = await response.json() as BuiltinExtensionsSnapshot & { error?: string };
      if (epoch !== generation.current) return;
      if (!response.ok) throw new Error(next.error ?? "plugins.builtinRequestFailed");
      setData(next); setError(null);
    } catch (reason) {
      if (epoch === generation.current) setError(reason instanceof Error ? reason.message : "plugins.builtinRequestFailed");
    }
  }, [cwd, sessionId, active]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load, active]);
  const save = async (name?: BuiltinExtensionName, enabled?: boolean) => {
    if (writing.current || !data) return;
    const epoch = ++generation.current;
    writing.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/plugins/builtins", { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, sessionId, action: name ? "save" : "retry", name, enabled, scope,
          revision: scope === "global" ? data.globalRevision : data.revision }) });
      const next = await response.json() as BuiltinExtensionsSnapshot & { error?: string };
      if (epoch !== generation.current) return;
      if (!response.ok) throw new Error(next.error ?? "plugins.builtinRequestFailed");
      setData(next);
    } catch (reason) {
      if (epoch === generation.current) setError(reason instanceof Error ? reason.message : "plugins.builtinRequestFailed");
    } finally {
      writing.current = false;
      if (epoch === generation.current) setBusy(false);
    }
  };
  const extension = data?.builtins.find(item => item.name === selected) ?? data?.builtins[0];
  const disabled = busy || (scope === "project" && (trust.trusted !== true || !data?.trusted));
  return <div className="tools-content">
    {scope === "project" && trust.trusted !== true && <div className="tools-save-notice">
      <WorkspaceTrustNotice trust={trust} onTrusted={() => void load()} />
    </div>}
    <div className="tools-layout">
      <aside className="tools-list"><div className="tools-list-scroll">
        <div className="tools-group">{t("plugins.builtins")}</div>
        {data?.builtins.map(item => {
          const enabled = scope === "global" ? item.globalEnabled : item.configured;
          return <button type="button" key={item.name}
            className={`tools-row${extension?.name === item.name ? " selected" : ""}`}
            aria-pressed={extension?.name === item.name} onClick={() => setSelected(item.name)}>
            <i className={enabled ? "enabled" : ""} /><span>{item.name}</span>
          </button>;
        })}
      </div></aside>
      <div className="tools-details">
        <ToolError error={error} />
        {extension ? <>
          <div className="tools-detail-heading tools-tool-heading">
            <h3>{extension.name}</h3><span className="tools-badge tools-source-badge">{t("plugins.builtins")}</span>
            <span className="tools-enabled-control">
              <span className="tools-field-title">{t("tools.enabled")}</span>
              <ToolSwitch variant="compact" label={`${extension.name}: ${t("tools.enabled")}`}
                checked={scope === "global" ? extension.globalEnabled : extension.configured}
                disabled={disabled} onChange={enabled => void save(extension.name, enabled)} />
            </span>
          </div>
          <p className="tools-description">{t(`plugins.builtinDescription.${extension.name}`)}</p>
          <section className="tools-runtime">
            <h4>{t("plugins.builtinActual")}</h4>
            <dl className="tools-runtime-fields">
              <dt>{t("plugins.builtinConfigured")}</dt>
              <dd>{t(extension.configured ? "plugins.builtinEnabled" : "plugins.builtinDisabled")}</dd>
              <dt>{t("plugins.builtinScope")}</dt>
              <dd>{t(extension.source === "project" ? "plugins.builtinProject" : "plugins.builtinGlobal")}</dd>
              <dt>{t("plugins.builtinActual")}</dt>
              <dd>{t(`plugins.builtinState.${extension.state}`)}</dd>
            </dl>
            {extension.loaded !== null && <p className="tools-help">
              {t(extension.loaded ? "plugins.builtinLoadedFact" : "plugins.builtinNotLoadedFact")}
            </p>}
            {extension.warnings.map((warning, index) => <p key={index} className="tools-description">{warning}</p>)}
            <p className="tools-help">{t(data?.application ? `plugins.builtinApply.${data.application.state}` : "plugins.builtinNoSession")}</p>
            {data?.application?.state === "failed" && <button type="button" disabled={busy || data.application.running}
              onClick={() => void save()} style={{ alignSelf: "flex-start" }}>{t("plugins.builtinRetry")}</button>}
          </section>
          {!!data?.diagnostics.length && <details className="tools-runtime">
            <summary style={{ cursor: "pointer", fontSize: 12 }}>{t("plugins.builtinDiagnostics")}</summary>
            {data.diagnostics.map((item, index) => <p key={index} className="tools-help">
              {t(item.message)} {item.path && <code>{item.path}</code>}
            </p>)}
          </details>}
          <p className="tools-help">{t("plugins.builtinHelp")}</p>
        </> : !error && <div className="tools-empty">{t("general.loading")}</div>}
      </div>
    </div>
    <footer className="tools-footer">
      <div className="tools-save-actions">
        <select aria-label={t("plugins.builtinScope")} value={scope} disabled={busy}
          onChange={event => setScope(event.target.value as "global" | "project")}>
          <option value="global">{t("plugins.builtinGlobal")}</option>
          <option value="project">{t("plugins.builtinProject")}</option>
        </select>
        <span className="tools-help">{t("plugins.builtinAutoSave")}</span>
      </div>
      <button type="button" disabled={busy} onClick={() => void load()}>{t("tools.refresh")}</button>
      <button type="button" onClick={onClose}>{t("general.close")}</button>
    </footer>
  </div>;
}
