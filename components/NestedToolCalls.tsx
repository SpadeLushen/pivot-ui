"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatElapsed, readTiming } from "@/lib/timing-store";
import { nestedTreeRows, type NestedCallGroup, type NestedCallNode } from "@/lib/nested-tool-state";
import type { ToolResultView } from "@/lib/types";

export function NestedCallSummary({ group }: { group: NestedCallGroup }) {
  const { t } = useI18n();
  const parts = [t("nested.count", { count: group.calls.length })];
  for (const status of ["running", "ok", "error", "unfinished"] as const) {
    const count = group.calls.filter((call) => call.status === status).length;
    if (count) parts.push(t(`nested.${status}Count`, { count }));
  }
  return <span style={{ color: group.calls.some((call) => call.status === "error") ? "#d97706" : "var(--text-dim)", fontSize: 11, overflowWrap: "anywhere" }}>{parts.join(" · ")}</span>;
}

function statusDisplay(status: NestedCallNode["status"]) {
  return {
    color: status === "error" ? "#f87171" : status === "ok" ? "#16a34a" : "var(--text-dim)",
    icon: status === "running" ? "●" : status === "ok" ? "✓" : status === "error" ? "✕" : "—",
  };
}

export function NestedCallTrail({ group }: { group?: NestedCallGroup }) {
  const { t } = useI18n();
  const calls = group?.calls ?? [];
  const description = calls.map((call) => `${statusDisplay(call.status).icon}${call.name} (${t(`nested.${call.status}`)})`).join(" · ");
  return (
    <span role="img" title={description || t("nested.title")} aria-label={description || t("nested.title")} style={{ display: "flex", justifyContent: "flex-end", overflow: "hidden", flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
      {/* Intrinsic width clips the beginning on overflow; minWidth keeps short trails left-aligned. */}
      <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, width: "max-content", minWidth: "100%", whiteSpace: "nowrap", gap: 8 }}>
        {calls.map((call) => <span key={call.id}>{statusDisplay(call.status).icon}{call.name}</span>)}
      </span>
    </span>
  );
}

function parameterPreview(node: NestedCallNode): string {
  for (const key of ["path", "file_path", "command", "query", "name"]) {
    const value = node.arguments?.[key];
    if (typeof value === "string") return value.split(/\r?\n/, 1)[0].slice(0, 140);
  }
  return "";
}

function nodeDuration(node: NestedCallNode, group: NestedCallGroup, liveTools?: Map<string, number>, sessionId?: string): number | undefined {
  if (node.durationMs !== undefined) return node.durationMs;
  if (node.status === "unfinished" || (node.status === "running" && group.uncertain)) return undefined;
  return liveTools?.get(node.id) ?? (node.status !== "running" && sessionId ? readTiming(`tool:${sessionId}:${node.id}`) : undefined);
}

function NestedCallDetails({ node, depth, hasChildren, renderResult }: { node: NestedCallNode; depth: number; hasChildren: boolean; renderResult: (result: ToolResultView) => ReactNode }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: "4px 10px 10px", minWidth: 0 }}>
      {(depth >= 3 || hasChildren) && <div style={{ color: "var(--text-dim)", overflowWrap: "anywhere" }}>{t("nested.depth", { depth: depth + 1 })} · {t("nested.parent", { id: node.parentId })}</div>}
      <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{t("nested.arguments")}</div>
      {node.arguments === undefined ? <div style={{ color: "var(--text-dim)" }}>{node.argumentsBytes === undefined ? t("nested.argumentsMissing") : t("nested.argumentsOmitted", { bytes: node.argumentsBytes })}</div> : (
        <pre style={{ margin: "0 0 8px", maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, color: "var(--text-muted)" }}>{JSON.stringify(node.arguments, null, 2)}</pre>
      )}
      {node.error && <pre style={{ color: "#f87171", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{node.error}</pre>}
      {node.preview ? (
        <>
          <div style={{ color: "var(--text-dim)", margin: "6px 0" }}>{t("nested.transientResult")}</div>
          {renderResult(node.preview)}
          {node.previewTruncated && <div style={{ color: "var(--text-dim)" }}>{t("nested.previewTruncated")}</div>}
        </>
      ) : <div style={{ color: "var(--text-dim)", marginTop: 6 }}>{t(node.previewOmitted ? "nested.previewOmitted" : node.status === "running" ? "nested.resultPending" : "nested.resultUnavailable")}</div>}
    </div>
  );
}

function NestedCallRow({ node, depth, orphan, hasChildren, open, duration, onToggle, renderResult }: {
  node: NestedCallNode; depth: number; orphan: boolean; hasChildren: boolean; open: boolean;
  duration?: number; onToggle: () => void; renderResult: (result: ToolResultView) => ReactNode;
}) {
  const { t } = useI18n();
  const { color, icon } = statusDisplay(node.status);
  return (
    <div style={{ marginLeft: Math.min(depth, 3) * 12, borderTop: "1px solid var(--border)", minWidth: 0 }}>
      <button aria-expanded={open} onClick={onToggle} style={{ display: "flex", gap: 6, alignItems: "center", width: "100%", padding: "7px 10px", border: "none", background: "none", textAlign: "left", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, minWidth: 0 }}>
        <ChevronDown size={10} aria-hidden="true" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none" }} />
        <span aria-hidden="true" style={{ color, flexShrink: 0 }}>{icon}</span>
        <span title={node.name} style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>{node.name}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)" }}>{parameterPreview(node)}</span>
        <span style={{ color, flexShrink: 0 }}>{t(`nested.${node.status}`)}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{duration !== undefined ? formatElapsed(duration) : "—"}</span>
      </button>
      {orphan && <div style={{ padding: "0 10px 5px", color: "var(--text-dim)" }}>{t("nested.orphan")}</div>}
      {node.error && !open && <div style={{ padding: "0 10px 5px", color, overflowWrap: "anywhere" }}>{node.error.slice(0, 140)}</div>}
      {open && <NestedCallDetails node={node} depth={depth} hasChildren={hasChildren} renderResult={renderResult} />}
    </div>
  );
}

export function NestedToolCalls({ rootId, group, sessionId, liveTools, renderResult }: {
  rootId: string;
  group: NestedCallGroup;
  sessionId?: string;
  liveTools?: Map<string, number>;
  renderResult: (result: ToolResultView) => ReactNode;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(new Set<string>());
  const [limit, setLimit] = useState(20);
  const rows = useMemo(() => nestedTreeRows(rootId, group.calls, expanded), [rootId, group.calls, expanded]);
  return (
    <details open style={{ borderTop: "1px solid var(--border)", fontSize: 12, background: "var(--bg-panel)" }}>
      <summary style={{ padding: "8px 10px", cursor: "pointer", color: "var(--text-muted)" }}>{t("nested.title")} · <NestedCallSummary group={group} /></summary>
      {!group.complete && <div style={{ padding: "0 10px 6px", color: "var(--text-dim)" }}>{t("nested.incomplete")}</div>}
      {group.uncertain && <div role="status" style={{ padding: "0 10px 6px", color: "var(--text-dim)" }}>{t("nested.uncertain")}</div>}
      {rows.slice(0, limit).map(({ node, depth, orphan, hasChildren }) => (
        <NestedCallRow key={node.id} node={node} depth={depth} orphan={orphan} hasChildren={hasChildren}
          open={expanded.has(node.id)} renderResult={renderResult}
          duration={nodeDuration(node, group, liveTools, sessionId)}
          onToggle={() => setExpanded((old) => { const next = new Set(old); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} />
      ))}
      {rows.length > limit && <button onClick={() => setLimit((value) => value + 20)} style={{ margin: "8px 10px", color: "var(--accent)", border: "none", background: "none", cursor: "pointer" }}>{t("nested.more", { count: rows.length - limit })}</button>}
    </details>
  );
}
