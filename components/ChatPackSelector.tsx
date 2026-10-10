"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Package, PackagePlus } from "lucide-react";
import type { AppliedPackInfo, SkillPackInfo, WorkspaceSkillPacksResponse } from "@/lib/api-types";
import { useI18n } from "@/lib/i18n";
import { useWorkspacePackRevision, announceWorkspacePackChange } from "@/hooks/useWorkspacePackRevision";
import { requiresWorkspaceTrust, WorkspacePackRequestError, type WorkspacePackErrorResponse } from "@/lib/workspace-pack-feedback";
import { useWorkspaceTrust } from "@/hooks/useWorkspaceTrust";
import { WorkspaceTrustNotice } from "./WorkspaceTrustNotice";

type JsonResponse = WorkspacePackErrorResponse;

async function json<T extends JsonResponse>(response: Response, t: ReturnType<typeof useI18n>["t"]): Promise<T> {
  const data = await response.json() as T;
  if (!response.ok || data.error) throw new WorkspacePackRequestError({ ...data, error: data.error ?? `Request failed (${response.status})` }, t);
  return data;
}

export function ChatPackSelector({ cwd, refreshKey, onChanged, isMobile, disabled = false }: {
  cwd: string; refreshKey?: number; onChanged?: () => void; isMobile: boolean; disabled?: boolean;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const loadGeneration = useRef(0);
  const workspaceRevision = useWorkspacePackRevision(cwd);
  const [open, setOpen] = useState(false);
  const trust = useWorkspaceTrust(cwd, open && !disabled);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<SkillPackInfo[]>([]);
  const [applied, setApplied] = useState<AppliedPackInfo[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const [ws, list] = await Promise.all([
      fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`).then((r) => json<WorkspaceSkillPacksResponse & JsonResponse>(r, t)),
      fetch("/api/skill-packs").then((r) => json<{ packs: SkillPackInfo[] } & JsonResponse>(r, t)),
    ]);
    if (generation !== loadGeneration.current) return false;
    setApplied(ws.appliedPacks);
    setRevision(ws.revision);
    setPacks(list.packs);
    setSelected(ws.appliedPacks.map((pack) => pack.packId));
    return true;
  }, [cwd, t]);

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    const generation = loadGeneration.current + 1;
    void load().catch(e => { if (generation === loadGeneration.current) setError(String(e)); })
      .finally(() => { if (generation === loadGeneration.current) setLoading(false); });
  }, [load]);
  useEffect(() => {
    reload();
    const generationRef = loadGeneration;
    return () => { generationRef.current++; };
  }, [reload, refreshKey, workspaceRevision, open]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggle = async (packId: string, checked: boolean) => {
    if (disabled || busy || loading || trust.granting || trust.trusted !== true) return;
    let generation = loadGeneration.current;
    setBusy(true);
    try {
      setError(null);
      setSelected((current) => checked ? [...current, packId] : current.filter((id) => id !== packId));
      if (checked) {
        await json<JsonResponse>(await fetch("/api/workspace-skill-packs/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, packIds: [...applied.map((item) => item.packId), packId], workspaceRevision: revision }),
        }), t);
      } else {
        await json<JsonResponse>(await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}&packId=${encodeURIComponent(packId)}&workspaceRevision=${revision}`, { method: "DELETE" }), t);
      }
      announceWorkspacePackChange(cwd);
      if (generation !== loadGeneration.current) return;
      generation = loadGeneration.current + 1;
      if (await load()) onChanged?.();
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setSelected(applied.map((pack) => pack.packId));
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof WorkspacePackRequestError && e.plan && requiresWorkspaceTrust(e.plan)) trust.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div ref={rootRef} style={{ position: "relative", marginLeft: 4, minWidth: 0, display: "flex", gap: 6 }}>
      <button type="button" onClick={() => {
        if (open) setOpen(false);
        else { trust.refresh(); setLoading(true); setOpen(true); }
      }} disabled={disabled || busy || trust.granting} aria-expanded={open && !disabled} title={t("packs.workspaceSwitches")}
        style={{ display: "flex", alignItems: "center", gap: 4, border: applied.length ? "1px solid var(--border)" : "1px dashed var(--border)", borderRadius: 12, padding: "3px 10px", background: applied.length ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none", color: applied.length ? "var(--accent)" : "var(--text-muted)", fontSize: 11, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", maxWidth: isMobile ? 140 : 240, overflow: "hidden" }}>
        {applied.length ? <Package size={11} aria-hidden="true" style={{ flexShrink: 0 }} /> : <PackagePlus size={11} aria-hidden="true" style={{ flexShrink: 0 }} />}
        <span>{applied.length}</span>
      </button>
      {open && !disabled && (
        <div role="group" aria-label={t("packs.workspaceSwitches")} style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 100, width: 290, maxWidth: "calc(100vw - 32px)", maxHeight: "min(380px, 60vh)", overflowY: "auto", background: "var(--overlay-bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.25)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 12, color: "var(--text)" }}>{t("packs.workspaceSwitches")}</strong>
            {(loading || busy) && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("general.loading")}</span>}
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("packs.workspaceScope")}</span>
          <WorkspaceTrustNotice trust={trust} onTrusted={() => { reload(); onChanged?.(); }} />
          {!loading && packs.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No packs available</span>}
          {packs.map((pack) => (
            <label key={pack.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 5, borderRadius: 6, cursor: busy || loading || trust.trusted !== true ? "not-allowed" : "pointer", color: "var(--text)", fontSize: 12 }}>
              <input type="checkbox" checked={selected.includes(pack.id)} disabled={busy || loading || trust.granting || trust.trusted !== true} onChange={(e) => void toggle(pack.id, e.target.checked)} />
              <span>{pack.name}<small style={{ display: "block", color: "var(--text-dim)" }}>{pack.skillCount} skills{pack.mcpServerCount > 0 && ` · ${pack.mcpServerCount} MCP`}</small></span>
            </label>
          ))}
          {error && <div role="alert" style={{ fontSize: 11, color: "#f87171", whiteSpace: "pre-line" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
