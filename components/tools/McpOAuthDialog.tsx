"use client";
import { useEffect, useRef, useState } from "react";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { useI18n } from "@/lib/i18n";
import { ToolError } from "./ToolsControls";

export function McpOAuthDialog({ url, ready, onSubmit, onCancel }: {
  url?: string; ready: boolean; onSubmit: (url: string) => Promise<void>; onCancel: () => void;
}) {
  const { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(""), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const backdrop = useBackdropDismiss(onCancel);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { if (node?.open) node.close(); }; }, []);
  return <dialog ref={dialog} className="tools-oauth-dialog" {...backdrop} onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => event.stopPropagation()} aria-labelledby="mcp-oauth-title">
    <form className="tools-editor-form" onSubmit={(event) => {
      event.preventDefault(); if (busy || !ready) return;
      setBusy(true); setError(null);
      void onSubmit(value.trim()).catch((reason) => { setError(t(reason instanceof Error ? reason.message : "mcp.oauthFailed")); setBusy(false); });
    }}>
      <strong id="mcp-oauth-title">{t("mcp.authenticate")}</strong>
      <p className="tools-help">{t("mcp.remoteAuthHelp")}</p>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{t("mcp.openAuthorization")}</a> : <p className="tools-help">{t("general.loading")}</p>}
      <label className="tools-field">{t("mcp.callbackUrl")}<textarea value={value} onChange={(event) => setValue(event.target.value)} autoFocus disabled={!ready || busy} autoComplete="off" spellCheck={false} /></label>
      <ToolError error={error} />
      <div className="tools-editor-actions"><button type="button" onClick={onCancel}>{t("general.cancel")}</button>
        <button type="submit" disabled={!ready || busy || !value.trim()}>{busy ? t("mcp.authWaiting") : t("general.confirm")}</button></div>
    </form>
  </dialog>;
}
