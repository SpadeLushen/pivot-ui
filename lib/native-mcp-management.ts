import { createHash } from "node:crypto";
import { getAgentDir, ModelRuntime, SettingsManager, type McpServerEntry } from "@earendil-works/pi-coding-agent";
import { loadNativeMcpConfig, nativeMcpModule } from "./native-mcp-config";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { PackWorkspaceAccessError, requirePackWorkspace } from "./workspace-pack-access";
import { workspaceKey } from "./workspace-pack-files";
import { readToolsSnapshot } from "./tool-catalog";
import { subscribeResourceChanges } from "./session-resource-events";
import { subscribeWorkspacePacks } from "./workspace-pack-events";
import type { McpResourceSummary, NativeMcpConnection, NativeMcpResourcesSnapshot, NativeMcpRuntimeModule, NativeMcpTransport } from "./native-mcp-management-types";

const MANAGEMENT_ERROR = Symbol.for("pivot.native-mcp-management-error");
export class NativeMcpManagementError extends Error {
  readonly [MANAGEMENT_ERROR] = true;
  constructor(message: string, readonly status = 400) { super(message); }
  /** Global registries can retain errors from an earlier module instance after hot reload. */
  static is(error: unknown): error is NativeMcpManagementError {
    return error instanceof Error && MANAGEMENT_ERROR in error && error[MANAGEMENT_ERROR] === true;
  }
}
export interface McpManagementContext {
  cwd: string;
  entry: McpServerEntry;
  signature: string;
  key: string;
}
export interface McpManagementRecord {
  context: McpManagementContext;
  connection: NativeMcpConnection;
  transports: Set<NativeMcpTransport>;
  tail: Promise<unknown>;
  busy: number;
  timer?: ReturnType<typeof setTimeout>;
  cancelAuth?: () => void;
  unsubscribe?: () => void;
}
declare global { var __pivotMcpManagement: Map<string, McpManagementRecord> | undefined; }
const IDLE_MS = 2 * 60_000;
function pool() {
  if (!globalThis.__pivotMcpManagement) {
    globalThis.__pivotMcpManagement = new Map();
    const cleanup = () => { for (const record of globalThis.__pivotMcpManagement?.values() ?? []) retire(record); };
    for (const event of ["exit", "SIGINT", "SIGTERM"] as const) process.once(event, cleanup);
  }
  return globalThis.__pivotMcpManagement;
}
export async function mcpManagementContext(cwd: string, serverKey: string, allowDisabled = false): Promise<McpManagementContext> {
  if (!cwd || !/^[A-Za-z0-9_-]+$/.test(serverKey)) throw new NativeMcpManagementError("mcp.invalidRequest");
  let root: string;
  try { root = await requirePackWorkspace(cwd); }
  catch (error) {
    if (error instanceof PackWorkspaceAccessError) throw new NativeMcpManagementError("mcp.managementFailed", 403);
    throw error;
  }
  const agentDir = getAgentDir();
  if (!nativeProjectTrusted(root, agentDir, SettingsManager.create(root, agentDir))) {
    throw new NativeMcpManagementError("mcp.workspaceUntrusted", 403);
  }
  const tools = await readToolsSnapshot(root);
  if (tools.mcpState !== "native") throw new NativeMcpManagementError(tools.mcpState === "replaced" ? "tools.mcpReplaced" : "mcp.nativeUnavailable", 409);
  const config = await loadNativeMcpConfig(root);
  const entry = config.servers.find((server) => server.name === serverKey);
  if (!entry) throw new NativeMcpManagementError("mcp.serverUnavailable", 404);
  if (entry.config.enabled === false && !allowDisabled) throw new NativeMcpManagementError("mcp.serverDisabled", 409);
  const signature = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  return { cwd: root, entry, signature, key: `${agentDir}\0${workspaceKey(root)}\0${serverKey}` };
}

/** Native credential presence only: no expiry judgment, tokens or credential-command execution. */
export function mcpOAuthStatus(context: McpManagementContext) {
  const config = context.entry.config;
  const url = "url" in config ? config.url : undefined;
  const oauthAvailable = !!url && !("auth" in config && config.auth)
    && !("headers" in config && Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === "authorization"));
  const tokens = url ? new (nativeMcpModule<NativeMcpRuntimeModule>("extensions/mcp/runtime.js").McpOAuthCredentialStore)().tokens(context.entry.name, url) : undefined;
  return { oauthAvailable, oauthConfigured: "oauth" in config && config.oauth !== undefined,
    hasOAuthCredentials: !!(tokens?.access_token || tokens?.refresh_token) };
}

function retire(record: McpManagementRecord) {
  if (pool().get(record.context.key) === record) pool().delete(record.context.key);
  clearTimeout(record.timer);
  record.unsubscribe?.();
  record.unsubscribe = undefined;
  record.cancelAuth?.();
  void record.connection.close().catch(() => undefined);
  for (const transport of record.transports) void transport.close().catch(() => undefined);
  record.transports.clear();
}
function arm(record: McpManagementRecord) {
  if (pool().get(record.context.key) !== record) return;
  clearTimeout(record.timer);
  record.timer = setTimeout(() => {
    if (record.busy) arm(record);
    else retire(record);
  }, IDLE_MS);
  record.timer.unref();
}
export function mcpManagementRecord(context: McpManagementContext): McpManagementRecord {
  if (context.entry.config.exposure === "hidden") throw new NativeMcpManagementError("mcp.resourcesHidden", 403);
  const previous = pool().get(context.key);
  if (previous?.context.signature === context.signature) { arm(previous); return previous; }
  if (previous) retire(previous);
  if (pool().size >= 32) throw new NativeMcpManagementError("mcp.managementBusy", 503);
  const runtime = nativeMcpModule<NativeMcpRuntimeModule>("extensions/mcp/runtime.js");
  let models: Promise<ModelRuntime> | undefined;
  const transports = new Set<NativeMcpTransport>();
  const connection = new runtime.McpServerConnection({
    entry: context.entry, cwd: context.cwd, createTransport: (...args) => {
      const transport = runtime.createDefaultTransport(...args); transports.add(transport); return transport;
    },
    credentials: new runtime.McpOAuthCredentialStore(),
    providerToken: async (provider) => {
      models ??= ModelRuntime.create();
      return (await (await models).getAuth(provider))?.auth.apiKey;
    },
    onTools: () => {},
  });
  const record: McpManagementRecord = { context, connection, transports, tail: Promise.resolve(), busy: 0 };
  pool().set(context.key, record);
  const offResources = subscribeResourceChanges(context.cwd, () => retire(record));
  const offPacks = subscribeWorkspacePacks(context.cwd, () => retire(record));
  record.unsubscribe = () => { offResources(); offPacks(); };
  arm(record);
  return record;
}

export function withMcpManagement<T>(record: McpManagementRecord, run: () => Promise<T>): Promise<T> {
  record.busy++; arm(record);
  const task = record.tail.then(() => new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => { retire(record); reject(new NativeMcpManagementError("mcp.connectionTimeout", 504)); }, 90_000);
    Promise.resolve().then(run).then(resolve, reject).finally(() => clearTimeout(timeout));
  }));
  record.tail = task.catch(() => undefined);
  return task.finally(() => { record.busy--; arm(record); });
}
function summaries(items: McpResourceSummary[]): McpResourceSummary[] {
  if (items.length > 1000) throw new NativeMcpManagementError("mcp.resourcesTooLarge");
  return items.filter((item) => !(item.uri ?? item.uriTemplate ?? "").startsWith("ui://") && !/;\s*profile\s*=\s*"?mcp-app"?/i.test(item.mimeType ?? ""))
    .map(({ name, title, description, mimeType, uri, uriTemplate }) => ({
      name, ...(title ? { title } : {}), ...(description ? { description } : {}),
      ...(mimeType ? { mimeType } : {}), ...(uri ? { uri } : {}), ...(uriTemplate ? { uriTemplate } : {}),
    }));
}
export async function readMcpResources(cwd: string, serverKey: string, signal: AbortSignal, cursors: { resources?: string; templates?: string; statusOnly?: boolean } = {}): Promise<NativeMcpResourcesSnapshot> {
  const context = await mcpManagementContext(cwd, serverKey, !!cursors.statusOnly);
  signal.throwIfAborted();
  const base: NativeMcpResourcesSnapshot = { serverKey, state: "disconnected", oauthRequired: false,
    ...mcpOAuthStatus(context), resourcesSupported: false, resources: [], resourceTemplates: [] };
  if (context.entry.config.exposure === "hidden") { base.state = "hidden"; return base; }
  if (cursors.statusOnly) return base;
  const record = mcpManagementRecord(context), connection = record.connection;
  return withMcpManagement(record, async () => {
    signal.throwIfAborted();
    try { await connection.getClient(); } catch { /* Native runtime owns connection/auth classification. */ }
    signal.throwIfAborted();
    base.state = connection.state;
    base.oauthRequired = base.state === "needs-auth" && !!connection.oauthUrl;
    if (base.state !== "connected") {
      if (!base.oauthRequired) base.error = base.state === "needs-auth" ? "mcp.providerAuthRequired" : "mcp.connectionFailed";
      return base;
    }
    base.resourcesSupported = connection.hasResources;
    if (!base.resourcesSupported) return base;
    const options = { signal, timeoutMs: Math.min(connection.timeoutMs, 60_000) };
    const results = await Promise.allSettled([
      connection.resourcesPage(cursors.resources, options), connection.resourceTemplatesPage(cursors.templates, options),
    ]);
    signal.throwIfAborted();
    base.state = connection.state;
    base.oauthRequired = base.state === "needs-auth" && !!connection.oauthUrl;
    if (base.oauthRequired) return base;
    if (results[0].status === "fulfilled") {
      base.resources = summaries(results[0].value.resources); base.resourcesCursor = results[0].value.nextCursor;
    } else base.resourcesError = "mcp.resourceListFailed";
    if (results[1].status === "fulfilled") {
      base.resourceTemplates = summaries(results[1].value.resourceTemplates); base.templatesCursor = results[1].value.nextCursor;
    } else base.templatesError = "mcp.templateListFailed";
    if (JSON.stringify(base).length > 1_000_000) throw new NativeMcpManagementError("mcp.resourcesTooLarge", 502);
    const current = await mcpManagementContext(cwd, serverKey);
    if (current.signature !== context.signature) throw new NativeMcpManagementError("mcp.configurationChanged", 409);
    return base;
  });
}
