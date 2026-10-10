import { isMcpObject, MCP_SECRET_PLACEHOLDER } from "./native-mcp-editor-secrets";

export interface ArgumentRow { id: number; value: string; originalIndex?: number }
export interface MappingRow { id: number; key: string; value: string; originalKey?: string }
export interface McpFormValues {
  type: "stdio" | "http";
  description: string;
  timeout: string;
  exposure: "codemode" | "deferred" | "direct" | "hidden";
  command: string;
  args: ArgumentRow[];
  env: MappingRow[];
  cwd: string;
  url: string;
  headers: MappingRow[];
}
const string = (value: unknown) => typeof value === "string" ? value : "";
export function isMcpWorkspaceOverride(scope: string, definition: Record<string, unknown>): boolean {
  return scope === "project" && definition.command === undefined && definition.url === undefined && definition.type === undefined;
}
function serializeMapping(rows: MappingRow[]): Record<string, string> {
  const keys = new Set<string>();
  return Object.fromEntries(rows.map((row) => {
    if (!row.key.trim() || keys.has(row.key)) throw new Error("mcp.invalidMappingKey");
    keys.add(row.key);
    if (row.value === MCP_SECRET_PLACEHOLDER && row.originalKey !== row.key) throw new Error("mcp.movedSecret");
    return [row.key, row.value];
  }));
}
const mapping = (value: unknown): MappingRow[] => isMcpObject(value)
  ? Object.entries(value).map(([key, value], id) => ({ id, key, value: string(value), originalKey: key })) : [];
export function mcpFormValues(definition: Record<string, unknown>): McpFormValues {
  return {
    type: definition.type === "stdio" || typeof definition.url !== "string" ? "stdio" : "http",
    description: string(definition.description), timeout: definition.timeout === undefined ? "" : String(definition.timeout),
    exposure: (definition.exposure === "codemode-deferred" ? "codemode" : definition.exposure ?? "codemode") as McpFormValues["exposure"],
    command: string(definition.command), cwd: string(definition.cwd), url: string(definition.url),
    args: Array.isArray(definition.args) ? definition.args.map((value, id) => ({ id, value: string(value), originalIndex: id })) : [],
    env: mapping(definition.env), headers: mapping(definition.headers),
  };
}

function applyConnection(next: Record<string, unknown>, form: McpFormValues, initial: McpFormValues, force: boolean) {
  const patch = (key: keyof McpFormValues, value: unknown, empty: boolean) => {
    if (!force && JSON.stringify(form[key]) === JSON.stringify(initial[key])) return;
    if (empty) delete next[key]; else next[key] = value;
  };
  if (form.type === "stdio") {
    patch("command", form.command, false); patch("cwd", form.cwd, form.cwd === "");
    if (force || JSON.stringify(form.args) !== JSON.stringify(initial.args)) {
      const args = form.args.map((row, index) => {
        if (row.value === MCP_SECRET_PLACEHOLDER && row.originalIndex !== index) throw new Error("mcp.movedSecret");
        return row.value;
      });
      patch("args", args, args.length === 0);
    }
    if (force || JSON.stringify(form.env) !== JSON.stringify(initial.env)) patch("env", serializeMapping(form.env), form.env.length === 0);
  } else {
    patch("url", form.url, false);
    if (force || JSON.stringify(form.headers) !== JSON.stringify(initial.headers)) patch("headers", serializeMapping(form.headers), form.headers.length === 0);
  }
  return next;
}

/** Patch the masked baseline, not a reconstruction: unexposed configuration stays intact. */
export function buildMcpFormDefinition(original: Record<string, unknown>, initial: McpFormValues, form: McpFormValues, enabled: boolean, initialEnabled: boolean, override: boolean): Record<string, unknown> {
  const next: Record<string, unknown> = { ...original };
  if (enabled !== initialEnabled) next.enabled = enabled;
  const changed = (key: keyof McpFormValues) => JSON.stringify(initial[key]) !== JSON.stringify(form[key]);
  const patch = (key: keyof McpFormValues, value: unknown, empty: boolean) => {
    if (!changed(key)) return;
    if (empty) delete next[key]; else next[key] = value;
  };
  patch("exposure", form.exposure, false);
  if (override) return next;
  patch("description", form.description, form.description === "");
  if (changed("timeout")) {
    const timeout = Number(form.timeout);
    if (form.timeout.trim() && (!Number.isFinite(timeout) || timeout <= 0)) throw new Error("mcp.timeoutPositive");
    patch("timeout", timeout, !form.timeout.trim());
  }
  if (changed("type")) {
    next.type = form.type;
    for (const key of form.type === "http" ? ["command", "args", "env", "cwd"] : ["url", "headers"]) delete next[key];
  }
  return applyConnection(next, form, initial, changed("type"));
}
