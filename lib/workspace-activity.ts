import type { SessionInfo } from "@/lib/types";

export interface WorkspaceActivity {
  isRunning: boolean;
  hasUnread: boolean;
}

/** Aggregate session activity for a workspace/project root. */
export function getWorkspaceActivity(
  workspaceRoot: string,
  sessions: readonly Pick<SessionInfo, "id" | "cwd" | "projectRoot">[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): WorkspaceActivity {
  let hasUnread = false;

  for (const session of sessions) {
    if ((session.projectRoot ?? session.cwd) !== workspaceRoot) continue;
    if (runningSessionIds.has(session.id)) return { isRunning: true, hasUnread: false };
    if (unreadSessionIds.has(session.id)) hasUnread = true;
  }

  return { isRunning: false, hasUnread };
}
