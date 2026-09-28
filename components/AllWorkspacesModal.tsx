"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, sessionTitle } from "@/lib/session-display";
import { Archive, Check, ChevronRight, Copy, Folder, RotateCcw, Search, Tag } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { groupWorkspaces, matchingWorkspaceSessions, type WorkspaceEntry, type WorkspacePatch } from "@/lib/workspace-registry";
import { WorkspaceDialog, WorkspaceTag } from "./WorkspaceDialog";

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const phrase = query.trim();
  if (!phrase) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const needle = phrase.toLocaleLowerCase();
  const parts = [];
  let from = 0;
  let index = lower.indexOf(needle, from);
  while (index !== -1) {
    parts.push(text.slice(from, index), <strong className="workspace-search-match" key={index}>{text.slice(index, index + phrase.length)}</strong>);
    from = index + phrase.length;
    index = lower.indexOf(needle, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function WorkspaceRow({ entry, showTag, query, sessions, onSelect, onSelectSession, onTag, onUpdate }: Pick<Props, "onSelect" | "onSelectSession" | "onTag" | "onUpdate"> & { entry: WorkspaceEntry; showTag: boolean; query: string; sessions: SessionInfo[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try { await copyText(entry.path); setCopied(true); setError(null); }
    catch (error) { setError(String(error)); }
  };
  const toggleArchived = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await onUpdate({ path: entry.path, removed: !entry.removed }); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const openSession = async (session: SessionInfo) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (entry.removed) await onUpdate({ path: entry.path, removed: false });
      onSelectSession(session);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className={`workspace-row-container${entry.removed ? " is-archived" : ""}`}>
    <div className="workspace-modal-row" onClick={(event) => {
      // The main button handles keyboard navigation; padding/gaps also open it.
      // Action buttons must never navigate or close the modal.
      if (!entry.removed && !(event.target as Element).closest("button")) onSelect(entry.path);
    }}>
      <button type="button" className="workspace-row-main" disabled={entry.removed} onClick={() => onSelect(entry.path)} title={entry.path}>
        <Folder size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="workspace-row-text">
          <span className="workspace-row-title">{showTag && <WorkspaceTag tag={entry.tag} />}<span><HighlightMatch text={entry.name} query={query} /></span></span>
          <span className="workspace-full-path">{entry.path}</span>
        </span>
      </button>
      <div className="workspace-row-actions">
        <button type="button" className="workspace-icon-button" onClick={() => void copy()} title={t(copied ? "fileTree.pathCopied" : "fileTree.copyFullPath")} aria-label={t("fileTree.copyFullPath")}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button type="button" className="workspace-icon-button" onClick={() => onTag(entry.path)} title={t("workspaces.setTag")} aria-label={t("workspaces.setTag")}><Tag size={16} /></button>
        <button type="button" className="workspace-icon-button" disabled={busy} onClick={() => void toggleArchived()}
          title={t(entry.removed ? "workspaces.restore" : "workspaces.archive")} aria-label={t(entry.removed ? "workspaces.restore" : "workspaces.archive")}>
          {entry.removed ? <RotateCcw size={16} /> : <Archive size={16} />}
        </button>
      </div>
    </div>
    {sessions.map((session) => <button key={session.id} type="button" className="workspace-session-result"
      disabled={busy} onClick={() => void openSession(session)} title={sessionTitle(session)}>
      <span className="workspace-session-title"><HighlightMatch text={sessionTitle(session)} query={query} /></span>
      <span className="workspace-session-meta"><span title={session.modified}>{formatRelativeTime(session.modified)}</span><span>{session.messageCount} msgs</span></span>
    </button>)}
    {error && <div role="alert" className="workspace-error">{error}</div>}
  </div>;
}

interface Props {
  entries: WorkspaceEntry[];
  sessions: SessionInfo[];
  onClose: () => void;
  onSelect: (path: string) => void;
  onSelectSession: (session: SessionInfo) => void;
  onTag: (path: string) => void;
  onUpdate: (patch: WorkspacePatch) => Promise<void>;
}

export function AllWorkspacesModal({ entries, sessions, onClose, onSelect, onSelectSession, onTag, onUpdate }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"status" | "tag">("status");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const matchingSessions = useMemo(() => matchingWorkspaceSessions(sessions, query), [sessions, query]);
  const groups = groupWorkspaces(entries, query, mode, new Set(matchingSessions.keys()));
  const searching = Boolean(query.trim());
  return <WorkspaceDialog title={t("workspaces.all")} onClose={onClose}>
    <div className="workspace-modal-toolbar">
      <label className="workspace-search"><Search size={16} aria-hidden="true" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("workspaces.search")} aria-label={t("workspaces.search")} />
      </label>
      <select value={mode} onChange={(event) => setMode(event.target.value as "status" | "tag")} aria-label={t("workspaces.groupBy")}>
        <option value="status">{t("workspaces.byStatus")}</option>
        <option value="tag">{t("workspaces.byTag")}</option>
      </select>
    </div>
    <div className="workspace-modal-list">
      {!groups.some((group) => group.entries.length > 0) && <p className="workspace-empty">{t("app.noMatchingProjects")}</p>}
      {groups.map((group) => group.entries.length > 0 && <section key={group.key}>
        {mode === "tag" && <h3 className="workspace-group-heading">
          {group.tag || t("workspaces.untagged")}
        </h3>}
        {mode === "status" && group.removed && <button type="button" className="workspace-group-heading" disabled={searching}
          aria-expanded={searching || archivedOpen} onClick={() => setArchivedOpen((open) => !open)}>
          <ChevronRight size={14} aria-hidden="true" style={{ transform: searching || archivedOpen ? "rotate(90deg)" : undefined }} />
          {t("workspaces.archived")} <span>{group.entries.length}</span>
        </button>}
        {(mode === "tag" || !group.removed || searching || archivedOpen) && group.entries.map((entry) =>
          // The tag section heading already shows the tag, so tag mode
          // omits the per-row tag prefix to avoid repeating it.
          <WorkspaceRow key={entry.path} entry={entry} showTag={mode === "status"} query={query}
            sessions={matchingSessions.get(entry.path) ?? []} onTag={onTag} onUpdate={onUpdate}
            onSelect={(path) => { onSelect(path); onClose(); }}
            onSelectSession={(session) => { onSelectSession(session); onClose(); }} />)}
      </section>)}
    </div>
  </WorkspaceDialog>;
}
