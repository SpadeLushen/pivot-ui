import type { SessionInfo } from "./types";

export type BackgroundTitleStatus = "ongoing" | "done" | null;

/** Match the session list's title, falling back to the app name for an empty chat. */
export function getSessionDocumentTitle(session: Pick<SessionInfo, "name" | "firstMessage"> | null): string {
  return session?.name || (session?.firstMessage && session.firstMessage !== "(no messages)"
    ? session.firstMessage.slice(0, 50) : "Pivot UI");
}

/** A completion badge only follows a run observed while this tab was away. */
export function nextBackgroundTitleStatus(
  previous: BackgroundTitleStatus,
  isAway: boolean,
  isRunning: boolean,
  hasSession: boolean,
): BackgroundTitleStatus {
  if (!isAway || !hasSession) return null;
  if (isRunning) return "ongoing";
  return previous === "ongoing" ? "done" : previous;
}
