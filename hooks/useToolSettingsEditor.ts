"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ToolsSnapshot, ToolRulePatch, ToolSettingsTarget, CodemodePatch } from "@/lib/tool-settings-types";
import type { CodemodeDraft } from "@/components/tools/CodemodeSettings";

interface Draft { base: ToolsSnapshot; tools: Record<string, ToolRulePatch>; codemode?: CodemodeDraft }
export function useToolSettingsEditor({ cwd, scope, sessionId, snapshot, onUpdated, onClose, onRefresh }: {
  cwd: string; scope: string; sessionId?: string; snapshot: ToolsSnapshot | null;
  onUpdated: (snapshot: ToolsSnapshot) => void; onClose: () => void; onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<ToolSettingsTarget>("workspace");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<ToolSettingsTarget | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const editorScope = `${scope}\0${target}`, draftKey = JSON.stringify([cwd, target]);
  const error = failure?.scope === editorScope ? failure.message : null;
  const setError = (message: string | null) => setFailure(message === null ? null : { scope: editorScope, message });
  const scopeRef = useRef(editorScope);
  useEffect(() => { scopeRef.current = editorScope; setError(null); }, [editorScope]);
  const draft = drafts[draftKey], dirty = !!draft, anyDirty = Object.keys(drafts).length > 0;
  const revisions = (value: ToolsSnapshot) => target === "global"
    ? [value.globalRevision, value.orchestration.globalRevision] : [value.revision, value.orchestration.revision];
  const changedElsewhere = !!draft && !!snapshot && revisions(draft.base).some((value, index) => value !== revisions(snapshot)[index]);
  const viewSnapshot = snapshot && target === "global" ? { ...snapshot,
    tools: snapshot.tools.map(tool => ({ ...tool, ...tool.inherited })),
    orchestration: { ...snapshot.orchestration, ...snapshot.orchestration.inherited },
  } : snapshot;
  const budget = draft?.codemode?.budget;
  const invalidBudget = budget != null && (!/^\d+$/.test(budget) || !Number.isSafeInteger(Number(budget)));
  const canSave = dirty && !!snapshot && !saving && !invalidBudget && !changedElsewhere &&
    (target === "global" || snapshot.orchestration.trusted);
  const changeTarget = (next: ToolSettingsTarget) => {
    if (saving || !["global", "workspace"].includes(next)) return;
    setTarget(next); setError(null);
  };
  const save = async () => {
    if (!draft || !canSave) return;
    const captured = draft;
    const codemode: CodemodePatch = {
      ...(captured.codemode?.mode !== undefined ? { mode: captured.codemode.mode } : {}),
      ...(captured.codemode?.budget !== undefined ? { inlineBudget: Number(captured.codemode.budget) } : {}),
    };
    setSaving(target); setError(null);
    try {
      const response = await fetch("/api/tools", { method: "PATCH", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000), body: JSON.stringify({ cwd, sessionId, action: "save", target,
          revision: revisions(captured.base)[0], orchestrationRevision: revisions(captured.base)[1],
          tools: captured.tools, ...(Object.keys(codemode).length ? { codemode } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDrafts(current => { if (current[draftKey] !== captured) return current; const next = { ...current }; delete next[draftKey]; return next; });
      if (scopeRef.current === editorScope) onUpdated(data);
    } catch (reason) {
      if (scopeRef.current === editorScope) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(null); }
  };
  const editTool = (name: string, patch: ToolRulePatch) => {
    if (!snapshot || saving) return;
    setError(null);
    setDrafts(current => {
      const base = current[draftKey] ?? { base: snapshot, tools: {} };
      return { ...current, [draftKey]: { ...base, tools: { ...base.tools, [name]: { ...base.tools[name], ...patch } } } };
    });
  };
  const editCodemode = (patch: CodemodeDraft) => {
    if (!snapshot || saving) return;
    setError(null);
    setDrafts(current => {
      const base = current[draftKey] ?? { base: snapshot, tools: {} };
      return { ...current, [draftKey]: { ...base, codemode: { ...base.codemode, ...patch } } };
    });
  };
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);
  const close = () => {
    if (saving || (anyDirty && !window.confirm(t("tools.discardChanges")))) return;
    onClose();
  };
  const refresh = () => {
    if (saving || (dirty && !window.confirm(t("tools.discardChanges")))) return;
    setDrafts(current => { const next = { ...current }; delete next[draftKey]; return next; });
    setError(null); onRefresh();
  };
  return { target, changeTarget, viewSnapshot, draft, dirty, saving, error, changedElsewhere,
    editTool, editCodemode, close, refresh, save, canSave,
    otherDrafts: Object.keys(drafts).some(key => key !== draftKey) };
}
