import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export function canonicalWorkspace(cwd: string): string { return realpathSync(resolve(cwd)); }
export function workspaceKey(cwd: string): string {
  let path: string;
  try { path = canonicalWorkspace(cwd); } catch { path = resolve(cwd); }
  return process.platform === "win32" ? path.toLowerCase() : path;
}
export function workspaceFile(cwd: string, name: string): string {
  const root = canonicalWorkspace(cwd), configRoot = resolve(root, ".pi"), path = resolve(configRoot, name);
  const within = relative(configRoot, path);
  if (!within || isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`) || resolve(configRoot, within) !== path) throw new Error("Pack path escapes workspace");
  for (let item = path; item !== root; item = dirname(item)) {
    if (existsSync(item)) {
      if (lstatSync(item).isSymbolicLink()) throw new Error("Pack configuration cannot traverse symlinks");
      const rel = relative(root, realpathSync(item));
      if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Pack path escapes workspace");
    }
  }
  return path;
}
export interface PackFile { path: string; before: string | null; value: Record<string, unknown> }
export function readPackFile(path: string): PackFile {
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const value = before === null ? {} : JSON.parse(before.replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Pack configuration object");
  return { path, before, value };
}
/** Preserve source encoding marker and newline style; before remains byte-for-byte rollback data. */
export function formatPackFile(file: PackFile, value: Record<string, unknown>): string {
  const indent = file.before?.match(/^([ \t]+)\S/m)?.[1] ?? "  ";
  let text = `${JSON.stringify(value, null, indent)}\n`;
  if (file.before?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
  return (file.before?.startsWith("\uFEFF") ? "\uFEFF" : "") + text;
}
export function savePackFile(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  const permissions = mode ?? (existsSync(path) ? statSync(path).mode & 0o777 : 0o600);
  try { writeFileSync(tmp, text, { encoding: "utf8", mode: permissions }); renameSync(tmp, path); }
  finally { rmSync(tmp, { force: true }); }
}

/** Release only the value Packs write. Preserve later user edits and all other fields. */
export function releasePackMcpEnabled(servers: Map<string, unknown>, name: string): void {
  const previous = servers.get(name);
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return;
  const entry = { ...previous } as Record<string, unknown>;
  if (entry.enabled !== true) return;
  delete entry.enabled;
  if (Object.keys(entry).length) servers.set(name, entry);
  else servers.delete(name);
}

export class PackFileConflict extends Error {}

export function commitPackFiles(changes: { file: PackFile; value: Record<string, unknown> }[], watched: PackFile[], beforeStateWrite?: () => void) {
  const writes = changes.map(({ file, value }) => ({ file, text: formatPackFile(file, value) }));
  for (const file of [...writes.map((write) => write.file), ...watched]) {
    const current = existsSync(file.path) ? readFileSync(file.path, "utf8") : null;
    if (current !== file.before) throw new PackFileConflict("Pack configuration changed; retry the operation");
  }
  const committed: typeof writes = [];
  try {
    for (const write of writes) {
      if (write === writes.at(-1)) beforeStateWrite?.();
      savePackFile(write.file.path, write.text);
      committed.push(write);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const { file, text } of committed.reverse()) {
      try {
        if (readFileSync(file.path, "utf8") !== text) throw new Error("Configuration was edited externally");
        if (file.before === null) rmSync(file.path); else savePackFile(file.path, file.before);
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Pack rollback conflict; external edits were preserved");
    throw error;
  }
}
