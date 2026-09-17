"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy, Folder, RotateCcw, Search, Tag, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { groupWorkspaces, type WorkspaceEntry, type WorkspacePatch } from "@/lib/workspace-registry";
import { WorkspaceDialog, WorkspaceTag } from "./WorkspaceDialog";

function WorkspaceRow({ entry, onSelect, onTag, onUpdate }: Pick<Props, "onSelect" | "onTag" | "onUpdate"> & { entry: WorkspaceEntry }) {
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
  const toggleRemoved = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await onUpdate({ path: entry.path, removed: !entry.removed }); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className={`workspace-row-container${entry.removed ? " is-removed" : ""}`}>
    <div className="workspace-modal-row" onClick={(event) => {
      // The main button handles keyboard navigation; padding/gaps also open it.
      // Action buttons must never navigate or close the modal.
      if (!entry.removed && !(event.target as Element).closest("button")) onSelect(entry.path);
    }}>
      <button type="button" className="workspace-row-main" disabled={entry.removed} onClick={() => onSelect(entry.path)} title={entry.path}>
        <Folder size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="workspace-row-text">
          <span className="workspace-row-title"><WorkspaceTag tag={entry.tag} /><span>{entry.name}</span></span>
          <span className="workspace-full-path">{entry.path}</span>
        </span>
      </button>
      <div className="workspace-row-actions">
        <button type="button" className="workspace-icon-button" onClick={() => void copy()} title={t(copied ? "fileTree.pathCopied" : "fileTree.copyFullPath")} aria-label={t("fileTree.copyFullPath")}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button type="button" className="workspace-icon-button" onClick={() => onTag(entry.path)} title={t("workspaces.setTag")} aria-label={t("workspaces.setTag")}><Tag size={16} /></button>
        <button type="button" className="workspace-icon-button" disabled={busy} onClick={() => void toggleRemoved()}
          title={t(entry.removed ? "workspaces.restore" : "general.remove")} aria-label={t(entry.removed ? "workspaces.restore" : "general.remove")}>
          {entry.removed ? <RotateCcw size={16} /> : <Trash2 size={16} />}
        </button>
      </div>
    </div>
    {error && <div role="alert" className="workspace-error">{error}</div>}
  </div>;
}

interface Props {
  entries: WorkspaceEntry[];
  onClose: () => void;
  onSelect: (path: string) => void;
  onTag: (path: string) => void;
  onUpdate: (patch: WorkspacePatch) => Promise<void>;
}

export function AllWorkspacesModal({ entries, onClose, onSelect, onTag, onUpdate }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"status" | "tag">("status");
  const [removedOpen, setRemovedOpen] = useState(false);
  const groups = groupWorkspaces(entries, query, mode);
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
          aria-expanded={searching || removedOpen} onClick={() => setRemovedOpen((open) => !open)}>
          <ChevronRight size={14} aria-hidden="true" style={{ transform: searching || removedOpen ? "rotate(90deg)" : undefined }} />
          {t("workspaces.removed")} <span>{group.entries.length}</span>
        </button>}
        {(mode === "tag" || !group.removed || searching || removedOpen) && group.entries.map((entry) =>
          <WorkspaceRow key={entry.path} entry={entry} onTag={onTag} onUpdate={onUpdate}
            onSelect={(path) => { onSelect(path); onClose(); }} />)}
      </section>)}
    </div>
  </WorkspaceDialog>;
}
