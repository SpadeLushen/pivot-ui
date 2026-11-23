import { statSync } from "node:fs";

/** Unknown (e.g. a permissions error) must not make a transcript unreadable. */
export function sessionDirectoryMissing(cwd: string): boolean {
  try {
    return !statSync(cwd).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;
    throw error;
  }
}
