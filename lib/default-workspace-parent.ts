import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Paths in preferences refer to the server's filesystem, not the browser's. */
export function resolveDefaultWorkspaceParent(value: string): string {
  const path = value.trim();
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  if (!isAbsolute(path)) throw new Error("Default workspace parent must be an absolute path or start with ~/");
  return path;
}

export function createDefaultWorkspaceDirectory(parent: string, date: string): string {
  const dir = join(resolveDefaultWorkspaceParent(parent), `pi-cwd-${date}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
