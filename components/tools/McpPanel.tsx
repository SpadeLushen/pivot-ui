"use client";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NativeMcpEditorServer, NativeMcpEditorSnapshot, NativeMcpScope } from "@/lib/api-types";
import { ToolError, ToolSwitch } from "./ToolsControls";
import { McpEditorDialog } from "./McpEditorDialog";

export function McpPanel({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<NativeMcpEditorSnapshot | null>(null);
  const [selected, setSelected] = useState(""), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ scope: NativeMcpScope; serverKey?: string } | null>(null);
  useEffect(() => {
    let ignore = false; setError(null); setSnapshot(null);
    void fetch(`/api/mcp/servers?scope=${cwd ? "project" : "global"}&cwd=${encodeURIComponent(cwd)}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data as NativeMcpEditorSnapshot; })
      .then((data) => { if (!ignore) setSnapshot(data); })
      .catch((reason) => { if (!ignore) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { ignore = true; };
  }, [cwd, refresh]);
  const active = snapshot?.servers.find((server) => server.serverKey === selected) ?? snapshot?.servers[0];
  const change = async (server: NativeMcpEditorServer, method: "PATCH" | "DELETE", enabled?: boolean) => {
    if (!snapshot) return;
    if (method === "DELETE" && !confirm(t("mcp.removeProjectConfirm"))) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/mcp/servers", { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "project", cwd, revision: snapshot.revision, serverKey: server.serverKey, ...(enabled !== undefined ? { enabled } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSnapshot(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="tools-layout">
    <aside className="tools-list"><div className="tools-list-scroll">
      {!snapshot && !error && <p className="tools-help">{t("general.loading")}</p>}
      {snapshot?.servers.length === 0 && <p className="tools-help">{t("mcp.noConfiguredServers")}</p>}
      {snapshot && [
        { label: t("mcp.packManaged"), servers: snapshot.servers.filter((server) => server.managedByPack) },
        { label: t("mcp.global"), servers: snapshot.servers.filter((server) => !server.managedByPack && server.editScope === "global") },
        { label: t("app.workspace"), servers: snapshot.servers.filter((server) => !server.managedByPack && server.editScope === "project") },
      ].filter((group) => group.servers.length).map((group) => <div key={group.label}><div className="tools-group">{group.label}</div>
        {group.servers.map((server) => <button type="button" key={server.serverKey} className={`tools-row${active?.serverKey === server.serverKey ? " selected" : ""}`} onClick={() => setSelected(server.serverKey)}>
          <i className={server.enabled ? "enabled" : ""} /><span>{server.serverKey}</span>
        </button>)}
      </div>)}
    </div><div className="tools-list-footer"><button type="button" onClick={() => setEditor({ scope: "global" })}><Plus size={13} />{t("mcp.addServer")}</button></div></aside>
    <div className="tools-details"><ToolError error={error} />
      {active ? <>
        <div className="tools-detail-heading"><h3>{active.serverKey}</h3><span className="tools-badge">{t(active.editScope === "global" ? "mcp.global" : "app.workspace")}</span>
          {active.managedByPack && <span className="tools-badge">{t("mcp.packManaged")}</span>}
          <button type="button" onClick={() => setEditor({ scope: active.editScope, serverKey: active.serverKey })} aria-label={t("mcp.editServer")}><Pencil size={14} /></button>
          <ToolSwitch variant="compact" label={t("tools.workspaceEnabled")} title={active.managedByPack ? `${t("tools.workspaceEnabled")} — ${t("tools.packSwitchHelp")}` : undefined} checked={active.enabled} disabled={!cwd || saving || active.managedByPack || !!active.validationError} onChange={(enabled) => void change(active, "PATCH", enabled)} />
          {active.workspaceDefinition && !active.managedByPack && <button type="button" disabled={saving} onClick={() => void change(active, "DELETE")} aria-label={t("mcp.removeEntry")}><Trash2 size={14} /></button>}
        </div>
        <ToolError error={active.validationError ?? null} />
        {active.description && <p className="tools-description">{active.description}</p>}
        <label className="tools-field">{t("mcp.connection")}<code>{typeof active.definition.url === "string" ? active.definition.url : [active.definition.command, ...Array.isArray(active.definition.args) ? active.definition.args : []].join(" ")}</code></label>
        <label className="tools-field">{t("mcp.definition")}<pre>{JSON.stringify(active.definition, null, 2)}</pre></label>
      </> : <div className="tools-empty">{t("mcp.selectServer")}</div>}
    </div>
    {editor && <McpEditorDialog cwd={cwd} {...editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh((key) => key + 1); }} />}
  </div>;
}
