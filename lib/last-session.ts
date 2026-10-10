// Last-opened destination is device-local UI state.
const STORAGE_KEY = "pi-last-session";
export type LastChat = { kind: "session"; sessionId: string } | { kind: "new"; cwd: string };

const WORKSPACE_PREFIX = "pi-workspace-last-chat:";

export function loadLastChat(workspace?: string): LastChat | null {
  try {
    const key = workspace ? WORKSPACE_PREFIX + workspace : STORAGE_KEY;
    const raw = localStorage.getItem(key)?.trim();
    if (!raw) return null;
    // Keep the session IDs saved by the original session-only implementation.
    if (!raw.startsWith("{")) return { kind: "session", sessionId: raw };
    const value = JSON.parse(raw) as Partial<LastChat>;
    if (value.kind === "session" && typeof value.sessionId === "string" && value.sessionId) {
      return { kind: "session", sessionId: value.sessionId };
    }
    if (value.kind === "new" && typeof value.cwd === "string" && value.cwd) {
      return { kind: "new", cwd: value.cwd };
    }
  } catch {
    // Storage may be unavailable or malformed.
  }
  return null;
}

export function saveLastChat(chat: LastChat, workspace?: string): void {
  try {
    const value = JSON.stringify(chat);
    localStorage.setItem(STORAGE_KEY, value);
    if (workspace) localStorage.setItem(WORKSPACE_PREFIX + workspace, value);
  } catch {
    // Navigation must still work when storage is unavailable or full.
  }
}

export function forgetLastSessionId(sessionId: string): void {
  try {
    const chat = loadLastChat();
    if (chat?.kind === "session" && chat.sessionId === sessionId) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage availability must not affect session navigation.
  }
}
