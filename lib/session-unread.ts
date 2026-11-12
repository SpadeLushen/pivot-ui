import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getPivotUiConfigDir } from "./attachment-config";

export type UnreadStatus = "success" | "error" | "waiting";
export type UnreadSessions = Record<string, UnreadStatus>;
type Listener = (state: UnreadSessions) => void;

declare global {
  var __pivotUnreadListeners: Set<Listener> | undefined;
}

const path = () => join(getPivotUiConfigDir(), "session-unread.json");

export function readUnreadSessions(): UnreadSessions {
  let text: string;
  try { text = readFileSync(path(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid unread session state");
  const result: UnreadSessions = Object.create(null);
  for (const [id, status] of Object.entries(value)) {
    if (status !== "success" && status !== "error" && status !== "waiting") throw new Error("Invalid unread session status");
    result[id] = status;
  }
  return result;
}

export function subscribeUnreadSessions(listener: Listener): () => void {
  const listeners = globalThis.__pivotUnreadListeners ??= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setUnreadSession(id: string, status: UnreadStatus | null, only?: UnreadStatus | "readable"): UnreadSessions {
  const state = readUnreadSessions();
  const current = state[id];
  if (only && (only === "readable" ? current !== "success" && current !== "error" : current !== only)) return state;
  if (current === status || (!current && status === null)) return state;
  if (status) state[id] = status;
  else delete state[id];
  const target = path();
  mkdirSync(getPivotUiConfigDir(), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
  } finally { try { unlinkSync(temporary); } catch { /* already moved */ } }
  for (const listener of globalThis.__pivotUnreadListeners ?? []) {
    try { listener(state); } catch { /* disconnected listener */ }
  }
  return state;
}
