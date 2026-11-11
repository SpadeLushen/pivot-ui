import type { SessionInfo } from "./types";

type WorkspaceSession = Pick<SessionInfo, "cwd" | "projectRoot" | "lastUserMessageAt">;

export interface WorkspaceDisplayGroups {
  resident: string[];
  overflow: string[];
}

/**
 * Keep seven rows including See all, or six projects + More (with See all last).
 * An overflow selection temporarily takes the last resident workspace's slot;
 * selection never changes the ordering of the projects themselves.
 */
export function getWorkspaceDisplayGroups(
  projects: readonly string[],
  selectedProject: string | null = null,
): WorkspaceDisplayGroups {
  if (projects.length <= 6) {
    return { resident: [...projects], overflow: [] };
  }

  const firstSix = [...projects.slice(0, 6)];
  const selectedOverflowProject = selectedProject !== null
    && projects.includes(selectedProject)
    && !firstSix.includes(selectedProject)
    ? selectedProject
    : null;
  const resident = selectedOverflowProject !== null
    ? [...firstSix.slice(0, -1), selectedOverflowProject]
    : firstSix;
  const residentSet = new Set(resident);

  return {
    resident,
    overflow: projects.filter((project) => !residentSet.has(project)),
  };
}

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
  recentUserMessageWorkspaces: readonly string[] | ReadonlyMap<string, number> = [],
  draftUpdates: ReadonlyMap<string, number> = new Map(),
): string[] {
  const baseProjects = [...getRecentProjects(sessions), ...customWorkspaces, ...getSessionProjects(sessions)]
    .filter((project, index, projects) => projects.indexOf(project) === index && !hiddenWorkspaces.has(project));
  const baseSet = new Set(baseProjects);
  // Retain the legacy explicit-order input for callers without timestamps.
  const recentProjects = Array.isArray(recentUserMessageWorkspaces)
    ? recentUserMessageWorkspaces as readonly string[] : [];
  const ordered = [
    ...recentProjects.filter((project) => baseSet.has(project)),
    ...baseProjects,
  ].filter((project, index, projects) => projects.indexOf(project) === index);
  const activity = new Map(draftUpdates);
  if (!Array.isArray(recentUserMessageWorkspaces)) {
    for (const [root, updatedAt] of recentUserMessageWorkspaces as ReadonlyMap<string, number>) {
      activity.set(root, Math.max(activity.get(root) ?? 0, updatedAt));
    }
  }
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    const time = Date.parse(session.lastUserMessageAt ?? "");
    if (root && Number.isFinite(time)) activity.set(root, Math.max(activity.get(root) ?? 0, time));
  }
  // Stable ties retain saved ordering for workspaces with no known activity.
  return activity.size === 0 || (recentProjects.length > 0 && draftUpdates.size === 0)
    ? ordered
    : ordered.sort((a, b) => (activity.get(b) ?? 0) - (activity.get(a) ?? 0));
}
