import type { SessionContext, SessionInfo, SessionTreeNode } from "./types";

export interface SessionData {
  sessionId: string;
  filePath: string;
  missingCwd?: boolean;
  info?: SessionInfo | null;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: SessionContext;
}

export function sessionDetailUrl(id: string, checkCwd = false) {
  return `/api/sessions/${encodeURIComponent(id)}?deferThinking=1&deferMedia=1${checkCwd ? "&checkCwd=1" : ""}`;
}
