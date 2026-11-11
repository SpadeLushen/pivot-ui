"use client";

import { FilePenLine } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function DraftIndicator() {
  const { t } = useI18n();
  return <span className="draft-indicator" role="img" aria-label={t("app.draft")} title={t("app.draft")}
    style={{ display: "inline-flex", alignItems: "center", flex: "0 0 auto", width: 14, height: 14, color: "#888" }}>
    <FilePenLine size={13} strokeWidth={1.5} aria-hidden="true" style={{ color: "inherit" }} />
  </span>;
}
