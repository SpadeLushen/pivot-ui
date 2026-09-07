import type { SessionInfo } from "@/lib/types";

export interface WorkspaceActivity {
  isRunning: boolean;
  hasUnread: boolean;
  /** At least one session in the workspace ended with an execution error. */
  isError?: boolean;
}

/** Aggregate session activity for a workspace/project root. */
export function getWorkspaceActivity(
  workspaceRoot: string,
  sessions: readonly Pick<SessionInfo, "id" | "cwd" | "projectRoot">[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
  errorSessionIds: ReadonlySet<string> = new Set(),
): WorkspaceActivity {
  let hasUnread = false;
  let isRunning = false;
  let isError = false;

  for (const session of sessions) {
    if ((session.projectRoot ?? session.cwd) !== workspaceRoot) continue;
    if (errorSessionIds.has(session.id)) isError = true;
    if (runningSessionIds.has(session.id)) isRunning = true;
    if (unreadSessionIds.has(session.id)) hasUnread = true;
  }

  // A failed execution is more actionable than a running or unread marker, so
  // the workspace indicator uses the error state when any session failed.
  if (isError) return { isRunning: false, hasUnread: false, isError: true };
  if (isRunning) return { isRunning: true, hasUnread: false };
  return { isRunning: false, hasUnread };
}
