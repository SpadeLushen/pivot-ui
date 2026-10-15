import type { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPreferences, updatePreferences } from "./preferences";
import { resolveDefaultWorkspaceParent } from "./default-workspace-parent";
import type { SessionSearchAction, SessionSearchStatus } from "./session-search-types";

const APPLICATION_ID = 0x50565353;
const SCHEMA_VERSION = 1;
interface SearchState {
  db?: DatabaseSync;
  path?: string;
  chain: Promise<unknown>;
  job?: Promise<void>;
  generation: number;
  busy: boolean;
  completed: number;
  total: number;
  error: string | null;
  revision: number;
  lastScan: number;
  timer?: ReturnType<typeof setInterval>;
}
declare global { var __pivotSessionSearch: SearchState | undefined; }
const state = globalThis.__pivotSessionSearch ??= {
  chain: Promise.resolve(), generation: 0, busy: false,
  completed: 0, total: 0, error: null, revision: 0, lastScan: 0,
};
const databasePath = (value: string) => resolve(resolveDefaultWorkspaceParent(value));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = state.chain.then(operation);
  state.chain = run.catch(() => undefined);
  return run;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function vacant(path: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (await exists(path + suffix)) throw new Error("Destination already exists: " + path + suffix);
  }
}
function closeDatabase() {
  state.db?.close();
  state.db = undefined;
  state.path = undefined;
}
async function connect(path: string): Promise<DatabaseSync> {
  if (state.db && state.path === path) return state.db;
  closeDatabase();
  const { DatabaseSync } = await import("node:sqlite");
  const present = await exists(path);
  if (present) {
    if (!(await lstat(path)).isFile()) throw new Error("Database path must be a regular file");
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      const row = check.prepare("PRAGMA application_id").get();
      if (row?.application_id !== APPLICATION_ID) throw new Error("Not a Pivot session search database");
    } finally { check.close(); }
  } else {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, "wx", 0o600);
    await file.close();
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    if (!present) db.exec("PRAGMA application_id=" + APPLICATION_ID);
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== SCHEMA_VERSION) throw new Error("Unsupported search cache version");
    initialize(db);
    await chmod(path, 0o600);
    state.db = db;
    state.path = path;
    return db;
  } catch (error) {
    db?.close();
    if (!present) await unlink(path).catch(() => undefined);
    throw error;
  }
}
function initialize(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      path TEXT PRIMARY KEY, id TEXT NOT NULL,
      modified REAL NOT NULL, changed REAL NOT NULL, bytes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      path TEXT NOT NULL REFERENCES sessions(path) ON DELETE CASCADE,
      entry_id TEXT NOT NULL, text TEXT NOT NULL,
      PRIMARY KEY (path, entry_id)
    );
    PRAGMA user_version=1;
  `);
}
async function sessionFiles(): Promise<string[]> {
  const root = join(getAgentDir(), "sessions");
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (directory === root && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}
function textOnly(content: unknown, user: boolean): string {
  const texts = typeof content === "string" ? [content] : Array.isArray(content)
    ? content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string) : [];
  // Attachments (including legacy inline file contents) are not message text.
  return texts.map((text) => user
    ? text.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, "") : text).join("\n").trim();
}
async function readTexts(path: string, generation: number) {
  let id = "";
  const messages: { id: string; text: string }[] = [];
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (generation !== state.generation) return null;
      if (!line.trim()) continue;
      // An active writer may leave a partial final line. Retry the file later.
      const entry = JSON.parse(line);
      if (entry.type === "session" && typeof entry.id === "string") id = entry.id;
      const role = entry.message?.role;
      if (entry.type === "message" && typeof entry.id === "string" && (role === "user" || role === "assistant")) {
        const text = textOnly(entry.message.content, role === "user");
        if (text) messages.push({ id: entry.id, text: text.toLowerCase() });
      }
      if (++count % 100 === 0) await yieldTurn();
    }
  } finally { lines.close(); input.destroy(); }
  if (!id) throw new Error("Invalid session header: " + path);
  return { id, messages };
}
async function indexFile(db: DatabaseSync, path: string, generation: number) {
  const before = await stat(path);
  const cached = db.prepare("SELECT modified, changed, bytes FROM sessions WHERE path=?").get(path);
  if (cached?.modified === before.mtimeMs && cached.changed === before.ctimeMs && cached.bytes === before.size) return;
  const content = await readTexts(path, generation);
  if (!content || generation !== state.generation) return;
  const after = await stat(path);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || before.ctimeMs !== after.ctimeMs) return;
  replaceSession(db, path, after, content);
}
function replaceSession(db: DatabaseSync, path: string, file: { mtimeMs: number; ctimeMs: number; size: number }, content: { id: string; messages: { id: string; text: string }[] }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM sessions WHERE path=?").run(path);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(path, content.id, file.mtimeMs, file.ctimeMs, file.size);
    const insert = db.prepare("INSERT OR REPLACE INTO messages VALUES (?, ?, ?)");
    for (const item of content.messages) insert.run(path, item.id, item.text);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
async function scan(db: DatabaseSync, generation: number) {
  const files = await sessionFiles();
  if (generation !== state.generation) return;
  state.total = files.length;
  const present = new Set(files);
  for (const row of db.prepare("SELECT path FROM sessions").all()) {
    if (!present.has(String(row.path))) db.prepare("DELETE FROM sessions WHERE path=?").run(String(row.path));
  }
  for (const path of files) {
    if (generation !== state.generation) return;
    try { await indexFile(db, path, generation); }
    catch (error) {
      if (generation === state.generation) state.error = message(error);
    }
    if (generation !== state.generation) return;
    state.completed++;
    await yieldTurn();
  }
}
function startScan(db: DatabaseSync, force = false) {
  if (state.job || state.busy || (!force && Date.now() - state.lastScan < 15_000)) return;
  state.completed = 0;
  state.total = 0;
  state.error = null;
  state.lastScan = Date.now();
  state.job = scan(db, state.generation).catch((error) => { state.error = message(error); }).finally(() => {
    state.job = undefined;
    state.revision++;
  });
}
export function requestSessionSearchSync(force = false): void {
  void serialized(async () => {
    const preferences = readPreferences();
    if (!preferences["session-search-enabled"] || state.busy) return;
    try {
      const db = await connect(databasePath(preferences["session-search-path"]));
      startScan(db, force);
      if (!state.timer) {
        state.timer = setInterval(() => requestSessionSearchSync(), 30_000);
        state.timer.unref();
      }
    } catch (error) { state.error = message(error); }
  });
}
async function snapshot(): Promise<SessionSearchStatus> {
  const preferences = readPreferences();
  let bytes = 0;
  const path = databasePath(preferences["session-search-path"]);
  try { bytes = (await stat(path)).size; } catch { /* Missing cache. */ }
  return {
    enabled: preferences["session-search-enabled"], path: preferences["session-search-path"],
    bytes, indexing: Boolean(state.job) || state.busy,
    completed: state.completed, total: state.total, error: state.error, revision: state.revision,
  };
}
export async function sessionSearchStatus() {
  requestSessionSearchSync();
  return serialized(snapshot);
}
export async function searchSessionText(query: string): Promise<{ ids: string[]; status: SessionSearchStatus }> {
  requestSessionSearchSync();
  return serialized(async () => {
    const preferences = readPreferences();
    const ids: string[] = [];
    if (preferences["session-search-enabled"]) {
      const db = await connect(databasePath(preferences["session-search-path"]));
      const rows = db.prepare("SELECT path, id FROM sessions").all();
      const match = db.prepare("SELECT 1 FROM messages WHERE path=? AND instr(text, ?) > 0 LIMIT 1");
      const phrase = query.trim().toLowerCase();
      // Yield between groups of sessions so a full scan does not monopolize
      // the server event loop. Lifecycle operations wait on this queue.
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (match.get(String(row.path), phrase)) ids.push(String(row.id));
        if (index % 16 === 15) await yieldTurn();
      }
    }
    return { ids, status: await snapshot() };
  });
}
async function stopIndexing() {
  state.generation++;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  await state.job;
}
async function removeCache(path: string) {
  if (!await exists(path)) return;
  // Never delete an unrelated file at a configured path.
  const db = await connect(path);
  // Clear private text even when an OS file lock prevents file deletion.
  db.exec("DELETE FROM sessions; VACUUM;");
  closeDatabase();
  await unlink(path);
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    await unlink(path + suffix).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
async function moveCache(path: string) {
  const preferences = readPreferences();
  const source = databasePath(preferences["session-search-path"]);
  const target = databasePath(path);
  if (source === target) return;
  await vacant(target);
  const hasSource = await exists(source);
  if (hasSource) await connect(source);
  closeDatabase();
  await mkdir(dirname(target), { recursive: true });
  let copied = false;
  let savedPath = false;
  try {
    if (hasSource) {
      // COPYFILE_EXCL prevents overwrites, including across filesystems.
      await copyFile(source, target, constants.COPYFILE_EXCL);
      copied = true;
      await connect(target);
      closeDatabase();
    }
    await updatePreferences({ "session-search-path": path.trim() });
    savedPath = true;
    if (hasSource) await unlink(source);
  } catch (error) {
    closeDatabase();
    if (savedPath) {
      // The source still exists if removal failed. Restore the active path
      // before removing the new copy; never discard the only usable cache.
      try { await updatePreferences({ "session-search-path": preferences["session-search-path"] }); }
      catch (rollback) { throw new AggregateError([error, rollback], "Migration rollback failed; both database copies were retained"); }
    }
    if (copied) await unlink(target);
    throw error;
  }
}
export async function configureSessionSearch(action: SessionSearchAction) {
  return serialized(async () => {
    if (action.action === "check-path") {
      await vacant(databasePath(action.path));
      return snapshot();
    }
    state.busy = true;
    state.error = null;
    try {
      await stopIndexing();
      const preferences = readPreferences();
      const path = databasePath(preferences["session-search-path"]);
      switch (action.action) {
        case "enable":
          await connect(path);
          await updatePreferences({ "session-search-enabled": true });
          break;
        case "disable":
          await updatePreferences({ "session-search-enabled": false });
          await removeCache(path);
          closeDatabase();
          state.completed = state.total = 0;
          break;
        case "rebuild": {
          if (!preferences["session-search-enabled"]) throw new Error("Session text search is disabled");
          const db = await connect(path);
          db.exec("DELETE FROM sessions; VACUUM;");
          break;
        }
        case "move":
          await moveCache(action.path);
          break;
      }
      state.revision++;
    } catch (error) {
      state.error = message(error);
      throw error;
    } finally {
      state.busy = false;
      if (readPreferences()["session-search-enabled"] && state.db) startScan(state.db, true);
      requestSessionSearchSync(true);
    }
    return snapshot();
  });
}

