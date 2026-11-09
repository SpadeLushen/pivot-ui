"use client";

import { useWorkspacePackState } from "@/hooks/useWorkspacePackRevision";
import { useI18n } from "@/lib/i18n";

/** The same catch-up status beside workspace Pack switches and the MCP editor. */
export function WorkspacePackSyncNotice({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const { syncError, pendingServers, application } = useWorkspacePackState(cwd);
  if (!cwd) return null;
  const error = syncError
    ? t("packs.syncFailed", { error: syncError })
    : pendingServers.length ? t("packs.syncPendingServers", { servers: pendingServers.join(", ") }) : null;
  return <>
    {error && <div role="alert" style={{ fontSize: 12, color: "var(--error, #f87171)", marginBlock: 6, overflowWrap: "anywhere" }}>{error}</div>}
    {(application === "pending" || application === "failed") && <div role="status" style={{ fontSize: 12, color: "var(--text-muted)", marginBlock: 6 }}>
      {t(`tools.application.${application}`)}
    </div>}
  </>;
}
