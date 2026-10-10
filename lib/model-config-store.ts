import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { ModelConfigurationError, splitModelConfiguration, validateModelConfiguration,
  type ModelConfiguration, type TypedConfiguration } from "./typed-model-config";

export const typedModelsPath = (modelsPath: string) => join(dirname(modelsPath), "pivot-models.json");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function readableModels(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((model) => record(model) && typeof model.id === "string"
    && ["api", "name", "baseUrl"].every((key) => model[key] === undefined || typeof model[key] === "string")
    && ["input", "output"].every((key) => model[key] === undefined || (Array.isArray(model[key]) && model[key].every((v) => typeof v === "string"))));
}
async function optionalFile(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function withModelConfigLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  let compromised: Error | undefined;
  const release = await lockfile.lock(path, { realpath: false, stale: 30_000,
    retries: { retries: 120, factor: 1, minTimeout: 25, maxTimeout: 25 },
    onCompromised: (error) => { compromised = error; } });
  try {
    const result = await action();
    if (compromised) throw compromised;
    return result;
  } finally { await release(); }
}

/** Caller holds the pair lock. Malformed files are never treated as empty. */
export async function readModelConfigUnlocked(path: string): Promise<ModelConfiguration> {
  try {
    const source = await optionalFile(path);
    const chat: unknown = source === undefined ? { providers: {} } : JSON.parse(source);
    if (!record(chat) || (chat.providers !== undefined && !record(chat.providers))) throw new Error();
    if (Object.values(chat.providers ?? {}).some((provider) => !record(provider)
      || (provider.models !== undefined && !readableModels(provider.models)))) throw new Error();
    const typedSource = await optionalFile(typedModelsPath(path));
    if (typedSource === undefined) return chat as ModelConfiguration;
    const typed: unknown = JSON.parse(typedSource);
    if (!record(typed) || typed.version !== 1 || !record(typed.providers)) throw new Error();
    const providers = { ...chat.providers } as NonNullable<ModelConfiguration["providers"]>;
    for (const [name, entry] of Object.entries(typed.providers)) {
      if (!record(entry) || !readableModels(entry.models) || (entry.models as unknown[]).some((m) => !record(m) || (m.type !== "classifier" && m.type !== "image"))) throw new Error();
      Object.defineProperty(providers, name, { enumerable: true, configurable: true, writable: true,
        value: { ...providers[name], models: [...(providers[name]?.models ?? []), ...entry.models] } });
    }
    return { ...chat, providers } as ModelConfiguration;
  } catch { throw new ModelConfigurationError("Unable to read model configuration; files were not changed"); }
}
export async function assertSdkChatConfiguration(path: string) {
  const source = await optionalFile(path);
  if (source === undefined) return;
  let config: unknown;
  try { config = JSON.parse(source); } catch { throw new ModelConfigurationError("Unable to read model configuration"); }
  if (!record(config) || !record(config.providers ?? {})) throw new ModelConfigurationError("Invalid model configuration");
  for (const provider of Object.values(config.providers ?? {})) {
    if (record(provider) && Array.isArray(provider.models) && provider.models.some((m) => record(m) && m.type !== undefined && m.type !== "chat")) {
      throw new ModelConfigurationError("Save non-chat definitions through Models before loading; models.json is chat-only");
    }
  }
}
export const readModelConfiguration = (path: string) => withModelConfigLock(path, () => readModelConfigUnlocked(path));


async function replaceFile(path: string, contents: string | undefined) {
  if (contents === undefined) { await rm(path, { force: true }); return; }
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
/** Explicit Save only. Preserve unknown keys; never rewrite auth.json. */
export async function saveModelConfiguration(path: string, input: unknown) {
  validateModelConfiguration(input);
  return withModelConfigLock(path, async () => {
    // Refuse to overwrite damaged or future-version configuration.
    await readModelConfigUnlocked(path);
    const typedPath = typedModelsPath(path);
    const previousChat = await optionalFile(path), previousTyped = await optionalFile(typedPath);
    const { chat, typed } = splitModelConfiguration(input);
    const previous = previousTyped === undefined ? undefined : JSON.parse(previousTyped) as TypedConfiguration;
    const typedDocument = { ...previous, ...typed, providers: Object.fromEntries(Object.entries(typed.providers)
      .map(([name, entry]) => [name, { ...previous?.providers[name], ...entry }])) };
    try {
      await replaceFile(typedPath, JSON.stringify(typedDocument, null, 2));
      await replaceFile(path, JSON.stringify(chat, null, 2));
    } catch {
      try { await replaceFile(typedPath, previousTyped); await replaceFile(path, previousChat); }
      catch { throw new ModelConfigurationError("Model configuration save and rollback failed; review the configuration files"); }
      throw new ModelConfigurationError("Unable to save model configuration; previous files restored");
    }
  });
}

