import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readPackFile, savePackFile, workspaceFile, workspaceKey } from "./workspace-pack-files";
import { withWorkspaceLock } from "./skill-pack-apply";
import { TOOL_EXPOSURES, type WorkspaceToolRule } from "./tool-settings-types";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { nativeProjectTrusted } from "./native-mcp-runtime";

export class ToolSettingsError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function readWorkspaceTools(cwd: string, trusted = nativeProjectTrusted(cwd, getAgentDir(), SettingsManager.create(cwd, getAgentDir()))) {
  const path = workspaceFile(cwd, "pivot-tools.json");
  const file = trusted ? readPackFile(path) : { path, before: null, value: {} as Record<string, unknown> };
  const rules: Record<string, WorkspaceToolRule> = Object.create(null);
  if (file.value.tools !== undefined && !object(file.value.tools)) throw new ToolSettingsError("Invalid workspace tools configuration", 409);
  for (const [name, raw] of Object.entries(file.value.tools ?? {})) {
    if (!object(raw) || typeof raw.enabled !== "boolean" || !TOOL_EXPOSURES.includes(raw.exposure as never)) {
      throw new ToolSettingsError("Invalid workspace tool rule", 409);
    }
    rules[name] = raw as unknown as WorkspaceToolRule;
  }
  const revision = createHash("sha256").update(file.path).update("\0").update(file.before ?? "").digest("hex");
  return { file, rules, revision };
}

declare global { var __pivotToolListeners: Map<string, Set<() => void>> | undefined; }
export function subscribeWorkspaceTools(cwd: string, listener: () => void) {
  const listeners = globalThis.__pivotToolListeners ??= new Map();
  const key = workspaceKey(cwd), set = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, set); set.add(listener);
  return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
}
export async function writeWorkspaceTool(cwd: string, revision: string, name: string, rule: WorkspaceToolRule) {
  await withWorkspaceLock(cwd, async () => {
    if (!nativeProjectTrusted(cwd, getAgentDir(), SettingsManager.create(cwd, getAgentDir()))) throw new ToolSettingsError("Trust this workspace in Pi before changing tool settings", 403);
    const current = readWorkspaceTools(cwd);
    if (!revision || current.revision !== revision) throw new ToolSettingsError("Tools configuration changed; reload before saving", 409);
    const old = current.file.value.tools as Record<string, unknown> | undefined;
    const value = { ...current.file.value, version: 1, tools: { ...old, [name]: { ...old?.[name] as object, ...rule } } };
    const indent = current.file.before?.match(/^([ \t]+)\S/m)?.[1] ?? "  ";
    let text = JSON.stringify(value, null, indent) + "\n";
    if (current.file.before?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    savePackFile(current.file.path, text, existsSync(current.file.path) ? statSync(current.file.path).mode & 0o777 : 0o600);
  });
  for (const listener of globalThis.__pivotToolListeners?.get(workspaceKey(cwd)) ?? []) {
    try { listener(); } catch { /* A failed runtime update must not undo a persisted setting. */ }
  }
}
