import { createAgentSessionServices, getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { azureProvider } from "@earendil-works/pi-ai/providers/azure";
import { join } from "node:path";
import { nativeMcpExtensions, nativeProjectTrusted, publishMcpLoad } from "./native-mcp-runtime";
import { workspaceToolExtension } from "./workspace-tool-extension";

export const LEGACY_AZURE_PROVIDER = "azure-openai-responses";

/** Read-only compatibility: old and new identities never share or migrate credentials. */
export async function enableLegacyAzure(runtime: ModelRuntime, requested = false) {
  const existing = runtime.getProvider(LEGACY_AZURE_PROVIDER);
  if (!requested && !existing && !runtime.getProviderAuthStatus(LEGACY_AZURE_PROVIDER).configured) return;
  // A deliberately custom provider with another API keeps its own implementation.
  if (runtime.getModels(LEGACY_AZURE_PROVIDER).some((model) => model.api !== "azure-openai-responses")) return;
  const azure = azureProvider();
  const models = azure.getModels()
    .filter((model) => model.api === "azure-openai-responses")
    .map((model) => ({ ...model, provider: LEGACY_AZURE_PROVIDER }));
  runtime.registerNativeProvider({
    ...azure,
    id: LEGACY_AZURE_PROVIDER,
    name: "Azure (legacy)",
    getModels: () => models,
    getAllModels: () => models,
  });
  await runtime.refresh({ allowNetwork: false });
}

export async function createPivotModelRuntime(
  options: Parameters<typeof ModelRuntime.create>[0] = {}, legacyAzure = false,
) {
  const runtime = await ModelRuntime.create(options);
  await enableLegacyAzure(runtime, legacyAzure);
  return runtime;
}

// ============================================================================
// Shared model/auth runtime entry points and compatibility with saved identities.
// ============================================================================

/** Create services with compatibility in place before the SDK chooses a saved model. */
export async function createPivotAgentSessionServices(
  options: Parameters<typeof createAgentSessionServices>[0], legacyAzure = false,
) {
  return buildPivotAgentSessionServices(options, legacyAzure);
}

async function buildPivotAgentSessionServices(
  options: Parameters<typeof createAgentSessionServices>[0], legacyAzure: boolean,
) {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = options.settingsManager ?? SettingsManager.create(options.cwd, agentDir);
  settingsManager.setProjectTrusted(nativeProjectTrusted(options.cwd, agentDir, settingsManager));
  const requested = legacyAzure || settingsManager.getDefaultProvider() === LEGACY_AZURE_PROVIDER
    || (settingsManager.getEnabledModels() ?? []).some((ref) => ref.startsWith(`${LEGACY_AZURE_PROVIDER}/`));
  const modelRuntime = options.modelRuntime ?? await createPivotModelRuntime({
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
    signal: options.modelRuntimeSignal,
  }, requested);
  if (options.modelRuntime) await enableLegacyAzure(modelRuntime, requested);
  const services = await createAgentSessionServices({ ...options, agentDir, settingsManager, modelRuntime,
    resourceLoaderOptions: { ...options.resourceLoaderOptions,
      extensionFactories: [...nativeMcpExtensions(), workspaceToolExtension(), ...(options.resourceLoaderOptions?.extensionFactories ?? [])],
    },
    resourceLoaderReloadOptions: { ...options.resourceLoaderReloadOptions,
      resolveProjectTrust: options.resourceLoaderReloadOptions?.resolveProjectTrust ?? (async () =>
        nativeProjectTrusted(options.cwd, agentDir, settingsManager)),
    },
  });
  publishMcpLoad(options.cwd, agentDir, services.resourceLoader.getExtensions(), true);
  return services;
}

/** Providers that offer OAuth login (`p.auth.oauth` present). */
export function getOAuthProviders(runtime: ModelRuntime) {
  return runtime.getProviders().filter((p) => p.auth.oauth);
}
