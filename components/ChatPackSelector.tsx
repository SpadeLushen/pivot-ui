"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Package, PackagePlus } from "lucide-react";
import type { AppliedPackInfo, SkillPackInfo, WorkspaceSkillPacksResponse } from "@/lib/api-types";
import { useI18n } from "@/lib/i18n";

type JsonResponse = { error?: string };

async function json<T extends JsonResponse>(response: Response): Promise<T> {
  const data = await response.json() as T;
  if (!response.ok || data.error) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export function ChatPackSelector({ cwd, refreshKey, onChanged, isMobile }: {
  cwd: string; refreshKey?: number; onChanged?: () => void; isMobile: boolean;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<SkillPackInfo[]>([]);
  const [applied, setApplied] = useState<AppliedPackInfo[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [ws, list] = await Promise.all([
      fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}`).then((r) => json<WorkspaceSkillPacksResponse & JsonResponse>(r)),
      fetch("/api/skill-packs").then((r) => json<{ packs: SkillPackInfo[] } & JsonResponse>(r)),
    ]);
    setApplied(ws.appliedPacks);
    setRevision(ws.revision);
    setPacks(list.packs);
    setSelected(ws.appliedPacks.map((pack) => pack.packId));
  }, [cwd]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void load().catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, refreshKey]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const toggle = async (packId: string, checked: boolean) => {
    if (busy || loading) return;
    setError(null);
    setSelected((current) => checked ? [...current, packId] : current.filter((id) => id !== packId));
    setBusy(true);
    try {
      if (checked) {
        await json<JsonResponse>(await fetch("/api/workspace-skill-packs/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, packIds: [...applied.map((item) => item.packId), packId], workspaceRevision: revision }),
        }));
      } else {
        await json<JsonResponse>(await fetch(`/api/workspace-skill-packs?cwd=${encodeURIComponent(cwd)}&packId=${encodeURIComponent(packId)}&workspaceRevision=${revision}`, { method: "DELETE" }));
      }
      await load();
      onChanged?.();
    } catch (e) {
      setSelected(applied.map((pack) => pack.packId));
      setError(String(e));
    } finally { setBusy(false); }
  };
  return (
    <div ref={rootRef} style={{ position: "relative", marginLeft: 4, minWidth: 0, display: "flex", gap: 6 }}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} title="Select skill packs"
        style={{ display: "flex", alignItems: "center", gap: 4, border: applied.length ? "1px solid var(--border)" : "1px dashed var(--border)", borderRadius: 12, padding: "3px 10px", background: applied.length ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none", color: applied.length ? "var(--accent)" : "var(--text-muted)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", maxWidth: isMobile ? 140 : 240, overflow: "hidden" }}>
        {applied.length ? <Package size={11} aria-hidden="true" style={{ flexShrink: 0 }} /> : <PackagePlus size={11} aria-hidden="true" style={{ flexShrink: 0 }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{applied.length ? (isMobile ? `${applied[0].packName || applied[0].packId}${applied.length > 1 ? "…" : ""}` : applied.map((p) => p.packName || p.packId).join(", ")) : "Add Pack"}</span>
      </button>
      {open && (
        <div role="group" aria-label="Skill packs" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 100, width: 290, maxWidth: "calc(100vw - 32px)", maxHeight: "min(380px, 60vh)", overflowY: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.25)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 12, color: "var(--text)" }}>Packs</strong>
            {(loading || busy) && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("general.loading")}</span>}
          </div>
          {!loading && packs.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No packs available</span>}
          {packs.map((pack) => (
            <label key={pack.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 5, borderRadius: 6, cursor: busy ? "not-allowed" : "pointer", color: "var(--text)", fontSize: 12 }}>
              <input type="checkbox" checked={selected.includes(pack.id)} disabled={busy || loading} onChange={(e) => void toggle(pack.id, e.target.checked)} />
              <span>{pack.name}<small style={{ display: "block", color: "var(--text-dim)" }}>{pack.skillCount} skills{pack.mcpServerCount > 0 && ` · ${pack.mcpServerCount} MCP`}</small></span>
            </label>
          ))}
          {error && <div role="alert" style={{ fontSize: 11, color: "#f87171" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
