import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getPivotUiConfigDir } from "./attachment-config";
import type { SessionInfo } from "./types";

export type SessionSummary = Omit<SessionInfo, "parentSessionId" | "projectRoot" | "worktreeBranch"> & {
  parentSessionPath?: string;
};
type Row = { stamp: string; summary: SessionSummary | null };
type Snapshot = { rows: Map<string, Row>; paths: Map<string, string> };
const VERSION = 1;

const globals = globalThis as typeof globalThis & {
  __pivotSessionFileIndex?: { root: string; snapshot: Promise<Snapshot>; pending: Promise<unknown> };
};

function sessionsRoot() { return resolve(getAgentDir(), "sessions"); }
function indexPath() { return join(getPivotUiConfigDir(), "session-list-index.json"); }

function isMissing(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function isDiscoveredSessionPath(path: string, root = sessionsRoot()) {
  const parts = relative(root, path).split(sep);
  return parts.length === 2 && parts[0] !== ".." && parts[1].endsWith(".jsonl");
}

async function entries(path: string) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) { if (isMissing(error)) return []; throw error; }
}

export async function discoverSessionFiles(root = sessionsRoot(), onDirectoryError?: (error: unknown) => void) {
  const dirs = (await entries(root)).filter((item) => item.isDirectory() || item.isSymbolicLink());
  return (await Promise.all(dirs.map(async ({ name }) => {
    const directory = join(root, name);
    try {
      return (await entries(directory))
        .filter((item) => (item.isFile() || item.isSymbolicLink()) && item.name.endsWith(".jsonl"))
        .map((item) => join(directory, item.name));
    } catch (error) {
      if (!onDirectoryError) throw error;
      onDirectoryError(error);
      return [];
    }
  }))).flat();
}

function makeSnapshot(rows: Map<string, Row>): Snapshot {
  const paths = new Map<string, string>();
  for (const [path, { summary }] of rows) if (summary) paths.set(summary.id, path);
  return { rows, paths };
}

async function readIndex(root: string) {
  const rows = new Map<string, Row>();
  try {
    const data = JSON.parse(await readFile(indexPath(), "utf8"));
    if (data.version === VERSION && data.root === root && Array.isArray(data.rows)) {
      for (const row of data.rows) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !isDiscoveredSessionPath(row[0], root)) continue;
        const [path, record] = row;
        if (typeof record?.stamp !== "string") continue;
        const s = record.summary;
        if (s !== null && (!s || s.path !== path || typeof s.id !== "string" || typeof s.cwd !== "string" ||
          typeof s.modified !== "string" || typeof s.created !== "string" || typeof s.firstMessage !== "string" ||
          typeof s.messageCount !== "number" || (s.name !== undefined && typeof s.name !== "string") ||
          (s.lastUserMessageAt !== undefined && typeof s.lastUserMessageAt !== "string") ||
          (s.parentSessionPath !== undefined && typeof s.parentSessionPath !== "string"))) continue;
        rows.set(path, record);
      }
    }
  } catch { /* The index is disposable; recreate it from the session files. */ }
  return makeSnapshot(rows);
}

function getState() {
  const root = sessionsRoot();
  const current = globals.__pivotSessionFileIndex;
  if (current?.root === root) return current;
  return globals.__pivotSessionFileIndex = { root, snapshot: readIndex(root), pending: Promise.resolve() };
}

export async function indexedSessionPath(id: string) {
  return (await getState().snapshot).paths.get(id);
}

async function summarize(path: string, fileMtime: number): Promise<SessionSummary | null> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let summary: SessionSummary | undefined;
  let lastActivity = 0;
  let lastUserMessage = -Infinity;
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count % 256 === 0) await yieldTurn();
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry === null) continue;
      if (!summary) {
        if (entry.type !== "session" || typeof entry.id !== "string" || !entry.id) return null;
        const created = new Date(entry.timestamp);
        summary = {
          path, id: entry.id, cwd: typeof entry.cwd === "string" ? entry.cwd : "",
          created: Number.isFinite(created.getTime()) ? created.toISOString() : String(created),
          modified: new Date(fileMtime).toISOString(), messageCount: 0, firstMessage: "",
          ...(typeof entry.parentSession === "string" ? { parentSessionPath: entry.parentSession } : {}),
        };
      } else if (entry.type === "session_info") {
        summary.name = typeof entry.name === "string" ? entry.name.trim() || undefined : undefined;
      } else if (entry.type === "message") {
        summary.messageCount++;
        const message = entry.message;
        if (message?.role !== "user" && message?.role !== "assistant") continue;
        const time = typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp);
        if (Number.isFinite(time)) {
          if ("content" in message) lastActivity = Math.max(lastActivity, time);
          if (message.role === "user") lastUserMessage = Math.max(lastUserMessage, time);
        }
        if (message.role === "user" && !summary.firstMessage) {
          const content = message.content;
          summary.firstMessage = typeof content === "string" ? content : Array.isArray(content)
            ? content.filter((block) => block?.type === "text").map((block) => block.text).join(" ") : "";
        }
      }
    }
  } finally { lines.close(); input.destroy(); }
  if (!summary) return null;
  if (lastActivity > 0) summary.modified = new Date(lastActivity).toISOString();
  else if (Number.isFinite(Date.parse(summary.created))) summary.modified = summary.created;
  if (Number.isFinite(lastUserMessage)) summary.lastUserMessageAt = new Date(lastUserMessage).toISOString();
  summary.firstMessage ||= "(no messages)";
  return summary;
}

async function fileStamp(path: string) {
  const s = await stat(path, { bigint: true });
  return s.isFile() ? { key: `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`, mtime: Number(s.mtimeMs) } : null;
}

async function refreshRow(path: string, old: Row | undefined, force: boolean): Promise<Row | undefined> {
  let before = await fileStamp(path);
  if (!before) return;
  if (!force && old?.stamp === before.key) return old;
  for (let attempt = 0; attempt < 2; attempt++) {
    const summary = await summarize(path, before.mtime);
    const after = await fileStamp(path);
    if (!after) return;
    if (before.key === after.key) return { stamp: after.key, summary };
    before = after;
  }
  // An active writer changed the file during both reads. Keep its old stamp so
  // the next incremental scan retries rather than caching a partial summary.
  return old;
}

async function saveIndex(root: string, rows: Map<string, Row>) {
  const path = indexPath();
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, JSON.stringify({ version: VERSION, root, rows: [...rows] }), { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => undefined); }
}

type ScanProgress = (completed: number, total: number) => void;

export function scanSessionIndex(force = false, progress?: ScanProgress): Promise<SessionSummary[]> {
  const state = getState();
  const job = state.pending.then(async () => {
    const { rows: previous } = await state.snapshot;
    const files = await discoverSessionFiles(state.root);
    const rows = new Map<string, Row>();
    let next = 0;
    let completed = 0;
    let failure: unknown;
    progress?.(0, files.length);
    await Promise.all(Array.from({ length: Math.min(force ? 2 : 8, files.length) }, async () => {
      while (!failure && next < files.length) {
        const path = files[next++];
        const old = previous.get(path);
        try {
          const row = await refreshRow(path, old, force);
          if (row) rows.set(path, row);
        } catch (error) {
          if (!isMissing(error)) {
            if (force) failure = error;
            else if (old) rows.set(path, old);
          }
        }
        progress?.(++completed, files.length);
      }
    }));
    if (failure) throw failure;
    if (force || rows.size !== previous.size || [...rows].some(([path, row]) => previous.get(path) !== row)) {
      try { await saveIndex(state.root, rows); }
      catch (error) { if (force) throw error; console.warn("Could not save the session list index:", error); }
    }
    state.snapshot = Promise.resolve(makeSnapshot(rows));
    return [...rows.values()].flatMap(({ summary }) => summary ? [summary] : [])
      .sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));
  });
  state.pending = job.catch(() => undefined);
  return job;
}
