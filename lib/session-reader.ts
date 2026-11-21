import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "fs";
import { normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { getLastThinkingLine } from "./message-display";
import { normalizeToolCalls } from "./normalize";
import { branchModelSelection } from "./session-models";
import { resolveSessionProject, type ProjectInfo } from "./worktree";
import { discoverSessionFiles, indexedSessionPath, isDiscoveredSessionPath, scanSessionIndex } from "./session-file-index";
import type { SessionIndexStatus } from "./session-index-types";

export { getAgentDir };

/** Find the latest user-authored message in a session, ignoring assistant replies. */
export function getLastUserMessageAt(entries: readonly SessionEntry[]): string | undefined {
  let latest = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const timestamp = typeof entry.message.timestamp === "number"
      ? entry.message.timestamp
      : Date.parse(entry.timestamp);
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
}

async function loadAllSessions(force = false, progress?: (completed: number, total: number) => void): Promise<SessionInfo[]> {
  const sessions = await scanSessionIndex(force, progress);
  const pathToId = new Map<string, string>();
  for (const s of sessions) pathToId.set(normalizePath(s.path), s.id);
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, Pick<ProjectInfo, "projectRoot" | "isWorktree" | "branch">>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveSessionProject(cwd));
  }));

  return sessions.map(({ parentSessionPath, ...summary }) => {
    const project = projectByCwd.get(summary.cwd);
    return {
      ...summary,
      parentSessionId: parentSessionPath ? pathToId.get(normalizePath(parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? summary.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      publishSessionList(data);
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;
const indexGlobals = globalThis as typeof globalThis & {
  __pivotSessionIndexStatus?: SessionIndexStatus;
  __pivotSessionIndexListeners?: Set<() => void>;
};

export function subscribeSessionIndexRebuilt(listener: () => void) {
  const listeners = indexGlobals.__pivotSessionIndexListeners ??= new Set();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publishSessionList(data: SessionInfo[]) {
  for (const s of data) cacheSessionPath(s.id, s.path);
  globalThis.__piSessionListCache = { data, ts: Date.now() };
}

export function sessionIndexStatus(): SessionIndexStatus {
  return indexGlobals.__pivotSessionIndexStatus ?? { rebuilding: false, completed: 0, total: 0, revision: 0 };
}

export function listSessionsForSidebar() {
  const cache = globalThis.__piSessionListCache;
  if (cache && sessionIndexStatus().rebuilding) return Promise.resolve(cache.data);
  return listAllSessions();
}

export function startSessionIndexRebuild(): SessionIndexStatus {
  const current = sessionIndexStatus();
  if (current.rebuilding) return current;
  const generation = globalThis.__piSessionListGeneration ?? 0;
  const status: SessionIndexStatus = { rebuilding: true, completed: 0, total: 0, revision: current.revision };
  indexGlobals.__pivotSessionIndexStatus = status;
  void loadAllSessions(true, (completed, total) => Object.assign(status, { completed, total })).then((data) => {
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      invalidateSessionListCache();
      publishSessionList(data);
    }
    status.revision++;
  }).catch((error) => { status.error = String(error); }).finally(() => {
    status.rebuilding = false;
    if (!status.error) for (const listener of indexGlobals.__pivotSessionIndexListeners ?? []) listener();
  });
  return status;
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached && existsSync(cached)) return cached;
  if (cached) invalidateSessionPathCache(sessionId);

  let lookupError: unknown;
  const recordError = (error: unknown) => { lookupError ??= error; };
  const matchesId = (path: string) => {
    try { return discoveryHeader(path)?.id === sessionId; }
    catch (error) { recordError(error); return false; }
  };

  const indexed = await indexedSessionPath(sessionId);
  if (indexed && matchesId(indexed)) {
    cacheSessionPath(sessionId, indexed);
    return indexed;
  }

  const files = await discoverSessionFiles(undefined, recordError);
  // Pi names its files with the session ID. Verify the header, then fall back
  // to header-only discovery for imported or renamed files.
  const matchesName = (path: string) => path.endsWith(`_${sessionId}.jsonl`);
  for (const path of [...files.filter(matchesName), ...files.filter((path) => !matchesName(path))]) {
    if (path !== indexed && matchesId(path)) {
      cacheSessionPath(sessionId, path);
      return path;
    }
  }
  if (lookupError) throw lookupError;
  return null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  if (!isDiscoveredSessionPath(pathKey)) return undefined;
  const id = discoveryHeader(pathKey)?.id;
  if (id) cacheSessionPath(id, pathKey);
  return id;
}

function discoveryHeader(path: string): SessionHeader | null {
  try { return readSessionHeader(path, 1024 * 1024); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return null;
    throw error;
  }
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const pathKey = normalizePath(filePath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousSessionId = reverseCache.get(pathKey);
  if (previousPath && previousPath !== pathKey && reverseCache.get(previousPath) === sessionId) {
    reverseCache.delete(previousPath);
  }
  if (previousSessionId && previousSessionId !== sessionId && pathCache.get(previousSessionId) === pathKey) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, pathKey);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  if (filePath && reverseCache.get(filePath) === sessionId) {
    reverseCache.delete(filePath);
  }
}

export function readSessionHeader(filePath: string, maxHeaderBytes = 64 * 1024): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    if (!fstatSync(fd).isFile()) return null;
    const chunks: Buffer[] = [];
    // Like the SDK, skip unparsable lines but reject a first entry that
    // is not a session header.
    const parseLine = (): SessionHeader | null | undefined => {
      const line = Buffer.concat(chunks).toString("utf8");
      chunks.length = 0;
      try {
        const entry = JSON.parse(line);
        if (entry == null) return undefined;
        return entry.type === "session" && typeof entry.id === "string" ? entry : null;
      } catch { return undefined; }
    };

    let position = 0;
    while (position < maxHeaderBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) return parseLine() ?? null;
      const data = buffer.subarray(0, bytesRead);
      position += bytesRead;
      let start = 0;
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a, start)) {
        chunks.push(data.subarray(start, newline));
        const header = parseLine();
        if (header !== undefined) return header;
        start = newline + 1;
      }
      if (start < data.length) chunks.push(data.subarray(start));
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  const entryTimestamps: (number | null)[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
      entryTimestamps.push(parseEntryTimestamp(localEntry.timestamp) ?? null);
    }
  }

  return {
    messages,
    entryIds,
    entryTimestamps,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model, // Legacy context API: actual response or last model_change.
    ...branchModelSelection(entries, leafId),
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage, entryId: string): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const images: { blockIndex: number; mimeType?: string }[] = [];
  const content = message.content.filter((block, blockIndex) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    images.push({ blockIndex, mimeType: image.mime });
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  const noticeIndex = content.length;
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content, deferredImages: { entryId, noticeIndex, images } };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message), entry.id)
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", thinkingPreview: getLastThinkingLine(block.thinking), deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
