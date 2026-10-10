"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import type { NativeMcpEditorSnapshot, NativeMcpScope } from "@/lib/api-types";
import { ToolsModal, ToolSwitch, ToolError } from "./ToolsControls";
import { McpFormFields } from "./McpFormFields";
import { buildMcpFormDefinition, isMcpWorkspaceOverride, mcpFormValues } from "@/lib/mcp-editor-form";

const DEFAULT: Record<string, unknown> = { type: "stdio", enabled: false };
export function McpEditorDialog({ cwd, scope: initialScope, serverKey: initialKey, onClose, onSaved }: {
  cwd: string; scope: NativeMcpScope; serverKey?: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState(initialScope), [serverKey, setServerKey] = useState(initialKey ?? "");
  const [definition, setDefinition] = useState(DEFAULT), [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState(() => mcpFormValues(DEFAULT));
  const [initialForm, setInitialForm] = useState(() => mcpFormValues(DEFAULT));
  const [initialEnabled, setInitialEnabled] = useState(false);
  const [revision, setRevision] = useState(""), [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false), [packManaged, setPackManaged] = useState(false);
  const [overridesGlobal, setOverridesGlobal] = useState(false);
  const override = isMcpWorkspaceOverride(scope, definition);
  useEffect(() => {
    let ignore = false; setReady(false); setError(null); setRevision("");
    void fetch(`/api/mcp/servers?scope=${scope}&cwd=${encodeURIComponent(cwd)}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data as NativeMcpEditorSnapshot; })
      .then((data) => {
        if (ignore) return;
        const server = initialKey ? data.servers.find((item) => item.serverKey === initialKey && !item.inherited) : undefined;
        if (initialKey && !server) { setError(t("mcp.noServersAvailable")); return; }
        setRevision(data.revision); setFilePath(data.filePath);
        const baseline = server ? scope === "project" ? server.workspaceDefinition ?? server.definition : server.definition : DEFAULT;
        const fields = mcpFormValues(server && isMcpWorkspaceOverride(scope, baseline) ? server.definition : baseline);
        setDefinition(baseline); setForm(fields); setInitialForm(fields);
        setEnabled(server ? server.enabled : false); setInitialEnabled(server ? server.enabled : false);
        setPackManaged(server?.managedByPack ?? false);
        setOverridesGlobal(server?.overridesGlobal ?? false); setReady(true);
      }).catch((reason) => { if (!ignore) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { ignore = true; };
  }, [cwd, scope, initialKey]);
  const save = async (remove = false) => {
    if (!ready || !revision || saving) return;
    if (remove && !confirm(t(scope === "global" ? "mcp.removeGlobalConfirm" : "mcp.removeProjectConfirm"))) return;
    setSaving(true); setError(null);
    try {
      const value = remove ? {} : buildMcpFormDefinition(definition, initialForm, form, enabled, initialEnabled, override);
      const response = await fetch("/api/mcp/servers", { method: remove ? "DELETE" : initialKey ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, cwd, serverKey: serverKey.trim(), revision, ...(!remove ? { definition: value } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : String(reason)); }
    finally { setSaving(false); }
  };
  const dismiss = () => { if (!saving) onClose(); };
  return createPortal(<ToolsModal title={t(initialKey ? "mcp.editServer" : "mcp.addServer")} onClose={dismiss} editor>
    <form className="tools-editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="tools-field">{t("mcp.scope")}<select value={scope} disabled={!!initialKey || saving} onChange={(event) => setScope(event.target.value as NativeMcpScope)}>
        <option value="global">{t("mcp.global")}</option><option value="project" disabled={!cwd}>{t("app.workspace")}</option>
      </select></label>
      <code className="tools-help">{filePath}</code>
      {!ready && !error && <p className="tools-help">{t("general.loading")}</p>}
      <label className="tools-field">{t("mcp.serverName")}<input value={serverKey} required pattern={"[A-Za-z0-9_\\-]+"} disabled={!!initialKey || saving || !ready} onChange={(event) => setServerKey(event.target.value)} placeholder="chrome-devtools" autoFocus={!initialKey} /></label>
      <ToolSwitch variant="inline" label={t(scope === "global" ? "tools.globalDefaultEnabled" : "tools.workspaceEnabled")} checked={enabled} disabled={saving || !ready || packManaged} onChange={setEnabled} />
      <McpFormFields value={form} onChange={setForm} disabled={!ready || saving} override={override} />
      <p className="tools-help">{t(initialKey ? "mcp.secretHelp" : "mcp.credentialCommandsHelp")}</p>
      {override && <p className="tools-help">{t("mcp.projectOverrideHelp")}</p>}
      <ToolError error={error} />
      <div className="tools-editor-actions">
        {initialKey && <button type="button" className="danger" disabled={!ready || saving || packManaged} onClick={() => void save(true)}>{t(scope === "project" && overridesGlobal ? "mcp.removeOverride" : "general.delete")}</button>}
        <button type="button" disabled={saving} onClick={dismiss}>{t("general.cancel")}</button>
        <button type="submit" disabled={!ready || saving || !serverKey.trim()}>{saving ? t("general.saving") : t(initialKey ? "general.save" : "general.add")}</button>
      </div>
    </form>
  </ToolsModal>, document.body);
}
