"use client";
import { Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MappingRow, McpFormValues } from "@/lib/mcp-editor-form";
import { MCP_SECRET_PLACEHOLDER } from "@/lib/native-mcp-editor-secrets";

function MappingFields({ label, rows, onChange, disabled }: {
  label: string; rows: MappingRow[]; onChange: (rows: MappingRow[]) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  return <fieldset className="tools-form-rows" disabled={disabled}>
    <legend>{label}</legend>
    {rows.map((row, index) => <div className="tools-mapping-row" key={row.id}>
      <input aria-label={`${label} ${index + 1} ${t("mcp.fieldKey")}`} placeholder={t("mcp.fieldKey")} required value={row.key}
        onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, key: event.target.value } : item))} />
      <input aria-label={`${label} ${index + 1} ${t("mcp.fieldValue")}`} placeholder={t("mcp.fieldValue")} value={row.value} autoComplete="off"
        onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} />
      <button type="button" aria-label={`${t("general.remove")} ${label} ${index + 1}`} onClick={() => onChange(rows.filter((item) => item.id !== row.id))}><X size={14} /></button>
    </div>)}
    <button type="button" className="tools-form-add" onClick={() => onChange([...rows, { id: rows.reduce((max, row) => Math.max(max, row.id), -1) + 1, key: "", value: "" }])}><Plus size={13} />{t("general.add")}</button>
  </fieldset>;
}

function ArgumentFields({ rows, onChange, disabled }: {
  rows: McpFormValues["args"]; onChange: (rows: McpFormValues["args"]) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  return <fieldset className="tools-form-rows" disabled={disabled}>
    <legend>{t("mcp.arguments")}</legend>
    {rows.map((row, index) => <div className="tools-argument-row" key={row.id}>
      <input aria-label={`${t("mcp.arguments")} ${index + 1}`} value={row.value} autoComplete="off"
        onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} />
      <button type="button" aria-label={`${t("general.remove")} ${t("mcp.arguments")} ${index + 1}`} onClick={() => onChange(rows.filter((item) => item.id !== row.id))}><X size={14} /></button>
    </div>)}
    <button type="button" className="tools-form-add" onClick={() => onChange([...rows, { id: rows.reduce((max, row) => Math.max(max, row.id), -1) + 1, value: "" }])}><Plus size={13} />{t("general.add")}</button>
  </fieldset>;
}

export function McpFormFields({ value, onChange, disabled, override }: {
  value: McpFormValues; onChange: (value: McpFormValues) => void; disabled: boolean; override: boolean;
}) {
  const { t } = useI18n();
  function set<K extends keyof McpFormValues>(key: K, next: McpFormValues[K]) { onChange({ ...value, [key]: next }); }
  return <>
    <div className="tools-form-grid">
      <label className="tools-field">{t("mcp.transport")}<select value={value.type} disabled={disabled || override} onChange={(event) => set("type", event.target.value as McpFormValues["type"])}>
        <option value="stdio">stdio</option><option value="http">http</option>
      </select></label>
      <label className="tools-field">{t("tools.exposure")}<select value={value.exposure} disabled={disabled} onChange={(event) => set("exposure", event.target.value as McpFormValues["exposure"])}>
        {(["codemode", "deferred", "direct", "hidden"] as const).map((exposure) => <option key={exposure} value={exposure}>{exposure}</option>)}
      </select></label>
    </div>
    <label className="tools-field">{t("general.description")}<textarea className="tools-form-description" rows={2} value={value.description} disabled={disabled || override} onChange={(event) => set("description", event.target.value)} /></label>
    <label className="tools-field">{t("mcp.timeoutSeconds")}<input type="number" step="any" placeholder="60" value={value.timeout} disabled={disabled || override} onChange={(event) => set("timeout", event.target.value)} /></label>
    <p className="tools-help">{t(`tools.exposure.${value.exposure}`)}</p>
    {value.type === "stdio" ? <>
      <label className="tools-field">{t("mcp.command")}<input required value={value.command} disabled={disabled || override} placeholder="npx" onChange={(event) => set("command", event.target.value)} /></label>
      <ArgumentFields rows={value.args} disabled={disabled || override} onChange={(rows) => set("args", rows)} />
      <MappingFields label="env" rows={value.env} disabled={disabled || override} onChange={(rows) => set("env", rows)} />
      <label className="tools-field">cwd<input value={value.cwd} disabled={disabled || override} onChange={(event) => set("cwd", event.target.value)} /></label>
    </> : <>
      <label className="tools-field">url<input required type={value.url === MCP_SECRET_PLACEHOLDER ? "text" : "url"} value={value.url} disabled={disabled || override} placeholder="https://example.com/mcp" autoComplete="off" onChange={(event) => set("url", event.target.value)} /></label>
      <MappingFields label="headers" rows={value.headers} disabled={disabled || override} onChange={(rows) => set("headers", rows)} />
    </>}
  </>;
}
