"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { workspaceName, type WorkspacePatch } from "@/lib/workspace-registry";
import { WorkspaceDialog } from "./WorkspaceDialog";

export function WorkspaceTagDialog({ path, tag, onSave, onClose }: {
  path: string; tag: string; onSave: (patch: WorkspacePatch) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(tag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <WorkspaceDialog title={t("workspaces.setTag")} onClose={onClose} compact initialFocusRef={inputRef}>
    <form className="workspace-tag-form" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      setError(null);
      try { await onSave({ path, tag: value }); onClose(); }
      catch (error) { setError(String(error)); }
      finally { setSaving(false); }
    }}>
      <strong>{workspaceName(path)}</strong>
      <div className="workspace-full-path">{path}</div>
      <label htmlFor="workspace-tag-input">{t("workspaces.tag")}</label>
      <input ref={inputRef} id="workspace-tag-input" value={value} maxLength={120} disabled={saving} onChange={(event) => setValue(event.target.value)} />
      <p>{t("workspaces.tagHint")}</p>
      {error && <div role="alert" className="workspace-error">{error}</div>}
      <footer>
        <button type="button" onClick={onClose}>{t("general.cancel")}</button>
        <button type="submit" disabled={saving}>{t(saving ? "general.saving" : "general.save")}</button>
      </footer>
    </form>
  </WorkspaceDialog>;
}
