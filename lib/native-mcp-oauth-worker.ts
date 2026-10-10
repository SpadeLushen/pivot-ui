// Runs only SDK OAuth in an isolated worker: no global fetch changes in the Next server.
// Cancellation aborts discovery/registration and callback wait through the SDK signal.
// Once a token grant starts, defer abort until its bounded request and credential commit finish.
export const MCP_OAUTH_WORKER = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const originalFetch = globalThis.fetch;
const cancellation = new AbortController();
let cancelled = false, grantStarted = false, pending;
globalThis.fetch = (input, init = {}) => {
  if (cancelled) return Promise.reject(new Error("Sign-in cancelled"));
  // Native token requests use URLSearchParams; do not interrupt a potentially rotated grant
  // between response headers, body consumption, SDK saveTokens and the final locked commit.
  const grant = init.body instanceof URLSearchParams ? init.body.get("grant_type") : undefined;
  if (init.method?.toUpperCase() === "POST" && (grant === "authorization_code" || grant === "refresh_token")) grantStarted = true;
  const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(init.signal ? [init.signal] : [])]);
  return originalFetch(input, { ...init, signal });
};
parentPort.on("message", (message) => {
  if (message.type === "cancel") {
    cancelled = true;
    if (!grantStarted) cancellation.abort();
    pending?.reject(new Error("Sign-in cancelled"));
    pending = undefined;
  } else if (message.type === "callback" && pending && !cancelled) {
    const input = pending; pending = undefined; input.resolve(message.url);
  }
});
async function run() {
  const { signInMcpServer, McpOAuthCredentialStore } = require(workerData.modulePath);
  const settings = workerData.settings;
  if (settings.authServerMetadataUrl) settings.authServerMetadataUrl = new URL(settings.authServerMetadataUrl);
  if (workerData.challenge?.resourceMetadataUrl) workerData.challenge.resourceMetadataUrl = new URL(workerData.challenge.resourceMetadataUrl);
  const nativeStore = new McpOAuthCredentialStore().forServer(workerData.serverKey, workerData.serverUrl);
  const previous = await nativeStore.load();
  let state = previous ? structuredClone(previous) : undefined;
  // Force a new browser grant rather than the SDK’s cached-token refresh shortcut.
  // Stage SDK state in memory; cancellation must not destroy a working login.
  if (state) { delete state.tokens; delete state.tokensExpireAt; delete state.oauthState; }
  if (workerData.challenge?.error === "insufficient_scope" && workerData.challenge.scope) {
    settings.scope = [...new Set([settings.scope, previous?.tokens?.scope].flatMap((scope) => scope?.split(/\s+/).filter(Boolean) ?? []))].join(" ") || undefined;
  }
  const store = { load: () => state === undefined ? undefined : structuredClone(state), save: (next) => { state = structuredClone(next); } };
  await signInMcpServer({
    serverUrl: workerData.serverUrl, store,
    settings, challenge: workerData.challenge, signal: cancellation.signal,
    prompt: {
      showAuthorizationUrl(url) {
        if (cancelled) throw new Error("Sign-in cancelled");
        parentPort.postMessage({ type: "auth", url: url.href });
      },
      promptForRedirectUrl(signal) {
        return new Promise((resolve, reject) => {
          if (cancelled || signal.aborted) { reject(new Error("Sign-in cancelled")); return; }
          pending = { resolve, reject };
          signal.addEventListener("abort", () => { pending = undefined; reject(new Error("Sign-in cancelled")); }, { once: true });
          parentPort.postMessage({ type: "prompt" });
        });
      },
    },
  });
  if (!state?.tokens?.access_token) throw new Error("OAuth flow did not issue tokens");
  // Let an in-flight native refresh finish before publishing the newly authorized grant.
  await nativeStore.withRefreshLock(() => nativeStore.save(state));
}
run().then(() => parentPort.postMessage({ type: "success" }), (error) => {
  const message = /redirect URL|different sign-in|authorization code/.test(error?.message ?? "")
    ? "mcp.invalidCallback" : "mcp.oauthFailed";
  parentPort.postMessage({ type: cancelled ? "cancelled" : "error", message });
}).finally(() => parentPort.close());
`;
