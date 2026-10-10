import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

// OpenAI's new and legacy flows share callback port 1455, but NOT credentials.
declare global {
  var __pivotProviderLogins: Map<string, { provider: string; abort: AbortController }> | undefined;
  var __pivotLoginSettings: { agentDir: string; manager: SettingsManager; id?: Promise<string> } | undefined;
}
function logins() { return globalThis.__pivotProviderLogins ??= new Map(); }
function key(provider: string) { return `${getAgentDir()}\0${["openai", "openai-codex"].includes(provider) ? "openai-callback" : provider}`; }
export function beginProviderLogin(provider: string, abort: AbortController): (() => void) | undefined {
  const id = key(provider);
  if (logins().has(id)) return;
  logins().set(id, { provider, abort });
  return () => { if (logins().get(id)?.abort === abort) logins().delete(id); };
}
export function cancelProviderLogin(provider: string) {
  const login = logins().get(key(provider));
  if (login?.provider === provider) login.abort.abort();
}

/** Device identity is installation-wide; project settings never supply it. */
export async function providerLoginDeviceId(): Promise<string> {
  const agentDir = getAgentDir();
  if (globalThis.__pivotLoginSettings?.agentDir !== agentDir) {
    globalThis.__pivotLoginSettings = { agentDir, manager: SettingsManager.create(agentDir, agentDir, { projectTrusted: false }) };
  }
  const entry = globalThis.__pivotLoginSettings;
  return entry.id ??= (async () => {
    const id = entry.manager.getOrCreateDeviceId();
    await entry.manager.flush();
    if (entry.manager.drainErrors().length || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      // Do not expose settings parser snippets or file contents.
      if (globalThis.__pivotLoginSettings === entry) globalThis.__pivotLoginSettings = undefined;
      throw new Error("auth.deviceIdFailed");
    }
    return id;
  })();
}
/** Only known safe diagnostics reach the browser; SDK errors may contain token bodies. */
export function providerLoginError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const keys = ["auth.loginBusy", "auth.loginExpired", "auth.deviceIdFailed", "auth.credentialsChanged", "auth.replaceApiKey"];
  if (keys.includes(message)) return message;
  if (/Port 1455 is in use/i.test(message)) return "auth.callbackPortBusy";
  if (/access_denied|authorization was denied/i.test(message)) return "auth.authorizationDenied";
  if (/OAuth state mismatch|Missing OAuth state|issued client ID|full callback URL|pasted callback URL/i.test(message)) return "auth.invalidCallback";
  return "auth.loginFailed";
}
