import type { SessionInfo } from "@/lib/types";

export interface WorkspaceActivity {
  isRunning: boolean;
  hasUnread: boolean;
  isWaiting?: boolean;
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
  waitingSessionIds: ReadonlySet<string> = new Set(),
): WorkspaceActivity {
  let isWaiting = false;
  let hasUnread = false;
  let isRunning = false;
  let isError = false;

  for (const session of sessions) {
    if ((session.projectRoot ?? session.cwd) !== workspaceRoot) continue;
    if (waitingSessionIds.has(session.id)) isWaiting = true;
    if (errorSessionIds.has(session.id)) isError = true;
    if (runningSessionIds.has(session.id)) isRunning = true;
    if (unreadSessionIds.has(session.id)) hasUnread = true;
  }

  if (isWaiting) return { isRunning: false, hasUnread: false, isWaiting: true };
  if (isError) return { isRunning: false, hasUnread: false, isError: true };
  if (isRunning) return { isRunning: true, hasUnread: false };
  return { isRunning: false, hasUnread };
}
