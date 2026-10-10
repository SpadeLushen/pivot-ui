"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ManagedToolInfo, ToolsSnapshot } from "@/lib/tool-settings-types";
import { ToolError } from "./ToolsControls";

export function ToolRuntimeDetails({ cwd, sessionId, tool, snapshot, onUpdated }: {
  cwd: string; sessionId?: string; tool: ManagedToolInfo; snapshot: ToolsSnapshot;
  onUpdated: (value: ToolsSnapshot) => void;
}) {
  const { t } = useI18n(), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const application = snapshot.application, runtime = tool.runtime;
  const status = (value: boolean | null | undefined) => t(value == null ? "tools.unknown" : value ? "tools.yes" : "tools.no");
  const retry = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/tools", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, sessionId, action: "retry" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      onUpdated(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <section className="tools-runtime">
    <h4>{t("tools.runtime")}</h4><ToolError error={error} />
    <p className="tools-help" role="status">{application ? t(`tools.application.${application.state}`) : t("tools.noRuntime")}</p>
    {application && <code>{application.sessionId}</code>}
    {application?.state === "failed" && <button type="button" disabled={saving || application.running} onClick={() => void retry()}>{t("tools.retryApply")}</button>}
    <dl className="tools-runtime-fields">
      <dt>{t("tools.registered")}</dt><dd>{status(runtime ? true : null)}</dd>
      <dt>{t("tools.active")}</dt><dd>{status(runtime?.active)}</dd>
      <dt>{t("tools.callable")}</dt><dd>{status(runtime?.callable)}</dd>
      <dt>{t("tools.runtimeExposure")}</dt><dd>{runtime?.exposure ?? t("tools.unknown")}</dd>
      <dt>{t("tools.declared")}</dt><dd>{t("tools.unknown")}</dd>
    </dl>
    {tool.name === "codemode" && application?.codemode && <p className="tools-help">{t("tools.runtimeSettings", {
      mode: application.codemode.mode, budget: application.codemode.inlineBudget,
    })}</p>}
    <p className="tools-help">{t("tools.declarationUnknown")}</p>
    {snapshot.indirectUnavailable && <p className="tools-help" role="status">{t("tools.indirectUnavailable")}</p>}
  </section>;
}
