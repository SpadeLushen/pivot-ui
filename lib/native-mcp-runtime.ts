import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, ProjectTrustStore, type InlineExtension, type LoadExtensionsResult, type SettingsManager } from "@earendil-works/pi-coding-agent";

/** Same named, replaceable built-ins as the CLI. No connections until session_start. */
export function nativeMcpExtensions(): InlineExtension[] {
  return [
    { name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension({
      updateConfig: () => { throw new Error("MCP configuration management is not available in this phase"); },
    }) },
    { name: "codemode", builtin: true, replaceable: true, factory: createCodemodeExtension() },
    { name: "tool-search", builtin: true, replaceable: true, factory: createToolSearchExtension() },
  ];
}
export function nativeProjectTrusted(cwd: string, agentDir: string, settings: SettingsManager): boolean {
  return new ProjectTrustStore(agentDir).get(cwd) ?? settings.getDefaultProjectTrust() === "always";
}
export interface McpLoadStatus {
  state: "native" | "replaced" | "disabled" | "unknown";
  loaded: boolean;
  plugins: { path: string; source: unknown }[];
  warnings: string[];
}
declare global {
  var __pivotMcpLoads: Map<string, McpLoadStatus> | undefined;
}
function loadKey(cwd: string, agentDir: string) { return `${agentDir}\0${cwd}`; }
export function publishMcpLoad(cwd: string, agentDir: string, result: LoadExtensionsResult, builtinsSupplied: boolean): void {
  globalThis.__pivotMcpLoads ??= new Map();
  globalThis.__pivotMcpLoads.set(loadKey(cwd, agentDir), mcpLoadStatus(result, builtinsSupplied));
}
export function getMcpLoad(cwd: string, agentDir: string): McpLoadStatus {
  return globalThis.__pivotMcpLoads?.get(loadKey(cwd, agentDir)) ?? { state: "unknown", loaded: false, plugins: [], warnings: [] };
}
export function mcpLoadStatus(result: LoadExtensionsResult, builtinsSupplied = false): McpLoadStatus {
  const native = result.extensions.some((extension) => extension.path === "builtin:mcp");
  const plugins = result.extensions.filter((extension) => extension.path !== "builtin:mcp" && extension.commands.has("mcp"))
    .map((extension) => ({ path: extension.path, source: extension.sourceInfo }));
  const replacements = (result.warnings ?? []).filter((warning) => warning.path === "builtin:mcp");
  return { state: native ? "native" : replacements.length ? "replaced" : result.errors.some((error) => error.path === "builtin:mcp") || !builtinsSupplied ? "unknown" : "disabled",
    loaded: native, plugins, warnings: replacements.map((warning) => warning.warning) };
}
