import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * Preserve Pivot's existing empty-session visibility, including empty forks.
 * Once a conversation starts, pi 0.99 persists from the first user message.
 * Re-open through the public API so pi adopts the file without touching its
 * private flushed flag or racing the first deferred wx write.
 */
export function persistEmptySession(manager: SessionManager): void {
  const file = manager.getSessionFile();
  if (!manager.isPersisted() || !file) return;
  const entries = manager.getEntries();
  if (entries.some((entry) => entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant"))) return;
  const header = manager.getHeader();
  if (!header) throw new Error("Session is missing its header");
  mkdirSync(dirname(file), { recursive: true });
  const snapshot = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(file, snapshot, { encoding: "utf8", flag: existsSync(file) ? "w" : "wx" });
  manager.setSessionFile(file);
}
