"use client";
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NativeMcpEditorServer, NativeMcpEditorSnapshot, NativeMcpScope } from "@/lib/api-types";
import { ToolError, ToolSwitch } from "./ToolsControls";
import { McpEditorDialog } from "./McpEditorDialog";
import { McpRuntimeDetails } from "./McpRuntimeDetails";
import { useWorkspacePackRevision } from "@/hooks/useWorkspacePackRevision";

export function McpPanel({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<NativeMcpEditorSnapshot | null>(null);
  const [selected, setSelected] = useState(""), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ scope: NativeMcpScope; serverKey?: string } | null>(null);
  const packRevision = useWorkspacePackRevision(cwd), requestEpoch = useRef(0);
  useEffect(() => {
    let ignore = false; setError(null); setSnapshot(null);
    const epoch = ++requestEpoch.current, controller = new AbortController();
    void fetch(`/api/mcp/servers?scope=${cwd ? "project" : "global"}&cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data as NativeMcpEditorSnapshot; })
      .then((data) => { if (!ignore && epoch === requestEpoch.current) setSnapshot(data); })
      .catch((reason) => { if (!ignore && epoch === requestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { ignore = true; requestEpoch.current++; controller.abort(); };
  }, [cwd, refresh, packRevision]);
  const active = snapshot?.servers.find((server) => server.serverKey === selected) ?? snapshot?.servers[0];
  const activeOverride = !!active?.overridesGlobal && !active.managedByPack;
  const change = async (server: NativeMcpEditorServer, method: "PATCH" | "DELETE", enabled?: boolean) => {
    if (!snapshot) return;
    if (method === "DELETE" && !confirm(t("mcp.removeProjectConfirm"))) return;
    const epoch = ++requestEpoch.current;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/mcp/servers", { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "project", cwd, revision: snapshot.revision, serverKey: server.serverKey, ...(enabled !== undefined ? { enabled } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (epoch === requestEpoch.current) setSnapshot(data);
    } catch (reason) { if (epoch === requestEpoch.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="tools-layout">
    <aside className="tools-list"><div className="tools-list-scroll">
      {!snapshot && !error && <p className="tools-help">{t("general.loading")}</p>}
      {snapshot?.servers.length === 0 && <p className="tools-help">{t("mcp.noConfiguredServers")}</p>}
      {snapshot && [
        { label: t("mcp.packManaged"), servers: snapshot.servers.filter((server) => server.managedByPack) },
        { label: t("mcp.global"), servers: snapshot.servers.filter((server) => !server.managedByPack && !server.overridesGlobal && server.source === "global") },
        { label: t("mcp.workspaceOverride"), servers: snapshot.servers.filter((server) => !server.managedByPack && server.overridesGlobal) },
        { label: t("app.workspace"), servers: snapshot.servers.filter((server) => !server.managedByPack && !server.overridesGlobal && server.source === "project") },
      ].filter((group) => group.servers.length).map((group) => <div key={group.label}><div className="tools-group">{group.label}</div>
        {group.servers.map((server) => <button type="button" key={server.serverKey} className={`tools-row${active?.serverKey === server.serverKey ? " selected" : ""}`} onClick={() => setSelected(server.serverKey)}>
          <i className={server.enabled ? "enabled" : ""} /><span>{server.serverKey}</span>
        </button>)}
      </div>)}
    </div><div className="tools-list-footer"><button type="button" onClick={() => setEditor({ scope: "global" })}><Plus size={13} />{t("mcp.addServer")}</button></div></aside>
    <div className="tools-details"><ToolError error={error} />
      {active ? <>
        <div className="tools-detail-heading"><h3>{active.serverKey}</h3>
          <span className={`tools-badge${activeOverride ? " tools-override-badge" : ""}`}>
            {t(activeOverride ? "mcp.workspaceOverride" : active.source === "global" ? "mcp.global" : "app.workspace")}
            {activeOverride && active.workspaceDefinition && <button type="button" className="tools-badge-remove" disabled={saving || active.managedByPack}
              onClick={() => void change(active, "DELETE")} aria-label={t("mcp.removeOverride")}
              title={t(active.managedByPack ? "mcp.overridePackManaged" : "mcp.removeOverride")}><X size={11} aria-hidden="true" /></button>}
          </span>
          {active.managedByPack && <span className="tools-badge">{t("mcp.packManaged")}</span>}
          <button type="button" onClick={() => setEditor({ scope: active.editScope, serverKey: active.serverKey })} aria-label={t("mcp.editServer")}><Pencil size={14} /></button>
          <ToolSwitch variant="compact" label={t("tools.workspaceEnabled")} title={active.managedByPack ? `${t("tools.workspaceEnabled")} — ${t("tools.packSwitchHelp")}` : undefined} checked={active.enabled} disabled={!cwd || saving || active.managedByPack || !!active.validationError} onChange={(enabled) => void change(active, "PATCH", enabled)} />
          {active.workspaceDefinition && !active.overridesGlobal && !active.managedByPack && <button type="button" disabled={saving} onClick={() => void change(active, "DELETE")} aria-label={t("mcp.removeEntry")}><Trash2 size={14} /></button>}
        </div>
        <ToolError error={active.validationError ?? null} />
        {active.description && <p className="tools-description">{active.description}</p>}
        <McpRuntimeDetails key={`${cwd}:${active.serverKey}:${snapshot?.revision}`} cwd={cwd} server={active} />
        <label className="tools-field">{t("mcp.definition")}<pre>{JSON.stringify(active.definition, null, 2)}</pre></label>
      </> : <div className="tools-empty">{t("mcp.selectServer")}</div>}
    </div>
    {editor && <McpEditorDialog cwd={cwd} {...editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh((key) => key + 1); }} />}
  </div>;
}
