import type { SessionInfo } from "./types";

export interface WorkspaceRecord {
  path: string;
  tag: string;
  /** Archived state; keep the legacy field name for registry/API compatibility. */
  removed: boolean;
}

export interface WorkspaceRegistry {
  version: 1;
  workspaces: WorkspaceRecord[];
}

export type WorkspacePatch = { path: string; tag?: string; removed?: boolean; tagIfEmpty?: boolean };
export type WorkspaceEntry = WorkspaceRecord & { name: string };

/** Tag automatically applied to workspaces created via "Use default directory". */
export const DEFAULT_WORKSPACE_TAG = "default";

export interface WorkspaceGroup {
  key: string;
  tag?: string;
  removed?: boolean;
  entries: WorkspaceEntry[];
}

/** Match the whole phrase (including spaces), not separate search tokens. */
export function groupWorkspaces(entries: readonly WorkspaceEntry[], query: string, mode: "status" | "tag"): WorkspaceGroup[] {
  const phrase = query.trim().toLocaleLowerCase();
  const matches = entries.filter((entry) => [entry.tag, entry.name, entry.path]
    .some((value) => value.toLocaleLowerCase().includes(phrase)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path));
  if (mode === "status") {
    return [
      { key: "active", entries: matches.filter((entry) => !entry.removed) },
      { key: "removed", removed: true, entries: matches.filter((entry) => entry.removed) },
    ];
  }
  const tags = [...new Set(matches.map((entry) => entry.tag))]
    .sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b));
  // Each tag has one non-collapsible section. Keep the name order within
  // each status, with archived workspaces at the end of that same section.
  return tags.map((tag) => {
    const tagged = matches.filter((entry) => entry.tag === tag);
    return {
      key: `tag:${tag}`,
      tag,
      entries: [...tagged.filter((entry) => !entry.removed), ...tagged.filter((entry) => entry.removed)],
    };
  });
}

export function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return path || "/";
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return normalized.slice(separator + 1) || normalized;
}

/** Include saved workspaces even when their last session has been deleted. */
export function getWorkspaceEntries(
  sessions: readonly Pick<SessionInfo, "cwd" | "projectRoot">[],
  records: readonly WorkspaceRecord[],
): WorkspaceEntry[] {
  const byPath = new Map<string, WorkspaceRecord>();
  for (const session of sessions) {
    const path = session.projectRoot ?? session.cwd;
    if (path) byPath.set(path, { path, tag: "", removed: false });
  }
  for (const record of records) byPath.set(record.path, record);
  return [...byPath.values()].map((record) => ({ ...record, name: workspaceName(record.path) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path));
}
