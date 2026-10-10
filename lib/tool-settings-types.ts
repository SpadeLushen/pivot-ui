export const TOOL_EXPOSURES = ["direct", "model-only", "codemode", "deferred", "hidden"] as const;
export type ToolExposure = typeof TOOL_EXPOSURES[number];
export interface WorkspaceToolRule { enabled: boolean; exposure: ToolExposure }
export interface ManagedToolInfo extends WorkspaceToolRule {
  name: string;
  description: string;
  source: "builtin" | "extension";
  sourcePath: string;
  sourceName?: string;
  ownerHidden: boolean;
  parameters?: unknown;
}
export interface ToolsSnapshot {
  revision: string;
  tools: ManagedToolInfo[];
  mcpState: "native" | "replaced" | "disabled" | "unknown";
  warnings: string[];
}
