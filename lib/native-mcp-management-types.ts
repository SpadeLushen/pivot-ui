import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

export interface McpResourceSummary {
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  uri?: string;
  uriTemplate?: string;
}
export interface NativeMcpResourcesSnapshot {
  serverKey: string;
  state: "connecting" | "connected" | "disconnected" | "needs-auth" | "failed" | "closed" | "hidden";
  oauthRequired: boolean;
  oauthAvailable: boolean;
  oauthConfigured: boolean;
  hasOAuthCredentials: boolean;
  resourcesSupported: boolean;
  resources: McpResourceSummary[];
  resourceTemplates: McpResourceSummary[];
  resourcesCursor?: string;
  templatesCursor?: string;
  error?: string;
  resourcesError?: string;
  templatesError?: string;
}
export type NativeMcpAuthEvent =
  | { type: "started"; token: string }
  | { type: "auth"; url: string }
  | { type: "prompt" }
  | { type: "success" | "cancelled" }
  | { type: "error"; message: string };

// Structural contract for the SDK's native runtime (not exported at the package root).
export interface NativeMcpConnection {
  state: Exclude<NativeMcpResourcesSnapshot["state"], "hidden">;
  hasResources: boolean;
  timeoutMs: number;
  oauthUrl?: string;
  challenge?: { resourceMetadataUrl?: URL; scope?: string; error?: string; errorDescription?: string };
  oauthSettings(): Record<string, unknown>;
  getClient(): Promise<unknown>;
  resourcesPage(cursor: string | undefined, options: { signal?: AbortSignal; timeoutMs: number }): Promise<{ resources: McpResourceSummary[]; nextCursor?: string }>;
  resourceTemplatesPage(cursor: string | undefined, options: { signal?: AbortSignal; timeoutMs: number }): Promise<{ resourceTemplates: McpResourceSummary[]; nextCursor?: string }>;
  reconnect(): Promise<void>;
  close(): Promise<void>;
}
export interface NativeMcpTransport { close(): Promise<void> }
export interface NativeMcpRuntimeModule {
  McpOAuthCredentialStore: new () => { tokens(name: string, serverUrl: string): { access_token?: string; refresh_token?: string } | undefined };
  McpServerConnection: new (options: {
    entry: McpServerEntry;
    cwd: string;
    createTransport: NativeMcpRuntimeModule["createDefaultTransport"];
    credentials: unknown;
    providerToken: (provider: string) => Promise<string | undefined>;
    onTools: () => void;
  }) => NativeMcpConnection;
  createDefaultTransport: (entry: McpServerEntry, cwd: string, authProvider: unknown) => NativeMcpTransport;
}
