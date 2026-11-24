"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, GitFork, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { GitBranch } from "@/lib/git-branches";
import { useIsMobile } from "@/hooks/useIsMobile";

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  isCurrent: boolean;
}

interface WorktreeState {
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
  branches: GitBranch[];
}

interface Props {
  cwd: string | null | undefined;
  disabled?: boolean;
  /** Switching worktrees always starts a session in the selected checkout. */
  onCwdChange: (cwd: string, projectRoot: string) => void;
}

function WorktreeIcon({ size = 11 }: { size?: number }) {
  return <GitFork size={size} aria-hidden="true" />;
}

function MenuBody({ showActions, actionsPage, children }: { showActions: boolean; actionsPage: ReactNode; children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current!;
    const page = (showActions ? actionsRef : listRef).current!;
    const resize = () => { frame.style.height = `${page.offsetHeight}px`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(page);
    return () => observer.disconnect();
  }, [showActions]);

  return <div ref={frameRef} className="worktree-menu-frame">
    <div className="worktree-menu-track" data-view={showActions ? "actions" : "list"}>
      <div ref={listRef} className="worktree-menu-page" inert={showActions}>{children}</div>
      <div ref={actionsRef} className="worktree-menu-page" inert={!showActions}>{actionsPage}</div>
    </div>
  </div>;
}

export function WorktreeSwitcher({ cwd, disabled = false, onCwdChange }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [state, setState] = useState<WorktreeState | null>(null);
  const [open, setOpen] = useState(false);
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setActions] = useState<{ name: string; tree?: WorktreeEntry } | null>(null);
  const [showActions, setShowActions] = useState(false);
  const actions = showActions ? target : null;
  const backRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (actions) backRef.current?.focus({ preventScroll: true });
    else if (open) triggerRef.current?.focus({ preventScroll: true });
  }, [actions, open]);

  const [status, setStatus] = useState<{ dirty: boolean; unpushed: number; checkedOut: boolean } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cwd) return;

    let cancelled = false;
    Promise.all([
      fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`).then((res) => res.json() as Promise<{ projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }>),
      fetch(`/api/git?cwd=${encodeURIComponent(cwd)}&action=branches`).then((res) => res.ok ? res.json() as Promise<{ branches?: GitBranch[] }> : null),
    ])
      .then(([data, branchData]) => {
        if (cancelled || data.error || !data.projectRoot) return;
        const projectRoot = data.projectRoot;
        setState(previous => ({
          projectRoot,
          isGit: data.isGit ?? false,
          isTopLevel: data.isTopLevel ?? false,
          worktrees: data.worktrees ?? [],
          branches: branchData?.branches ?? previous?.branches ?? [],
        }));
      })
      .catch(() => { /* Keep the last snapshot until the next refresh. */ });

    return () => { cancelled = true; };
  }, [cwd, refreshKey]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setNewWorktreeOpen(false);
        setBranch("");
        setError(null);
        setActions(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setNewWorktreeOpen(false);
    setBranch("");
    setError(null);
    setActions(null);
  }, []);

  const selectWorktree = useCallback((worktree: WorktreeEntry) => {
    if (!state || worktree.isCurrent) {
      closeMenu();
      return;
    }
    closeMenu();
    onCwdChange(worktree.path, state.projectRoot);
  }, [closeMenu, onCwdChange, state]);

  const selectBranch = useCallback(async (branch: GitBranch) => {
    if (!state || busy) return;
    const existing = state.worktrees.find((worktree) => worktree.branch === branch.name);
    if (existing) {
      selectWorktree(existing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: state.projectRoot, branch: branch.name }),
      });
      const data = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok || !data.path || data.error) {
        setError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      closeMenu();
      onCwdChange(data.path, state.projectRoot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, closeMenu, onCwdChange, selectWorktree, state]);

  const createWorktree = useCallback(async () => {
    const trimmedBranch = branch.trim();
    if (!state || !trimmedBranch || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: state.projectRoot, branch: trimmedBranch }),
      });
      const data = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok || !data.path || data.error) {
        setError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      closeMenu();
      onCwdChange(data.path, state.projectRoot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [branch, busy, closeMenu, onCwdChange, state]);

  function openActions(name: string, tree?: WorktreeEntry) {
    setError(null);
    setStatus(null);
    setActions({ name, tree });
    setShowActions(true);
  }

  const root = state?.projectRoot;
  useEffect(() => {
    if (!root || !actions) return;
    let active = true;
    const { tree, name } = actions;
    const query = new URLSearchParams({ cwd: root });
    query.set(tree ? "inspectPath" : "inspectBranch", tree?.path ?? name);
    fetch(`/api/worktrees?${query}`, { cache: "no-store" }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.branch !== (tree ? tree.branch : name)) throw new Error(t("worktree.changed"));
      if (active) setStatus({ dirty: data.dirty, unpushed: data.unpushed, checkedOut: !tree && data.checkedOut });
    }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [actions, root, t]);

  const canDelete = !!status && !status.dirty && !status.checkedOut && !busy;
  async function finishRemoval(withBranch: boolean) {
    if (!state || !actions || !canDelete) return;
    const { tree, name } = actions;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: state.projectRoot, ...(tree
          ? { path: tree.path, deleteBranch: withBranch ? tree.branch : undefined }
          : { branch: name }) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (tree && data.dirty) setStatus(previous => previous && ({ ...previous, dirty: true }));
        else setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowActions(false);
      if (data.branchError) window.alert(t("worktree.partial", { error: data.branchError }));
      if (tree?.isCurrent) {
        closeMenu();
        onCwdChange(state.projectRoot, state.projectRoot);
      } else setRefreshKey(key => key + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  function actionsTrigger(name: string, tree?: WorktreeEntry) {
    return <button type="button" className="sidebar-project-menu-button" disabled={busy} aria-label={t("worktree.actions", { name })} title={t("worktree.actions", { name })} onClick={event => { triggerRef.current = event.currentTarget; openActions(name, tree); }}>
      <MoreHorizontal size={16} aria-hidden="true" />
    </button>;
  }

  if (!state?.isGit || !state.isTopLevel) return null;

  const menuError = error && <div style={{ padding: "0 10px 9px", color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{error}</div>;
  const current = state.worktrees.find((worktree) => worktree.isCurrent);
  const currentLabel = current?.branch ?? (current ? "HEAD" : "Worktree");
  const unopenedBranches = state.branches.filter((branch) => branch.kind === "local" && !state.worktrees.some((worktree) => worktree.branch === branch.name));

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => { if (open) closeMenu(); else { setOpen(true); setRefreshKey(key => key + 1); } }}
        disabled={disabled}
        title={current ? `Switch branch: ${current.path}` : "Switch branch"}
        aria-label="Switch branch"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          height: 32,
          maxWidth: 178,
          padding: "0 8px",
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: current && !current.isMain ? "var(--accent)" : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          fontSize: 12,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(event) => {
          if (!disabled) {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text)";
          }
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
          event.currentTarget.style.color = current && !current.isMain ? "var(--accent)" : "var(--text-muted)";
        }}
      >
        <WorktreeIcon />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentLabel}</span>
        <ChevronDown size={9} strokeWidth={1.8} aria-hidden="true" style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div className="overlay-surface" style={{
          position: "absolute",
          ...(isMobile ? { left: "50%", transform: "translateX(-50%)" } : { right: 0 }),
          bottom: "calc(100% + 6px)",
          zIndex: 110,
          width: "min(320px, calc(100vw - 24px))",
          maxHeight: "min(430px, 70vh)",
          overflow: "hidden",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        }}>
          <MenuBody showActions={!!actions} actionsPage={target && <>
            <div className="worktree-actions" onKeyDown={event => { if (event.key === "Escape") { setShowActions(false); setError(null); event.stopPropagation(); } }}>
              <button type="button" ref={backRef} disabled={busy} className="worktree-action-heading" onClick={() => { setShowActions(false); setError(null); }} aria-label={t("worktree.back")}><ArrowLeft size={14} /><strong>{target.name}</strong></button>
              {!status && !error && <p role="status">{t("worktree.loading")}</p>}
              {status?.dirty && <p>{t("worktree.dirty")}</p>}
              {status?.checkedOut && <p>{t("worktree.checkedOut")}</p>}
              {!!status?.unpushed && <p>{t("worktree.unpushed", { count: status.unpushed })}</p>}
              <button type="button" disabled={!canDelete} onClick={() => void finishRemoval(false)}><Trash2 size={14} />{t("worktree.delete")}</button>
              {target.tree?.branch && <button type="button" disabled={!canDelete} onClick={() => void finishRemoval(true)}><GitFork size={14} />{t("worktree.withBranch")}</button>}
            </div>
            {actions && menuError}
          </>}>
          <div style={{ maxHeight: "min(304px, 48vh)", overflowY: "auto" }}>
            {state.worktrees.map((worktree) => {
              const { isCurrent } = worktree;
              return (
                <div key={worktree.path} className="sidebar-project-row" style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", background: isCurrent ? "var(--bg-selected)" : "var(--bg)" }}>
                  <button
                    type="button"
                    onClick={() => selectWorktree(worktree)}
                    title={worktree.path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                      minWidth: 0,
                      padding: "9px 10px",
                      border: "none",
                      background: "none",
                      color: isCurrent ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: 12,
                      textAlign: "left",
                    }}
                  >
                    {isCurrent ? (
                      <Check size={10} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
                    ) : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{worktree.branch ?? worktree.path}</span>
                    {worktree.isMain && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>main</span>}
                  </button>
                  {!worktree.isMain && actionsTrigger(worktree.branch ?? worktree.path, worktree)}
                </div>
              );
            })}
            {unopenedBranches.length > 0 && <>
              <div style={{ padding: "7px 10px 4px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, fontWeight: 650, textTransform: "uppercase" }}>Branches</div>
              {unopenedBranches.map((branch) => (
                <div key={branch.name} className="sidebar-project-row" style={{ display: "flex", alignItems: "center" }}>
                <button type="button" onClick={() => void selectBranch(branch)} disabled={busy} title={`Open ${branch.name} in a worktree`} style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 10px", border: "none", borderBottom: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "left" }}>
                  <span style={{ width: 10, flexShrink: 0 }} />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branch.name}</span>
                </button>
                {actionsTrigger(branch.name)}
                </div>
              ))}
            </>}
          </div>

          {!newWorktreeOpen ? (
            <button
              type="button"
              onClick={() => {
                setNewWorktreeOpen(true);
                setError(null);
                window.setTimeout(() => branchInputRef.current?.focus(), 0);
              }}
              style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "9px 10px", border: "none", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
            >
              <Plus size={11} strokeWidth={1.2} aria-hidden="true" />
              New branch
            </button>
          ) : (
            <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
              <input
                ref={branchInputRef}
                value={branch}
                onChange={(event) => { setBranch(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void createWorktree(); }
                  if (event.key === "Escape") { setNewWorktreeOpen(false); setBranch(""); setError(null); }
                }}
                placeholder="branch name"
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid var(--accent)", borderRadius: 5, background: "var(--bg)", color: "var(--text)", outline: "none", fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button type="button" onClick={() => void createWorktree()} disabled={busy || !branch.trim()} style={{ flex: 1, padding: "5px 0", border: "none", borderRadius: 5, background: "var(--accent)", color: "#fff", cursor: busy || !branch.trim() ? "not-allowed" : "pointer", opacity: busy || !branch.trim() ? 0.65 : 1, fontSize: 11, fontWeight: 600 }}>{busy ? "Creating..." : "Create"}</button>
                <button type="button" onClick={() => { setNewWorktreeOpen(false); setBranch(""); setError(null); }} style={{ flex: 1, padding: "5px 0", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>Cancel</button>
              </div>
            </div>
          )}
          {!actions && menuError}
          </MenuBody>
        </div>
      )}
    </div>
  );
}
