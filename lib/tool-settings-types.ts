export const TOOL_EXPOSURES = ["direct", "model-only", "codemode", "deferred", "hidden"] as const;
export type ToolExposure = typeof TOOL_EXPOSURES[number];
export interface WorkspaceToolRule { enabled: boolean; exposure: ToolExposure }
export type ToolRuleOverrides = Partial<WorkspaceToolRule>;
export type ToolRulePatch = { enabled?: boolean | null; exposure?: ToolExposure | null };
export type CodemodePatch = { mode?: CodemodeMode | null; inlineBudget?: number | null };
export type ToolSettingsTarget = "global" | "workspace";
export interface ManagedToolInfo extends WorkspaceToolRule {
  name: string;
  description: string;
  source: "builtin" | "extension";
  sourcePath: string;
  sourceName?: string;
  ownerHidden: boolean;
  parameters?: unknown;
  sources: { enabled: SettingSource; exposure: SettingSource };
  overrides: ToolRuleOverrides;
  inherited: WorkspaceToolRule;
  runtime?: { active: boolean; callable: boolean | null; exposure: ToolExposure; declared: null };
}
export type CodemodeMode = "on" | "only";
export type SettingSource = "workspace" | "global" | "default";
export interface OrchestrationSnapshot {
  revision: string;
  globalRevision: string;
  trusted: boolean;
  mode: CodemodeMode;
  inlineBudget: number;
  sources: { mode: SettingSource; inlineBudget: SettingSource };
  overrides: { mode?: CodemodeMode; inlineBudget?: number };
  inherited: { mode: CodemodeMode; inlineBudget: number };
  nativeState: "available" | "disabled" | "replaced" | "ownerHidden" | "unknown";
}
export interface ToolApplicationState {
  sessionId: string;
  running: boolean;
  codemode?: { mode: CodemodeMode; inlineBudget: number };
  state: "applied" | "pending" | "applying" | "failed" | "unknown";
}
export interface ToolsSnapshot {
  revision: string;
  globalRevision: string;
  tools: ManagedToolInfo[];
  mcpState: "native" | "replaced" | "disabled" | "unknown";
  warnings: string[];
  orchestration: OrchestrationSnapshot;
  application: ToolApplicationState | null;
  indirectUnavailable: boolean;
}
