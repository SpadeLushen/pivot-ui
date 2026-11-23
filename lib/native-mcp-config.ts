import { piSdkModule as nativeMcpModule } from "./pi-sdk-module";
export { piSdkModule as nativeMcpModule, piSdkModulePath as nativeMcpModulePath } from "./pi-sdk-module";
import { getAgentDir, SettingsManager, type LoadedMcpConfig } from "@earendil-works/pi-coding-agent";
import { nativeProjectTrusted } from "./native-mcp-runtime";

type ConfigModule = { loadMcpConfig(options: { cwd: string; agentDir: string; projectTrusted: boolean }): LoadedMcpConfig };
let configModule: ConfigModule | undefined;

/** Pure SDK validation; never resolve env/credential commands or connect servers. */
export function validateNativeMcpDefinition(name: string, value: unknown): Record<string, unknown> | string {
  return nativeMcpModule<{ validateMcpServerConfig(name: string, value: unknown): Record<string, unknown> | string }>("core/mcp-servers.js")
    .validateMcpServerConfig(name, value);
}
/** pi 1.0.3's pure native validator/merge implementation (not exported at the root).
 * Resolve from the installed SDK, including hoisted npm/pnpm consumers. Never
 * evaluate credential commands, create a session, or read adapter Library data.
 */
export async function loadNativeMcpConfig(cwd: string, project = true): Promise<LoadedMcpConfig> {
  if (!configModule) {
    // Native require(esm), not a Turbopack expression import/context lookup.
    configModule = nativeMcpModule<ConfigModule>("extensions/mcp/config.js");
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
