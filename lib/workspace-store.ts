import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { getPivotUiConfigDir } from "./attachment-config";
import type { WorkspacePatch, WorkspaceRegistry } from "./workspace-registry";

export const getWorkspacesPath = () => join(getPivotUiConfigDir(), "workspaces.json");

export async function readWorkspaces(path = getWorkspacesPath()): Promise<WorkspaceRegistry> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, workspaces: [] };
    throw error;
  }
  const data = JSON.parse(text) as WorkspaceRegistry;
  if (data?.version !== 1 || !Array.isArray(data.workspaces)) throw new Error("Invalid workspace registry");
  // Refuse to overwrite a corrupt file rather than silently resetting it.
  const workspaces = data.workspaces.map((record) => ({ tag: "", removed: false, ...parseWorkspacePatch(record) }));
  return { version: 1, workspaces };
}

async function saveWorkspaces(path: string, data: WorkspaceRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

declare global {
  var __pivotWorkspaceWrites: Promise<unknown> | undefined;
}

/** Field-level changes are serialized across requests and Next hot reloads. */
export function updateWorkspaces(patches: WorkspacePatch[], path = getWorkspacesPath()): Promise<WorkspaceRegistry> {
  const run = (globalThis.__pivotWorkspaceWrites ?? Promise.resolve()).then(async () => {
    const data = await readWorkspaces(path);
    const records = new Map(data.workspaces.map((record) => [record.path, record]));
    for (const input of patches) {
      const patch = parseWorkspacePatch(input);
      records.set(patch.path, { tag: "", removed: false, ...records.get(patch.path), ...patch });
    }
    const next: WorkspaceRegistry = { version: 1, workspaces: [...records.values()] };
    await saveWorkspaces(path, next);
    return next;
  });
  globalThis.__pivotWorkspaceWrites = run.catch(() => undefined);
  return run;
}

export function parseWorkspacePatch(value: unknown): WorkspacePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a workspace object");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["path", "tag", "removed"].includes(key))) throw new Error("Unknown workspace field");
  if (typeof data.path !== "string" || data.path.length > 32768 || /[\x00-\x1f]/.test(data.path)
    || !(posix.isAbsolute(data.path) || win32.isAbsolute(data.path))) throw new Error("An absolute workspace path is required");
  const patch: WorkspacePatch = { path: data.path };
  if ("tag" in data) {
    if (typeof data.tag !== "string" || data.tag.length > 120 || /[\x00-\x1f]/.test(data.tag)) throw new Error("Tag must be at most 120 characters on one line");
    patch.tag = data.tag.trim();
  }
  if ("removed" in data) {
    if (typeof data.removed !== "boolean") throw new Error("removed must be a boolean");
    patch.removed = data.removed;
  }
  return patch;
}
