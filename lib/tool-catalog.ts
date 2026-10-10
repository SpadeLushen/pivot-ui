import {
  DefaultResourceLoader, SettingsManager, getAgentDir,
  createReadToolDefinition, createBashToolDefinition, createPowerShellToolDefinition,
  createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition,
  createFindToolDefinition, createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import type { ManagedToolInfo, ToolsSnapshot } from "./tool-settings-types";
import { readWorkspaceTools } from "./workspace-tools";
import { isMcpTool, originalToolExposure } from "./session-tool-policy";
import { nativeMcpExtensions, nativeProjectTrusted, mcpLoadStatus } from "./native-mcp-runtime";

function extensionSourceName({ source, path }: ToolInfo["sourceInfo"]): string | undefined {
  if (source.startsWith("npm:")) {
    const name = source.slice(4), version = name.lastIndexOf("@");
    return version > 0 ? name.slice(0, version) : name;
  }
  if (!path) return undefined;
  const synthetic = path.match(/^<[^:>]+:([^>]+)>$/);
  if (synthetic) return synthetic[1];
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const root = parts.lastIndexOf("extensions");
  const entry = parts.at(-1) ?? "";
  const name = root >= 0 && root < parts.length - 1 ? parts[root + 1]
    : /^(index|main)\.[cm]?[jt]s$/.test(entry) ? parts.at(-2) : entry;
  return name?.replace(/\.[cm]?[jt]s$/, "") || undefined;
}

export async function readToolsSnapshot(cwd: string, live?: AgentSessionLike): Promise<ToolsSnapshot> {
  const stored = readWorkspaceTools(cwd, live?.settingsManager.isProjectTrusted());
  let all: ToolInfo[];
  let result;
  if (live) {
    all = live.getAllTools(); result = live.resourceLoader.getExtensions();
  } else {
    const agentDir = getAgentDir(), settings = SettingsManager.create(cwd, agentDir);
    const trusted = nativeProjectTrusted(cwd, agentDir, settings);
    settings.setProjectTrusted(trusted);
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
      extensionFactories: nativeMcpExtensions(), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await loader.reload({ resolveProjectTrust: async () => trusted });
    result = loader.getExtensions();
    const factories = [createReadToolDefinition, createBashToolDefinition, createPowerShellToolDefinition,
      createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition];
    const tools = new Map<string, ToolInfo>();
    for (const factory of factories) {
      const tool = factory(cwd);
      tools.set(tool.name, { ...tool, sourceInfo: { source: "builtin", path: `builtin:${tool.name}` } });
    }
    for (const extension of result.extensions) {
      for (const { definition, sourceInfo } of extension.tools.values()) tools.set(definition.name, { ...definition, sourceInfo });
    }
    all = [...tools.values()];
  }
  const tools: ManagedToolInfo[] = all.filter((tool) => !isMcpTool(tool)).map((tool) => {
    const original = live ? originalToolExposure(live, tool.name) : tool.exposure ?? "direct";
    const rule = stored.rules[tool.name], ownerHidden = original === "hidden";
    return { name: tool.name, description: tool.description,
      source: tool.sourceInfo.source === "builtin" ? "builtin" : "extension",
      sourcePath: tool.sourceInfo.path ?? tool.sourceInfo.source,
      sourceName: tool.sourceInfo.source === "builtin" ? undefined : extensionSourceName(tool.sourceInfo),
      ownerHidden, enabled: !ownerHidden && (rule?.enabled ?? true),
      exposure: ownerHidden ? "hidden" : rule?.exposure ?? original,
      parameters: tool.parameters };
  });
  const status = mcpLoadStatus(result, true);
  return { revision: stored.revision, tools, mcpState: status.state,
    warnings: [...status.warnings, ...result.errors.map((error) => `${error.path}: ${error.error}`)] };
}
