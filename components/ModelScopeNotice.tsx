"use client";

import type { ModelScopeDiagnosticDto } from "@/lib/models-cache";
import { useI18n } from "@/lib/i18n";

export function ModelScopeNotice({ diagnostics }: { diagnostics: ModelScopeDiagnosticDto[] }) {
  const { t } = useI18n();
  if (!diagnostics.length) return null;
  return <div role="status" style={{ padding: "8px 12px", maxWidth: 380, fontSize: 12, color: "var(--text-muted)", whiteSpace: "normal", overflowWrap: "anywhere" }}>
    {diagnostics.map((item, index) => <p key={`${item.code}:${item.pattern}:${index}`} style={{ margin: "4px 0" }}>
      {t(`models.scope.${item.code}`, { pattern: item.pattern })}
    </p>)}
  </div>;
}
