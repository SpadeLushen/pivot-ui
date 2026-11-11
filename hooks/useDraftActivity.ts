"use client";

import { useEffect, useMemo, useState } from "react";
import { getDraftUpdates, subscribeDrafts } from "@/lib/draft-store";
import type { SessionInfo } from "@/lib/types";

export function useDraftActivity(sessions: readonly SessionInfo[], workspaceRoots: readonly string[]) {
  const [updates, setUpdates] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    const refresh = () => setUpdates(getDraftUpdates());
    const unsubscribe = subscribeDrafts(refresh);
    refresh();
    return unsubscribe;
  }, []);

  return useMemo(() => {
    const sessionRoots = new Map(sessions.map((s) => [s.id, s.projectRoot ?? s.cwd]));
    const cwdRoots = new Map(sessions.map((s) => [s.cwd, s.projectRoot ?? s.cwd]));
    const roots = [...new Set([...workspaceRoots, ...sessionRoots.values()])];
    const workspaceUpdates = new Map<string, number>();
    for (const [key, updatedAt] of updates) {
      const cwd = key.startsWith("new:") ? key.slice(4) : null;
      const root = cwd === null ? sessionRoots.get(key) : cwdRoots.get(cwd)
        ?? roots.find((root) => cwd === root || cwd.startsWith(`${root}-worktrees/`) || cwd.startsWith(`${root}-worktrees\\`))
        ?? cwd;
      if (root) workspaceUpdates.set(root, Math.max(workspaceUpdates.get(root) ?? 0, updatedAt));
    }
    return { draftSessionIds: new Set(updates.keys()), workspaceDraftUpdates: workspaceUpdates };
  }, [updates, sessions, workspaceRoots]);
}
