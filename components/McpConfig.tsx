"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ToolsSnapshot } from "@/lib/tool-settings-types";
import { ToolsModal, ToolError } from "./tools/ToolsControls";
import { McpPanel } from "./tools/McpPanel";
import { RegisteredToolsPanel } from "./tools/RegisteredToolsPanel";

export function ToolsConfig({ cwd, sessionId, onClose }: { cwd: string; sessionId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"mcp" | "tools">("mcp");
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null), [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let ignore = false; setSnapshot(null); setError(null);
    const query = new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) });
    void fetch(`/api/tools?${query}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data as ToolsSnapshot; })
      .then((data) => { if (!ignore) setSnapshot(data); })
      .catch((reason) => { if (!ignore) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { ignore = true; };
  }, [cwd, sessionId, refresh]);
  return <ToolsModal title={t("tools.title")} subtitle={cwd} onClose={onClose}>
    <nav className="tools-tabs" role="tablist" aria-label={t("tools.title")}>
      {(["mcp", "tools"] as const).map((value) => <button type="button" key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === "mcp" ? "MCP" : t("tools.tab")}</button>)}
    </nav>
    <div className="tools-content">
      <ToolError error={error} />
      {!snapshot && !error && <div className="tools-empty">{t("general.loading")}</div>}
      {snapshot && tab === "mcp" && (snapshot.mcpState === "replaced" ? <div className="tools-empty">{t("tools.mcpReplaced")}</div> : <McpPanel key={cwd} cwd={cwd} />)}
      {snapshot && tab === "tools" && <RegisteredToolsPanel key={cwd} cwd={cwd} sessionId={sessionId} snapshot={snapshot} onUpdated={setSnapshot} />}
    </div>
    <footer className="tools-footer"><button type="button" onClick={() => setRefresh((key) => key + 1)}>{t("tools.refresh")}</button><button type="button" onClick={onClose}>{t("general.close")}</button></footer>
  </ToolsModal>;
}
