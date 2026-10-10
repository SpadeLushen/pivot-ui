import { randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { nativeMcpModulePath } from "./native-mcp-config";
import { mcpManagementContext, mcpManagementRecord, mcpOAuthStatus, withMcpManagement, NativeMcpManagementError, type McpManagementRecord } from "./native-mcp-management";
import { notifyMcpConfigurationChanged } from "./session-resource-events";
import { workspaceKey } from "./workspace-pack-files";
import { MCP_OAUTH_WORKER } from "./native-mcp-oauth-worker";
import type { NativeMcpAuthEvent } from "./native-mcp-management-types";

interface Attempt {
  token: string;
  identity: string;
  record: McpManagementRecord;
  worker: Worker;
  cancelled: boolean;
  waiting: boolean;
  cancel: (expired?: boolean) => void;
}
declare global {
  var __pivotMcpOAuth: { attempts: Map<string, Attempt>; identities: Map<string, Attempt> } | undefined;
}
function registry() { return globalThis.__pivotMcpOAuth ??= { attempts: new Map(), identities: new Map() }; }
export async function startMcpOAuth(cwd: string, serverKey: string, signal: AbortSignal, send: (event: NativeMcpAuthEvent) => void, close: () => void): Promise<() => void> {
  const context = await mcpManagementContext(cwd, serverKey), record = mcpManagementRecord(context);
  const flags = mcpOAuthStatus(context);
  if (!flags.oauthAvailable) throw new NativeMcpManagementError("mcp.oauthAuthConflict", 409);
  if (!flags.oauthConfigured && !flags.hasOAuthCredentials && record.connection.state !== "needs-auth") {
    await withMcpManagement(record, async () => {
      try { await record.connection.getClient(); } catch { /* Classify through the native state. */ }
    });
  }
  signal.throwIfAborted();
  const connection = record.connection, serverUrl = connection.oauthUrl;
  if (!serverUrl || (!flags.oauthConfigured && !flags.hasOAuthCredentials && connection.state !== "needs-auth")) throw new NativeMcpManagementError("mcp.oauthNotRequired", 409);
  const identity = `${getAgentDir()}\0${serverKey.replace(/-/g, "_")}\0${new URL(serverUrl).href}`;
  if (registry().identities.has(identity)) throw new NativeMcpManagementError("mcp.oauthBusy", 409);
  const settings = connection.oauthSettings();
  if (settings.authServerMetadataUrl instanceof URL) settings.authServerMetadataUrl = settings.authServerMetadataUrl.href;
  const worker = new Worker(MCP_OAUTH_WORKER, { eval: true, workerData: {
    modulePath: nativeMcpModulePath("extensions/mcp/oauth.js"), serverKey, serverUrl, settings, challenge: connection.challenge ? { ...connection.challenge, resourceMetadataUrl: connection.challenge.resourceMetadataUrl?.href } : undefined,
  }, env: { ...process.env, PI_CODING_AGENT_DIR: getAgentDir() } });
  const token = randomBytes(32).toString("hex");
  let finished = false;
  const attempt: Attempt = { token, identity, record, worker, waiting: false, cancelled: false, cancel: (expired = false) => {
    if (finished || attempt.cancelled) return;
    attempt.cancelled = true; registry().attempts.delete(token);
    worker.postMessage({ type: "cancel" });
    send(expired ? { type: "error", message: "mcp.oauthExpired" } : { type: "cancelled" });
    close();
  } };
  record.busy++; record.cancelAuth = attempt.cancel;
  registry().attempts.set(token, attempt); registry().identities.set(identity, attempt);
  const timeout = setTimeout(() => attempt.cancel(true), 5 * 60_000); timeout.unref();
  const finish = async (event: NativeMcpAuthEvent) => {
    if (finished) return; finished = true; clearTimeout(timeout);
    try {
      if (event.type === "success") {
        // Credentials may be shared across workspaces; all sessions update only when idle.
        try {
          if (!attempt.cancelled) {
            const current = await mcpManagementContext(cwd, serverKey);
            if (current.signature !== context.signature) throw new NativeMcpManagementError("mcp.configurationChanged", 409);
            // Notification retires the management connection; the client refresh connects
            // with the new grant. Do not misreport successful OAuth if reconnecting fails.
          }
        } finally { notifyMcpConfigurationChanged(); }
      }
      if (!attempt.cancelled) send(event);
    } catch (error) {
      if (!attempt.cancelled) send({ type: "error", message: NativeMcpManagementError.is(error) ? error.message : "mcp.connectionFailed" });
    } finally {
      registry().attempts.delete(token); registry().identities.delete(identity);
      if (record.cancelAuth === attempt.cancel) record.cancelAuth = undefined;
      record.busy--;
      close();
      void worker.terminate();
    }
  };
  worker.on("message", (event: NativeMcpAuthEvent) => {
    if (finished) return;
    if (event.type === "auth") {
      try { const url = new URL(event.url); if (event.url.length > 16384 || !["http:", "https:"].includes(url.protocol)) throw new Error(); }
      catch { attempt.cancel(); return; }
      if (!attempt.cancelled) send(event);
    } else if (event.type === "prompt") {
      attempt.waiting = true;
      if (!attempt.cancelled) send(event);
    } else if (["success", "error", "cancelled"].includes(event.type)) {
      void finish(event);
    }
  });
  worker.on("error", () => { void finish({ type: "error", message: "mcp.oauthFailed" }); });
  worker.on("exit", () => { if (!finished) void finish({ type: "error", message: "mcp.oauthFailed" }); });
  send({ type: "started", token });
  return attempt.cancel;
}

export async function submitMcpOAuth(cwd: string, serverKey: string, token: string, action: "callback" | "cancel", url?: string): Promise<void> {
  const attempt = registry().attempts.get(token);
  if (!attempt || attempt.cancelled) throw new NativeMcpManagementError("mcp.oauthExpired", 404);
  if (workspaceKey(cwd) !== workspaceKey(attempt.record.context.cwd) || serverKey !== attempt.record.context.entry.name) {
    throw new NativeMcpManagementError("mcp.invalidRequest", 403);
  }
  const context = await mcpManagementContext(cwd, serverKey);
  if (attempt.cancelled || registry().attempts.get(token) !== attempt) throw new NativeMcpManagementError("mcp.oauthExpired", 404);
  if (context.signature !== attempt.record.context.signature) {
    attempt.cancel(); throw new NativeMcpManagementError("mcp.configurationChanged", 409);
  }
  if (action === "cancel") { attempt.cancel(); return; }
  if (!attempt.waiting) throw new NativeMcpManagementError("mcp.oauthNotReady", 409);
  if (!url || url.length > 16384) throw new NativeMcpManagementError("mcp.invalidCallback");
  // Syntax only; the SDK validates exact redirect URI, state, code, issuer and PKCE.
  try { const parsed = new URL(url); if (parsed.protocol !== "http:") throw new Error(); }
  catch { throw new NativeMcpManagementError("mcp.invalidCallback"); }
  attempt.waiting = false;
  registry().attempts.delete(token); // One use, scoped to this workspace/server/sign-in.
  attempt.worker.postMessage({ type: "callback", url });
}
