"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { TOOL_EXPOSURES, type ToolsSnapshot, type ToolRulePatch, type ToolExposure } from "@/lib/tool-settings-types";
import { ToolSwitch } from "./ToolsControls";
import { CodemodeSettings, type CodemodeDraft } from "./CodemodeSettings";

export function RegisteredToolsPanel({ snapshot, patches, codemode, withWorkspaceOverrides, disabled, onToolChange, onCodemodeChange }: {
  snapshot: ToolsSnapshot; patches: Record<string, ToolRulePatch>; codemode?: CodemodeDraft; withWorkspaceOverrides: boolean; disabled: boolean;
  onToolChange: (name: string, patch: ToolRulePatch) => void; onCodemodeChange: (patch: CodemodeDraft) => void;
}) {
  const { t } = useI18n(), [selected, setSelected] = useState("");
  const tools = snapshot.tools.map(tool => {
    const patch = patches[tool.name];
    return { ...tool, enabled: !tool.ownerHidden && (patch?.enabled === null ? tool.inherited.enabled : patch?.enabled ?? tool.enabled),
      exposure: tool.ownerHidden ? "hidden" as const : patch?.exposure === null ? tool.inherited.exposure : patch?.exposure ?? tool.exposure };
  });
  const active = tools.find(tool => tool.name === selected) ?? tools[0];
  return <div className="tools-layout">
    <aside className="tools-list"><div className="tools-list-scroll">
      {(["builtin", "extension"] as const).map(source => <div key={source}>
        <div className="tools-group">{t(source === "builtin" ? "tools.builtin" : "tools.extension")}</div>
        {tools.filter(tool => tool.source === source).map(tool => <button type="button" className={`tools-row${active?.name === tool.name ? " selected" : ""}`} key={tool.name} onClick={() => setSelected(tool.name)}>
          <i className={tool.enabled && tool.exposure !== "hidden" ? "enabled" : ""} /><span>{tool.name}</span>
        </button>)}
      </div>)}
    </div></aside>
    <div className="tools-details">
      {active ? <>
        <div className="tools-detail-heading tools-tool-heading">
          <h3>{active.name}</h3><span className="tools-badge tools-source-badge" title={active.sourcePath}>{active.source === "extension" ? active.sourceName ?? t("tools.extension") : t("tools.builtin")}</span>
          <span className="tools-enabled-control">
            <span className={`tools-field-title${withWorkspaceOverrides && active.enabled !== active.inherited.enabled ? " tools-field-overridden" : ""}`}>{t("tools.enabled")}</span>
            <ToolSwitch variant="compact" label={t("tools.enabled")} title={active.ownerHidden ? t("tools.ownerHidden") : undefined}
              checked={active.enabled} disabled={disabled || active.ownerHidden} onChange={enabled => onToolChange(active.name, { enabled })} />
          </span>
        </div>
        <label className="tools-field"><span className={`tools-field-title${withWorkspaceOverrides && active.exposure !== active.inherited.exposure ? " tools-field-overridden" : ""}`}>{t("tools.exposure")}</span><select value={active.exposure} disabled={disabled || active.ownerHidden}
          onChange={event => onToolChange(active.name, { exposure: event.target.value as ToolExposure })}>
          {TOOL_EXPOSURES.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <p className="tools-help">{t(`tools.exposure.${active.exposure}`)}</p>
        {active.name === "codemode" && <CodemodeSettings settings={snapshot.orchestration} draft={codemode} withWorkspaceOverrides={withWorkspaceOverrides} disabled={disabled} onChange={onCodemodeChange} />}
        {snapshot.orchestration.nativeState !== "available" && !snapshot.tools.some(tool => tool.name === "codemode") && <p className="tools-help">{t(`tools.native.${snapshot.orchestration.nativeState}`)}</p>}
        <p className="tools-description">{active.description}</p>
        {active.parameters !== undefined && <label className="tools-field">{t("tools.parameters")}<pre>{JSON.stringify(active.parameters, null, 2)}</pre></label>}
      </> : <div className="tools-empty">{t("tools.noTools")}</div>}
    </div>
  </div>;
}
