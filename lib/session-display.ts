import type { SessionInfo } from "./types";

/** Keep search titles in sync with the sidebar's displayed session titles. */
export function sessionTitle(session: Pick<SessionInfo, "name" | "firstMessage" | "id">): string {
  return session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
