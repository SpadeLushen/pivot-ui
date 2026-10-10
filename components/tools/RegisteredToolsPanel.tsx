"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { TOOL_EXPOSURES, type ManagedToolInfo, type ToolsSnapshot } from "@/lib/tool-settings-types";
import { ToolSwitch, ToolError } from "./ToolsControls";

export function RegisteredToolsPanel({ cwd, sessionId, snapshot, onUpdated }: {
  cwd: string; sessionId?: string; snapshot: ToolsSnapshot; onUpdated: (snapshot: ToolsSnapshot) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const active = snapshot.tools.find((tool) => tool.name === selected) ?? snapshot.tools[0];
  const update = async (tool: ManagedToolInfo, patch: Partial<Pick<ManagedToolInfo, "enabled" | "exposure">>) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/tools", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, sessionId, revision: snapshot.revision, name: tool.name, enabled: tool.enabled, exposure: tool.exposure, ...patch }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      onUpdated(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="tools-layout">
    <aside className="tools-list"><div className="tools-list-scroll">
      {(["builtin", "extension"] as const).map((source) => <div key={source}>
        <div className="tools-group">{t(source === "builtin" ? "tools.builtin" : "tools.extension")}</div>
        {snapshot.tools.filter((tool) => tool.source === source).map((tool) => <button type="button" className={`tools-row${active?.name === tool.name ? " selected" : ""}`} key={tool.name} onClick={() => { setSelected(tool.name); setError(null); }}>
          <i className={tool.enabled && tool.exposure !== "hidden" ? "enabled" : ""} /><span>{tool.name}</span>
        </button>)}
      </div>)}
    </div></aside>
    <div className="tools-details"><ToolError error={error} />
      {active ? <>
        <div className="tools-detail-heading tools-tool-heading">
          <h3>{active.name}</h3><span className="tools-badge tools-source-badge" title={active.sourcePath}>{active.source === "extension" ? active.sourceName ?? t("tools.extension") : t("tools.builtin")}</span>
          <ToolSwitch variant="compact" label={t("tools.workspaceEnabled")} title={active.ownerHidden ? `${t("tools.workspaceEnabled")} — ${t("tools.ownerHidden")}` : undefined} checked={active.enabled} disabled={saving || active.ownerHidden} onChange={(enabled) => void update(active, { enabled })} />
        </div>
        <label className="tools-field">{t("tools.exposure")}<select value={active.exposure} disabled={saving || active.ownerHidden} onChange={(event) => void update(active, { exposure: event.target.value as ManagedToolInfo["exposure"] })}>
          {TOOL_EXPOSURES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <p className="tools-help">{t(`tools.exposure.${active.exposure}`)}</p>
        <p className="tools-description">{active.description}</p>
        <label className="tools-field">{t("tools.source")}<code>{active.sourcePath}</code></label>
        {active.parameters !== undefined && <label className="tools-field">{t("tools.parameters")}<pre>{JSON.stringify(active.parameters, null, 2)}</pre></label>}
        <p className="tools-help">{t("tools.workspaceHelp")}</p>
      </> : <div className="tools-empty">{t("tools.noTools")}</div>}
    </div>
  </div>;
}
