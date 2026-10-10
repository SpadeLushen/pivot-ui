"use client";

import { useI18n } from "@/lib/i18n";
import { useBackdropDismiss } from "@/hooks/useBackdropDismiss";
import { InteractionSurface, InteractionHeader, InteractionChoice } from "./InteractionSurface";

/** Informational entry only: no import, conversion or configuration writes. */
export function NativeMcpNotice({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const backdrop = useBackdropDismiss(onClose);
  return <div data-native-mcp-notice="true" style={{ position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.28)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} {...backdrop}>
    <InteractionSurface aria-labelledby="native-mcp-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <InteractionHeader id="native-mcp-title" title={t("nativeMcp.title")} subtitle="Breaking change" />
      <div style={{ padding: 14, fontSize: 13, lineHeight: 1.6, display: "grid", gap: 10 }}>
        <p>{t("nativeMcp.breaking")}</p>
        <p>{t("nativeMcp.files")}</p>
        <p>{t("nativeMcp.configLater")}</p>
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
        <InteractionChoice autoFocus onClick={onClose}>{t("general.close")}</InteractionChoice>
      </div>
    </InteractionSurface>
  </div>;
}
