import { createHash } from "node:crypto";
import { workspaceFile, workspaceKey } from "./workspace-pack-files";
import { TOOL_EXPOSURES, type WorkspaceToolRule, type ToolRuleOverrides, type ToolExposure } from "./tool-settings-types";
import { join } from "node:path";
import { readToolSettingsFile } from "./tool-settings-files";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { nativeProjectTrusted } from "./native-mcp-runtime";

const TOOL_SETTINGS_ERROR = Symbol.for("pivot-ui.tool-settings-error");
export class ToolSettingsError extends Error {
  readonly [TOOL_SETTINGS_ERROR] = true;
  constructor(message: string, public readonly status = 400) { super(message); }
}
/** Module reloads can produce distinct constructors for the same server-side error. */
export function isToolSettingsError(error: unknown): error is ToolSettingsError {
  if (!(error instanceof Error)) return false;
  const candidate = error as ToolSettingsError;
  return candidate[TOOL_SETTINGS_ERROR] === true && Number.isInteger(candidate.status) && candidate.status >= 400 && candidate.status <= 599;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function readWorkspaceTools(cwd: string, trusted = nativeProjectTrusted(cwd, getAgentDir(), SettingsManager.create(cwd, getAgentDir()))) {
  const path = workspaceFile(cwd, "pivot-tools.json");
  const file = trusted ? readToolSettingsFile(path) : { path, before: null, value: {} as Record<string, unknown> };
  const globalFile = readToolSettingsFile(join(getAgentDir(), "pivot-tools.json"));
  const overrides = parseRules(file.value), globalRules = parseRules(globalFile.value);
  const rules: Record<string, ToolRuleOverrides> = Object.create(null);
  for (const name of new Set([...Object.keys(globalRules), ...Object.keys(overrides)])) {
    rules[name] = { ...globalRules[name], ...overrides[name] };
  }
  const revision = createHash("sha256").update(JSON.stringify([trusted, globalFile.path, globalFile.before, file.path, file.before])).digest("hex");
  const globalRevision = createHash("sha256").update(JSON.stringify([globalFile.path, globalFile.before])).digest("hex");
  return { file, globalFile, rules, overrides, globalRules, revision, globalRevision };
}

function parseRules(value: Record<string, unknown>): Record<string, ToolRuleOverrides> {
  const rules: Record<string, ToolRuleOverrides> = Object.create(null);
  if (value.tools !== undefined && !object(value.tools)) throw new ToolSettingsError("Invalid tool settings configuration", 409);
  for (const [name, raw] of Object.entries(value.tools ?? {})) {
    if (!object(raw) || (raw.enabled !== undefined && typeof raw.enabled !== "boolean") ||
        (raw.exposure !== undefined && !TOOL_EXPOSURES.includes(raw.exposure as never))) {
      throw new ToolSettingsError("Invalid tool settings rule", 409);
    }
    if (raw.enabled !== undefined || raw.exposure !== undefined) {
      rules[name] = { ...(raw.enabled !== undefined ? { enabled: raw.enabled as boolean } : {}),
        ...(raw.exposure !== undefined ? { exposure: raw.exposure as WorkspaceToolRule["exposure"] } : {}) };
    }
  }
  return rules;
}

declare global { var __pivotToolListeners: Map<string, Set<() => void>> | undefined; }
export function subscribeWorkspaceTools(cwd: string, listener: () => void) {
  const listeners = globalThis.__pivotToolListeners ??= new Map();
  const key = workspaceKey(cwd), set = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, set); set.add(listener);
  return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
}
export async function writeWorkspaceTool(cwd: string, revision: string, name: string, rule: WorkspaceToolRule,
  defaultExposures: Readonly<Record<string, ToolExposure>> = {}) {
  const [{ saveToolSettings }, { readOrchestration }] = await Promise.all([
    import("./tool-settings-save"), import("./tool-orchestration"),
  ]);
  await saveToolSettings(cwd, { target: "workspace", revision,
    orchestrationRevision: readOrchestration(cwd).revision, tools: { [name]: rule } }, async () => defaultExposures);
  for (const listener of globalThis.__pivotToolListeners?.get(workspaceKey(cwd)) ?? []) {
    try { listener(); } catch { /* A failed runtime update must not undo a persisted setting. */ }
  }
}
