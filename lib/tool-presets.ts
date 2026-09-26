export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  sourceInfo: { source: string };
}

export type ToolPreset = "none" | "default" | "full";

export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];

export function isToolPreset(value: unknown): value is ToolPreset {
  return value === "none" || value === "default" || value === "full";
}

export function getToolNamesForPreset(preset: ToolPreset, tools: { name: string; sourceInfo: { source: string } }[]): string[] {
  if (preset === "none") return [];
  if (preset === "default") return [...PRESET_DEFAULT];
  return tools.filter((tool) => tool.sourceInfo?.source === "builtin").map((tool) => tool.name);
}

export function withExtensionTools(
  tools: { name: string; sourceInfo: { source: string } }[],
  toolNames: string[],
  includeExtensions = toolNames.length > 0,
): string[] {
  if (!includeExtensions) return [...toolNames];
  const extensionNames = tools
    .filter((tool) => tool.sourceInfo?.source && tool.sourceInfo.source !== "builtin")
    .map((tool) => tool.name);
  return [...new Set([...toolNames, ...extensionNames])];
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const activeTools = tools.filter((t) => t.active);
  if (activeTools.length === 0) return "none";

  const activeBuiltin = new Set(activeTools
    .filter((tool) => tool.sourceInfo?.source === "builtin")
    .map((tool) => tool.name));
  const defaultNames = new Set(PRESET_DEFAULT);

  if (PRESET_DEFAULT.every((name) => activeBuiltin.has(name)) &&
      [...activeBuiltin].some((name) => !defaultNames.has(name))) return "full";
  return "default";
}
