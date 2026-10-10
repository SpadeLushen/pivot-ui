export const BUILTIN_EXTENSION_NAMES = ["mcp", "codemode", "tool-search"] as const;
export type BuiltinExtensionName = typeof BUILTIN_EXTENSION_NAMES[number];
export interface BuiltinExtensionInfo {
  name: BuiltinExtensionName;
  configured: boolean;
  globalEnabled: boolean;
  source: "global" | "project";
  loaded: boolean | null;
  state: "loaded" | "replaced" | "disabled" | "error" | "unknown";
  warnings: string[];
}
export interface BuiltinExtensionsSnapshot {
  trusted: boolean;
  revision: string;
  globalRevision: string;
  builtins: BuiltinExtensionInfo[];
  application: { sessionId: string; running: boolean;
    state: "applied" | "pending" | "applying" | "failed" } | null;
  diagnostics: { type: "warning" | "error" | "collision"; path?: string; message: string }[];
}
