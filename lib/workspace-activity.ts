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

  // Show the spinner while any session runs, even if another session failed.
  // Once all runs finish, the failure marker becomes visible again.
  if (isRunning) return { isRunning: true, hasUnread: false };
  if (isError) return { isRunning: false, hasUnread: false, isError: true };
  return { isRunning: false, hasUnread };
}
