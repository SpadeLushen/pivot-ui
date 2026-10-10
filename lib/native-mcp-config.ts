import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveDependencyRoot } from "../scripts/pivot-runtime-aliases.js";
import { getAgentDir, SettingsManager, type LoadedMcpConfig } from "@earendil-works/pi-coding-agent";
import { nativeProjectTrusted } from "./native-mcp-runtime";

type ConfigModule = { loadMcpConfig(options: { cwd: string; agentDir: string; projectTrusted: boolean }): LoadedMcpConfig };
let configModule: ConfigModule | undefined;

function nativeModule<T>(file: string): T {
  const root = resolveDependencyRoot(process.cwd(), "@earendil-works/pi-coding-agent");
  if (!root) throw new Error("Installed pi SDK could not be located");
  const nativeRequire = createRequire(join(process.cwd(), "package.json"));
  return nativeRequire(join(root, "dist", file)) as T;
}

/** Pure SDK validation; never resolve env/credential commands or connect servers. */
export function validateNativeMcpDefinition(name: string, value: unknown): Record<string, unknown> | string {
  return nativeModule<{ validateMcpServerConfig(name: string, value: unknown): Record<string, unknown> | string }>("core/mcp-servers.js")
    .validateMcpServerConfig(name, value);
}
/** pi 1.0.3's pure native validator/merge implementation (not exported at the root).
 * Resolve from the installed SDK, including hoisted npm/pnpm consumers. Never
 * evaluate credential commands, create a session, or read adapter Library data.
 */
export async function loadNativeMcpConfig(cwd: string, project = true): Promise<LoadedMcpConfig> {
  if (!configModule) {
    // Native require(esm), not a Turbopack expression import/context lookup.
    configModule = nativeModule<ConfigModule>("extensions/mcp/config.js");
  }
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir);
  const trusted = project && nativeProjectTrusted(cwd, agentDir, settings);
  return configModule.loadMcpConfig({ cwd, agentDir, projectTrusted: trusted });
}

export async function nativeMcpServerInfo(cwd: string, project = true) {
  const config = await loadNativeMcpConfig(cwd, project);
  return { servers: config.servers.map(({ name, scope, config }) => ({
    serverKey: name, name, description: config.description ?? "", scope,
    enabled: config.enabled !== false,
  })), errorCount: config.errors.length };
}
