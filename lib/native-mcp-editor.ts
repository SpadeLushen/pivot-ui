import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { NativeMcpEditorSnapshot, NativeMcpEditorServer, NativeMcpScope } from "./api-types";
import { requirePackWorkspace } from "./workspace-pack-access";
import { readPackFile, savePackFile, workspaceFile, workspaceKey, type PackFile } from "./workspace-pack-files";
import { withWorkspaceLock } from "./skill-pack-apply";
import { collectActiveNativeMcpServers, readWorkspaceState } from "./workspace-packs";
import { getDefaultConfigPath, readConfig } from "./skill-packs-store";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { validateNativeMcpDefinition } from "./native-mcp-config";
import { isMcpObject, redactMcpDefinition, restoreMcpSecrets } from "./native-mcp-editor-secrets";
import { notifyMcpConfigurationChanged } from "./session-resource-events";

export class NativeMcpEditorError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
interface EditorContext {
  scope: NativeMcpScope;
  cwd?: string;
  global: PackFile;
  target: PackFile;
  revision: string;
  managed: Set<string>;
}
function readFile(path: string): PackFile {
  try {
    const file = readPackFile(path);
    if (file.value.mcpServers !== undefined && !isMcpObject(file.value.mcpServers)) throw new Error();
    return file;
  } catch { throw new NativeMcpEditorError("MCP configuration is not a valid JSON object; repair the file before editing", 409); }
}
function entries(file: PackFile): Record<string, unknown> {
  return isMcpObject(file.value.mcpServers) ? file.value.mcpServers : {};
}
function override(value: Record<string, unknown>): boolean {
  return value.command === undefined && value.url === undefined && value.type === undefined;
}

async function context(scope: NativeMcpScope, cwd?: string): Promise<EditorContext> {
  const agentDir = resolve(getAgentDir());
  const root = existsSync(agentDir) ? realpathSync(agentDir) : agentDir;
  const globalPath = join(root, "mcp.json");
  if (existsSync(globalPath) && lstatSync(globalPath).isSymbolicLink()) throw new NativeMcpEditorError("MCP configuration cannot be a symlink", 403);
  const global = readFile(globalPath);
  let target = global;
  const managed = new Set<string>();
  if (scope === "project") {
    if (!cwd) throw new NativeMcpEditorError("A workspace is required");
    cwd = await requirePackWorkspace(cwd);
    if (!nativeProjectTrusted(cwd, getAgentDir(), SettingsManager.create(cwd, getAgentDir()))) {
      throw new NativeMcpEditorError("Trust this workspace in Pi before reading or editing its MCP configuration", 403);
    }
    target = readFile(workspaceFile(cwd, "mcp.json"));
    try {
      // These readers otherwise treat malformed JSON as empty; ownership checks must fail closed.
      readPackFile(workspaceFile(cwd, "skill-packs.json"));
      readPackFile(getDefaultConfigPath());
      for (const name of collectActiveNativeMcpServers(readWorkspaceState({ cwd }), readConfig())) managed.add(name);
    } catch { throw new NativeMcpEditorError("mcp.packOwnershipReadFailed", 409); }
  }
  const revision = createHash("sha256").update(JSON.stringify([scope, target.path, global.before, target.before, [...managed].sort()])).digest("hex");
  return { scope, cwd, global, target, revision, managed };
}

function validated(ctx: EditorContext, name: string, value: unknown): Record<string, unknown> | string {
  if (!isMcpObject(value)) return "Server definition must be a JSON object";
  if (ctx.scope === "project" && override(value)) {
    if (Object.keys(value).some((key) => !["enabled", "exposure", "toolExposure"].includes(key))) return "Project overrides can only set enabled, exposure and toolExposure";
    const globals = entries(ctx.global);
    const base = Object.hasOwn(globals, name) ? globals[name] : undefined;
    if (!isMcpObject(base)) return "Project overrides require a global server with the same name";
    return validateNativeMcpDefinition(name, { ...base, ...value });
  }
  if (ctx.scope === "project" && value.auth !== undefined) return "auth is only allowed in global MCP configuration";
  return validateNativeMcpDefinition(name, value);
}

function snapshot(ctx: EditorContext): NativeMcpEditorSnapshot {
  const local = entries(ctx.target);
  const servers: NativeMcpEditorServer[] = [];
  const add = (name: string, raw: unknown, source: NativeMcpScope, inherited: boolean) => {
    const definition = isMcpObject(raw) ? raw : {};
    const check = validated(inherited ? { ...ctx, scope: "global" } : ctx, name, raw);
    servers.push({ serverKey: name, name, source, inherited,
      definition: redactMcpDefinition(typeof check === "string" ? definition : check),
      description: typeof check !== "string" && typeof check.description === "string" ? check.description : "",
      editScope: inherited || (ctx.scope === "project" && override(definition)) ? "global" : source,
      ...(ctx.scope === "project" && !inherited ? {
        workspaceDefinition: redactMcpDefinition(definition),
        overridesGlobal: Object.hasOwn(entries(ctx.global), name),
      } : {}),
      enabled: typeof check !== "string" && check.enabled !== false,
      managedByPack: ctx.managed.has(name),
      ...(typeof check === "string" ? { validationError: check } : {}),
    });
  };
  if (ctx.scope === "project") {
    for (const [name, raw] of Object.entries(entries(ctx.global))) {
      if (!Object.hasOwn(local, name)) add(name, raw, "global", true);
    }
  }
  for (const [name, raw] of Object.entries(local)) add(name, raw, ctx.scope, false);
  return { scope: ctx.scope, filePath: ctx.target.path, revision: ctx.revision, servers };
}

export async function readNativeMcpEditor(scope: NativeMcpScope, cwd?: string): Promise<NativeMcpEditorSnapshot> {
  return snapshot(await context(scope, cwd));
}

/** Change only the workspace switch; inherited definitions/credentials stay global. */
export async function setNativeMcpWorkspaceEnabled(edit: NativeMcpEdit, enabled: boolean): Promise<NativeMcpEditorSnapshot> {
  if (edit.scope !== "project") throw new NativeMcpEditorError("Workspace switches require project scope");
  const ctx = await context("project", edit.cwd);
  const local = entries(ctx.target), exists = Object.hasOwn(local, edit.serverKey);
  const raw = exists ? local[edit.serverKey] : undefined;
  if (exists && !isMcpObject(raw)) throw new NativeMcpEditorError("Repair the invalid workspace entry before changing its switch", 409);
  if (!exists && !Object.hasOwn(entries(ctx.global), edit.serverKey)) throw new NativeMcpEditorError("Server no longer exists", 409);
  return editNativeMcpServer(exists ? "update" : "create", { ...edit, definition: { ...(isMcpObject(raw) ? raw : {}), enabled } });
}

export interface NativeMcpEdit {
  scope: NativeMcpScope;
  cwd?: string;
  revision: string;
  serverKey: string;
  definition?: Record<string, unknown>;
}

export async function editNativeMcpServer(action: "create" | "update" | "delete", edit: NativeMcpEdit): Promise<NativeMcpEditorSnapshot> {
  if (action !== "delete" && !/^[A-Za-z0-9_-]+$/.test(edit.serverKey)) throw new NativeMcpEditorError('Server names may contain only letters, digits, "_" and "-"');
  const initial = await context(edit.scope, edit.cwd);
  const lock = initial.scope === "project" ? workspaceKey(initial.cwd!) : resolve(getAgentDir());
  return withWorkspaceLock(lock, async () => {
    const ctx = await context(edit.scope, edit.cwd);
    if (!edit.revision || ctx.revision !== edit.revision) throw new NativeMcpEditorError("MCP configuration changed; reload the editor before saving", 409);
    const old = entries(ctx.target);
    const exists = Object.hasOwn(old, edit.serverKey);
    const stored = exists ? old[edit.serverKey] : undefined;
    const original = isMcpObject(stored) ? stored : {};
    if (action === "create" && exists) throw new NativeMcpEditorError("This server already exists in this scope", 409);
    if (action !== "create" && !exists) throw new NativeMcpEditorError("This server no longer exists in this scope", 409);
    const next = { ...old };
    if (action === "delete") {
      if (ctx.managed.has(edit.serverKey)) throw new NativeMcpEditorError("Remove this server from its workspace Packs before deleting its configuration", 409);
      delete next[edit.serverKey];
    } else {
      if (!isMcpObject(edit.definition)) throw new NativeMcpEditorError("Server definition must be a JSON object");
      let definition: Record<string, unknown>;
      try { definition = restoreMcpSecrets(edit.definition, original); }
      catch { throw new NativeMcpEditorError("Redacted values can only preserve existing credentials"); }
      if (action === "create" && definition.enabled === undefined) definition.enabled = false;
      const check = validated(ctx, edit.serverKey, definition);
      if (typeof check === "string") throw new NativeMcpEditorError(check);
      if (ctx.managed.has(edit.serverKey) && definition.enabled !== original.enabled) {
        throw new NativeMcpEditorError("Change Pack-managed enabled state through workspace Pack switches", 409);
      }
      Object.defineProperty(next, edit.serverKey, { value: definition, enumerable: true, configurable: true, writable: true });
    }
    if (action !== "delete") {
      const names = new Set([...Object.keys(entries(ctx.global)), ...Object.keys(next)]);
      for (const name of names) {
        if (name !== edit.serverKey && /^[A-Za-z0-9_-]+$/.test(name) && name.replace(/-/g, "_") === edit.serverKey.replace(/-/g, "_")) {
          throw new NativeMcpEditorError("Server names that differ only by '-' and '_' share a native namespace", 409);
        }
      }
    }
    // Recheck just before the atomic write; preserve all other entries/top-level settings.
    if ((await context(edit.scope, edit.cwd)).revision !== ctx.revision) throw new NativeMcpEditorError("MCP configuration changed; reload before saving", 409);
    const value = { ...ctx.target.value, mcpServers: next };
    const indent = ctx.target.before?.match(/^([ \t]+)\S/m)?.[1] ?? "  ";
    let text = `${JSON.stringify(value, null, indent)}\n`;
    if (ctx.target.before?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    const mode = existsSync(ctx.target.path) ? statSync(ctx.target.path).mode & 0o777 : 0o600;
    savePackFile(ctx.target.path, text, mode);
    notifyMcpConfigurationChanged(ctx.scope === "project" ? ctx.cwd : undefined);
    return snapshot(await context(edit.scope, edit.cwd));
  });
}
