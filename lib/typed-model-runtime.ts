import { createHash } from "node:crypto";
import type { AnyModel } from "@earendil-works/pi-ai";
import type { InlineExtension, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { typesafeSystemOneApi } from "@earendil-works/pi-ai/api/typesafe-system-one.lazy";
import { openAIDecisionsApi } from "@earendil-works/pi-ai/api/openai-decisions.lazy";
import { cloudflareWorkersAISystemOneApi } from "@earendil-works/pi-ai/api/cloudflare-workers-ai-system-one.lazy";
import { llamaCppClassifyApi } from "@earendil-works/pi-ai/api/llama-cpp-classify.lazy";
import { openrouterImagesApi } from "@earendil-works/pi-ai/api/openrouter-images.lazy";
import { ModelConfigurationError, validateModelConfiguration, type SavedModel, type ModelConfiguration } from "./typed-model-config";
import { assertSdkChatConfiguration, readModelConfigUnlocked, withModelConfigLock } from "./model-config-store";

type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];
type Registration = { installed: ProviderConfigInput };
declare global {
  var __pivotTypedModelState: {
    registrations: WeakMap<ModelRuntime, Map<string, Registration>>;
    signatures: WeakMap<ModelRuntime, string>;
    sessionReloads: WeakMap<ModelRuntime, () => Promise<void>>;
  } | undefined;
}
const { registrations, signatures, sessionReloads } = globalThis.__pivotTypedModelState ??= {
  registrations: new WeakMap(), signatures: new WeakMap(), sessionReloads: new WeakMap(),
};
export function pivotTypedModelsExtension(runtime: ModelRuntime, path: string): InlineExtension {
  return { name: "pivot-typed-models", factory: (pi) => {
    const reload = () => loadPivotTypedModels(runtime, path, (name, config) => pi.registerProvider(name, config));
    sessionReloads.set(runtime, reload);
    pi.on("session_start", reload);
  } };
}
export const reloadSessionTypedModels = (runtime: ModelRuntime, path: string) =>
  sessionReloads.get(runtime)?.() ?? loadPivotTypedModels(runtime, path);
const identity = (model: { type?: string; id: string }) => JSON.stringify([model.type ?? "chat", model.id]);

/** Remove only our own layer; never unregister an extension's replacement. */
export function clearPivotTypedModels(runtime: ModelRuntime) {
  const owned = registrations.get(runtime);
  if (!owned) return;
  for (const [name, entry] of owned) {
    if (runtime.getRegisteredProviderConfig(name) !== entry.installed) {
      throw new ModelConfigurationError("A typed model Provider conflicts with an extension; use a separate Provider name");
    }
  }
  for (const [name, entry] of owned) {
    runtime.unregisterProvider(name);
  }
  registrations.delete(runtime);
  signatures.delete(runtime);
}

function definition(model: SavedModel, base?: AnyModel) {
  return {
    ...base, ...model, name: model.name ?? base?.name ?? model.id,
    input: model.input ?? base?.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...base?.cost, ...model.cost },
    ...(model.type === "image" ? { output: model.output ?? ["image"] }
      : { contextWindow: model.contextWindow ?? (base?.type === "classifier" ? base.contextWindow : 128000) }),
  } as NonNullable<ProviderConfigInput["models"]>[number];
}

export async function loadPivotTypedModels(runtime: ModelRuntime, path: string,
  register = (name: string, config: ProviderConfigInput) => runtime.registerProvider(name, config),
) {
  return withModelConfigLock(path, async () => {
    await assertSdkChatConfiguration(path);
    return installPivotTypedModels(runtime, await readModelConfigUnlocked(path), register);
  });
}

/** The caller holds the configuration-pair lock, including SDK config reload. */
export async function installPivotTypedModels(runtime: ModelRuntime, config: ModelConfiguration,
  register = (name: string, registration: ProviderConfigInput) => runtime.registerProvider(name, registration),
) {
    const signature = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    const previous = registrations.get(runtime);
    if (signatures.get(runtime) === signature && previous && [...previous].every(([name, entry]) => runtime.getRegisteredProviderConfig(name) === entry.installed)) return;
    const providers = Object.entries(config.providers ?? {}).filter(([, provider]) =>
      provider.models?.some((model) => model.type === "classifier" || model.type === "image"));
    if (!providers.length && !registrations.has(runtime)) return;
    validateModelConfiguration(config);
    clearPivotTypedModels(runtime);
    await runtime.refresh({ allowNetwork: false });
    const pending: [string, ProviderConfigInput][] = [];
    for (const [name, provider] of providers) {
      if (runtime.getRegisteredNativeProvider(name) || runtime.getRegisteredProviderConfig(name)) {
        throw new ModelConfigurationError("A typed model Provider conflicts with an extension; use a separate Provider name");
      }
      const source = runtime.getProvider(name);
      const mergeDefinitions = () => {
        const baseModels = source?.getAllModels?.() ?? source?.getModels() ?? [];
        const models = new Map<string, NonNullable<ProviderConfigInput["models"]>[number]>(baseModels.map((model) => [identity(model), { ...model }]));
        for (const model of provider.models ?? []) {
          if (model.type !== "classifier" && model.type !== "image") continue;
          models.set(identity(model), definition(model, baseModels.find((base) => identity(base) === identity(model))));
        }
        return [...models.values()];
      };
      pending.push([name, { baseUrl: provider.baseUrl, models: mergeDefinitions(),
        // The captured pre-overlay provider follows the SDK's personalized catalog.
        // A static copy would reintroduce chat models removed after a key-specific refresh.
        ...(name === "openrouter" && source ? { refreshModels: async () => mergeDefinitions() } : {}),
        classifiers: {
          "typesafe-system-one": typesafeSystemOneApi(), "openai-decisions": openAIDecisionsApi(),
          "cloudflare-workers-ai-system-one": cloudflareWorkersAISystemOneApi(), "llama-cpp-classify": llamaCppClassifyApi(),
        }, images: { "openrouter-images": openrouterImagesApi() },
      }]);
    }
    const owned = new Map<string, Registration>();
    registrations.set(runtime, owned);
    for (const [name, registration] of pending) {
      register(name, registration);
      owned.set(name, { installed: runtime.getRegisteredProviderConfig(name)! });
    }
    await runtime.refresh({ allowNetwork: false });
    signatures.set(runtime, signature);
}

