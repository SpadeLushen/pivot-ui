import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  try { writeFileSync(tmp, text, { encoding: "utf8", mode }); renameSync(tmp, path); }
  finally { rmSync(tmp, { force: true }); }
}
