"use client";
import { useI18n } from "@/lib/i18n";
import type { useWorkspaceTrust } from "@/hooks/useWorkspaceTrust";

export function WorkspaceTrustNotice({ trust, onTrusted }: {
  trust: ReturnType<typeof useWorkspaceTrust>; onTrusted?: () => void;
}) {
  const { t } = useI18n();
  if (trust.trusted === true) return null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
    {trust.checking && <span role="status">{t("general.loading")}</span>}
    {trust.trusted === false && <>
      <span>{t("workspaceTrust.required")}</span>
      <button type="button" disabled={trust.granting} onClick={() => void trust.grant().then(saved => { if (saved) onTrusted?.(); })}
        style={{ alignSelf: "flex-start", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", cursor: trust.granting ? "not-allowed" : "pointer" }}>
        {trust.granting ? t("general.loading") : t("packs.trustWorkspace")}
      </button>
    </>}
    {trust.error && <>
      <div role="alert" style={{ color: "#f87171", whiteSpace: "pre-line" }}>{t(trust.error)}</div>
      {trust.trusted === null && <button type="button" onClick={trust.refresh}>{t("tools.refresh")}</button>}
    </>}
  </div>;
}
