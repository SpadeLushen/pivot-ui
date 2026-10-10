import { existsSync, lstatSync, readFileSync, rmSync, statSync } from "node:fs";
import { savePackFile, type PackFile } from "./workspace-pack-files";

export function readToolSettingsFile(path: string): PackFile {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Settings cannot traverse symlinks");
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const value: unknown = before === null ? {} : JSON.parse(before.replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings object");
  return { path, before, value: value as Record<string, unknown> };
}
export function saveToolSettingsFile(file: PackFile, value: Record<string, unknown>): void {
  if (existsSync(file.path) && lstatSync(file.path).isSymbolicLink()) throw new Error("Settings cannot traverse symlinks");
  const indent = file.before?.match(/^([ \t]+)\S/m)?.[1] ?? "  ";
  let text = JSON.stringify(value, null, indent) + "\n";
  if (file.before?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
  if (file.before?.startsWith("\uFEFF")) text = "\uFEFF" + text;
  savePackFile(file.path, text, existsSync(file.path) ? statSync(file.path).mode & 0o777 : 0o600);
}
export function restoreToolSettingsFile(file: PackFile): void {
  if (file.before === null) rmSync(file.path, { force: true });
  else savePackFile(file.path, file.before, existsSync(file.path) ? statSync(file.path).mode & 0o777 : 0o600);
}
