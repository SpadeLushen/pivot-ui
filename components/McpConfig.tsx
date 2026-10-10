"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ToolsSnapshot, ToolSettingsTarget } from "@/lib/tool-settings-types";
import { ToolsModal, ToolError } from "./tools/ToolsControls";
import { McpPanel } from "./tools/McpPanel";
import { RegisteredToolsPanel } from "./tools/RegisteredToolsPanel";
import { useToolSettingsEditor } from "@/hooks/useToolSettingsEditor";
import { useWorkspaceTrust } from "@/hooks/useWorkspaceTrust";
import { WorkspaceTrustNotice } from "./WorkspaceTrustNotice";

export function ToolsConfig({ cwd, sessionId, onClose }: { cwd: string; sessionId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"mcp" | "tools">("mcp");
  const trust = useWorkspaceTrust(cwd);
  const scope = `${cwd}\0${sessionId ?? ""}`;
  const [loaded, setLoaded] = useState<{ scope: string; snapshot: ToolsSnapshot } | null>(null);
  const snapshot = loaded?.scope === scope ? loaded.snapshot : null;
  const [error, setError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const scopeRef = useRef(scope), requestEpoch = useRef(0);
  const onUpdated = useCallback((data: ToolsSnapshot) => {
    if (scopeRef.current !== scope) return;
    requestEpoch.current++; // A slow pre-save GET must not replace the PATCH response.
    setLoaded({ scope, snapshot: data }); setError(null);
  }, [scope]);
  const editor = useToolSettingsEditor({ cwd, scope, sessionId, snapshot, onUpdated, onClose,
    onRefresh: () => { trust.refresh(); setRefresh(key => key + 1); } });
  useEffect(() => {
    let ignore = false, loading = false;
    scopeRef.current = scope; setLoaded(null); setError(null);
    const controller = new AbortController();
    const query = new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) });
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      const epoch = ++requestEpoch.current;
      try {
        const response = await fetch(`/api/tools?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!ignore && epoch === requestEpoch.current) { setLoaded({ scope, snapshot: data }); setError(null); }
      } catch (reason) {
        if (!ignore && epoch === requestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason));
      } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    const focus = () => { void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { ignore = true; requestEpoch.current++; controller.abort(); clearInterval(timer);
      window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [cwd, sessionId, refresh, scope]);
  return <ToolsModal title={t("tools.title")} subtitle={cwd} onClose={editor.close}>
    <nav className="tools-tabs" role="tablist" aria-label={t("tools.title")}>
      {(["mcp", "tools"] as const).map((value) => <button type="button" key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === "mcp" ? "MCP" : t("tools.tab")}</button>)}
    </nav>
    <div className="tools-content">
      <ToolError error={error} />
      {trust.trusted !== true && (tab === "tools" || snapshot?.mcpState !== "replaced") && <div className="tools-save-notice">
        <WorkspaceTrustNotice trust={trust} onTrusted={() => setRefresh(key => key + 1)} />
      </div>}
      {editor.changedElsewhere && <p className="tools-save-notice" role="status">{t("tools.draftChanged")}</p>}
      {editor.otherDrafts && <p className="tools-save-notice" role="status">{t("tools.otherDrafts")}</p>}
      {!snapshot && !error && <div className="tools-empty">{t("general.loading")}</div>}
      {snapshot && tab === "mcp" && (snapshot.mcpState === "replaced" ? <div className="tools-empty">{t("tools.mcpReplaced")}</div>
        : trust.trusted !== null && <McpPanel key={`${cwd}\0${trust.trusted}`} cwd={cwd} />)}
      {editor.viewSnapshot && tab === "tools" && <RegisteredToolsPanel key={scope} snapshot={editor.viewSnapshot} patches={editor.draft?.tools ?? {}}
        codemode={editor.draft?.codemode} withWorkspaceOverrides={editor.target === "workspace"} disabled={!!editor.saving || trust.granting || (editor.target === "workspace" && (trust.trusted !== true || !snapshot?.orchestration.trusted))} onToolChange={editor.editTool} onCodemodeChange={editor.editCodemode} />}
    </div>
    <footer className="tools-footer">
      {tab === "tools" && <div className="tools-save-actions">
        <select aria-label={t("tools.scope")} value={editor.target} disabled={!!editor.saving || trust.granting}
          onChange={event => editor.changeTarget(event.target.value as ToolSettingsTarget)}>
          <option value="global">{t("tools.scope.global")}</option>
          <option value="workspace">{t("tools.scope.workspace")}</option>
        </select>
        <button type="button" disabled={!editor.canSave || trust.granting || (editor.target === "workspace" && trust.trusted !== true)} title={editor.target === "workspace" && (trust.trusted !== true || !snapshot?.orchestration.trusted) ? t("tools.trustRequired") : undefined}
          onClick={() => void editor.save()}>{t("general.save")}</button>
        {editor.error && <span className="tools-save-error" role="alert">{t(editor.error)}</span>}
        {editor.dirty && <span className="tools-help" role="status">{t("tools.unsaved")}</span>}
      </div>}
      <button type="button" disabled={!!editor.saving || trust.granting} onClick={editor.refresh}>{t("tools.refresh")}</button>
      <button type="button" disabled={!!editor.saving} onClick={editor.close}>{t("general.close")}</button>
    </footer>
  </ToolsModal>;
}
