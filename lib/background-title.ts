export type BackgroundTitleStatus = "ongoing" | "done" | null;

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
