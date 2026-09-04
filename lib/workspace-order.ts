import type { SessionInfo } from "./types";

type WorkspaceSession = Pick<SessionInfo, "cwd" | "projectRoot" | "lastUserMessageAt">;

/** Return project roots that have user-authored messages, newest first. */
export function getRecentProjects(sessions: readonly WorkspaceSession[]): string[] {
  const latestByRoot = new Map<string, string>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root || !session.lastUserMessageAt) continue;
    const previous = latestByRoot.get(root);
    if (!previous || session.lastUserMessageAt > previous) {
      latestByRoot.set(root, session.lastUserMessageAt);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

function getSessionProjects(sessions: readonly WorkspaceSession[]): string[] {
  const roots = new Set<string>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (root) roots.add(root);
  }
  return [...roots];
}

/**
 * Merge session-backed projects with manually selected workspaces. A manual
 * selection is appended only when it is new; it cannot change the position of
 * an existing workspace. Once that workspace has a user message,
 * getRecentProjects places it ahead of the manual-only entries.
 */
export function getWorkspaceProjects(
  sessions: readonly WorkspaceSession[],
  customWorkspaces: readonly string[],
  hiddenWorkspaces: ReadonlySet<string> = new Set(),
  recentUserMessageWorkspaces: readonly string[] = [],
): string[] {
  const baseProjects = [...getRecentProjects(sessions), ...customWorkspaces, ...getSessionProjects(sessions)]
    .filter((project, index, projects) => projects.indexOf(project) === index && !hiddenWorkspaces.has(project));
  const baseSet = new Set(baseProjects);
  return [
    ...recentUserMessageWorkspaces.filter((project) => baseSet.has(project)),
    ...baseProjects,
  ].filter((project, index, projects) => projects.indexOf(project) === index);
}
