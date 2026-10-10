"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type {
  AppliedPackInfo,
  ApplyPreviewResponse,
  SkillPackInfo,
} from "@/lib/api-types";
import { useI18n } from "@/lib/i18n";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { useWorkspacePackRevision, announceWorkspacePackChange } from "@/hooks/useWorkspacePackRevision";
import { confirmWorkspaceTrust, requiresWorkspaceTrust, workspacePackBlockMessages, WorkspacePackRequestError, type WorkspacePackErrorResponse } from "@/lib/workspace-pack-feedback";

export function WorkspacePacks({
  cwd,
  onApplied,
  refreshKey,
}: {
  cwd: string;
  onApplied: () => void;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const revision = useWorkspacePackRevision(cwd);
  const [applied, setApplied] = useState<AppliedPackInfo[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [skipped, setSkipped] = useState<{ packId: string; skillKey?: string; serverKey?: string; reason: string }[]>([]);
  const [packs, setPacks] = useState<SkillPackInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<ApplyPreviewResponse | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [wsRes, packsRes] = await Promise.all([
        fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`),
        fetch("/api/skill-packs"),
      ]);
      const ws = (await wsRes.json()) as {
        appliedPacks?: AppliedPackInfo[];
        skippedConflicts?: { packId: string; skillKey?: string; serverKey?: string; reason: string }[];
        revision?: number;
        error?: string;
      };
      const p = (await packsRes.json()) as { packs?: SkillPackInfo[]; error?: string };
      if (ws.error) throw new Error(ws.error);
      if (p.error) throw new Error(p.error);
      setApplied(ws.appliedPacks ?? []);
      setWorkspaceRevision(ws.revision ?? 0);
      setSkipped(ws.skippedConflicts ?? []);
      setPacks(p.packs ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, [cwd]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey, revision]);

  const removeTag = async (packId: string) => {
    try {
      const res = await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}&packId=${encodeURIComponent(packId)}&workspaceRevision=${workspaceRevision}`, { method: "DELETE" });
      const data = (await res.json()) as WorkspacePackErrorResponse;
      if (!res.ok || data.error) throw new WorkspacePackRequestError({ ...data, error: data.error ?? `HTTP ${res.status}` }, t);
      announceWorkspacePackChange(cwd);
      await load();
      onApplied();
    } catch (e) {
      setError(String(e));
    }
  };

  const runPreview = async (packIds: string[]) => {
    const res = await fetch("/api/workspace-skill-packs/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, packIds }),
    });
    const data = (await res.json()) as ApplyPreviewResponse & { error?: string };
    if (!res.ok || data.error) throw new WorkspacePackRequestError({ ...data, error: data.error ?? `HTTP ${res.status}` }, t);
    return data;
  };

  const runApply = async (packIds: string[], confirmedPlan: ApplyPreviewResponse) => {
    const res = await fetch("/api/workspace-skill-packs/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, packIds, workspaceRevision: confirmedPlan.workspaceRevision }),
    });
    const data = (await res.json()) as WorkspacePackErrorResponse;
    if (!res.ok || data.error) throw new WorkspacePackRequestError({ ...data, error: data.error ?? `HTTP ${res.status}` }, t);
  };

  const unusedPacks = packs.filter((pack) => !applied.some((item) => item.packId === pack.id));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{t("packs.applied")}:</span>
        {loading && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("general.loading")}</span>}
        {applied.map((pack) => {
          const skippedHere = skipped.filter((item) => item.packId === pack.packId);
          return (
            <span
              key={pack.packId}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 12, fontSize: 12,
                background: pack.status === "partial" ? "rgba(217,119,6,0.12)" : "rgba(34,197,94,0.10)",
                color: pack.status === "partial" ? "#d97706" : "#16a34a",
                border: `1px solid ${pack.status === "partial" ? "rgba(217,119,6,0.3)" : "rgba(34,197,94,0.3)"}`,
              }}
              title={skippedHere.map((item) => `${item.skillKey ?? item.serverKey ?? "entry"} skipped`).join("\n")}
            >
              {pack.packName || pack.packId}
              {pack.status === "partial" && <span style={{ fontSize: 10, fontWeight: 600 }}>· 有跳过</span>}
              <button onClick={() => void removeTag(pack.packId)} aria-label={`Disable ${pack.packName || pack.packId}`} style={{ display: "grid", placeItems: "center", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}><X size={13} aria-hidden="true" /></button>
            </span>
          );
        })}
        {unusedPacks.length > 0 && (
          <button
            onClick={() => setPicking(true)}
            style={{ padding: "3px 10px", borderRadius: 12, border: "1px dashed var(--border)", background: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
          >
            + {t("packs.addOne")}
          </button>
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("packs.workspaceScope")}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: "#f87171", marginTop: 6, whiteSpace: "pre-line" }}>{error}</div>}

      {picking && (
        <PackPicker
          packs={unusedPacks}
          onSelectionChange={() => setPreview(null)}
          onPreview={async (ids) => {
            setError(null);
            try {
              setPreview(await runPreview([...applied.map((pack) => pack.packId), ...ids]));
            } catch (e) {
              setError(String(e));
              setPreview(null);
            }
          }}
          onTrust={async (ids) => {
            if (applying) return;
            setApplying(true);
            setError(null);
            try {
              if (await confirmWorkspaceTrust(cwd, t)) {
                setPreview(await runPreview([...applied.map((pack) => pack.packId), ...ids]));
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setApplying(false);
            }
          }}
          onApply={async (ids) => {
            setApplying(true);
            setError(null);
            try {
              if (!preview?.canApply) throw new Error("No confirmed preview to apply");
              const desiredIds = [...applied.map((pack) => pack.packId), ...ids];
              const confirmedIds = new Set(preview.packs.map((pack) => pack.packId));
              if (desiredIds.length !== confirmedIds.size || desiredIds.some((id) => !confirmedIds.has(id))) throw new Error("Selection changed; preview again");
              await runApply(desiredIds, preview);
              announceWorkspacePackChange(cwd);
              await load();
              onApplied();
              setPicking(false);
              setPreview(null);
            } catch (e) {
              setError(String(e));
            } finally {
              setApplying(false);
            }
          }}
          onClose={() => {
            if (applying) return;
            setPicking(false);
            setPreview(null);
          }}
          preview={preview}
          applying={applying}
          error={error}
        />
      )}
    </div>
  );
}

function PackPicker({
  packs,
  onPreview,
  onSelectionChange,
  onApply,
  onTrust,
  onClose,
  preview,
  applying,
  error,
}: {
  packs: SkillPackInfo[];
  onPreview: (ids: string[]) => void;
  onSelectionChange: () => void;
  onApply: (ids: string[]) => void;
  onTrust: (ids: string[]) => void;
  onClose: () => void;
  preview: ApplyPreviewResponse | null;
  applying: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const backdrop = useBackdropDismiss(onClose);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      {...backdrop}
    >
      <div style={{ width: 420, maxWidth: "calc(100vw - 24px)", maxHeight: "80vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("packs.add")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {packs.map((pack) => {
            const checked = selected.has(pack.id);
            return (
              <label key={pack.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", background: checked ? "var(--bg-selected)" : "var(--bg-panel)" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={applying}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(pack.id);
                    else next.delete(pack.id);
                    setSelected(next);
                    onSelectionChange();
                  }}
                />
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)" }}>{pack.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {pack.skillCount} skill{pack.skillCount === 1 ? "" : "s"}
                    {pack.mcpServerCount > 0 && ` · ${pack.mcpServerCount} MCP`}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {preview && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
            {!preview.canApply && workspacePackBlockMessages(preview, t).map((message) => (
              <div key={message} style={{ color: "#f87171" }}>{message}</div>
            ))}
            {requiresWorkspaceTrust(preview) && <button type="button" disabled={applying} onClick={() => onTrust(Array.from(selected))}
              style={{ alignSelf: "flex-start", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: applying ? "not-allowed" : "pointer" }}>
              {t("packs.trustWorkspace")}
            </button>}
            {preview.toInstall.length > 0 && <div>Will install: {preview.toInstall.map((item) => item.skillKey).join(", ")}</div>}
            {preview.skipped.length > 0 && (
              <div style={{ color: "#d97706" }}>
                Will skip: {preview.skipped.map((item) => item.skillKey).join(", ")}
              </div>
            )}
            {(preview.mcp.toConfigure.length > 0 || preview.mcp.skipped.length > 0) && (
              <div>
                {preview.mcp.toConfigure.length > 0 && `Will enable native MCP: ${preview.mcp.toConfigure.map((item) => item.serverKey).join(", ")}`}
                {preview.mcp.skipped.length > 0 && ` Will skip MCP: ${preview.mcp.skipped.map((item) => item.serverKey).join(", ")}`}
              </div>
            )}
          </div>
        )}
        {error && <div role="alert" style={{ fontSize: 12, color: "#f87171", whiteSpace: "pre-line" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={applying}
            style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
          >
            {t("general.cancel")}
          </button>
          <button
            onClick={() => onPreview(Array.from(selected))}
            disabled={selected.size === 0 || applying}
            style={{ padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: selected.size === 0 ? "not-allowed" : "pointer", opacity: selected.size === 0 ? 0.5 : 1, fontSize: 13 }}
          >
            {t("general.preview")}
          </button>
          <button
            onClick={() => onApply(Array.from(selected))}
            disabled={!preview?.canApply || applying}
            style={{ padding: "6px 14px", border: "none", borderRadius: 6, background: "var(--accent)", color: "#fff", cursor: !preview?.canApply || applying ? "not-allowed" : "pointer", opacity: !preview?.canApply || applying ? 0.5 : 1, fontSize: 13, fontWeight: 600 }}
          >
            {applying ? t("packs.adding") : t("packs.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
