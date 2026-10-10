import { mkdirSync, readFileSync, writeFileSync } from "fs";
import lockfile from "proper-lockfile";
import { setTimeout as sleep } from "node:timers/promises";
import { rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

// ============================================================================
// File-backed CredentialStore for the API-key save/delete paths.
//
// pi 0.84 no longer exports `AuthStorage` (its file-backed CredentialStore);
// the public surface is the `CredentialStore` interface from @earendil-works/pi-ai
// plus `ModelRuntime`. This store writes `~/.pi/agent/auth.json` in the exact
// shape pi uses (`{ providerId: Credential }`, JSON.stringify(…, null, 2)), so
// pi's own runtime (ModelRuntime / AuthStorage) reads credentials written here
// and vice versa. Writes share the SDK's auth.json.lock across runtimes/processes.
// ============================================================================

function authPath(): string {
  return join(getAgentDir(), "auth.json");
}

async function readAuthData(): Promise<Record<string, Credential>> {
  try {
    const data: unknown = JSON.parse(readFileSync(authPath(), "utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Invalid credential data");
    return data as Record<string, Credential>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Do not expose parser snippets containing secrets or overwrite malformed data.
    throw new Error("Cannot read auth.json; credentials left unchanged.");
  }
}

async function writeAuthData(data: Record<string, Credential>): Promise<void> {
  const path = authPath();
  mkdirSync(dirname(path), { recursive: true });
  // Atomic write (tmp + rename) so concurrent readers never see a torn file;
  // 0600 keeps stored API keys private (pi's own store chmods the same way).
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, path);
}

class FileCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();

  private withLock<T>(fn: (beforeWrite: () => void) => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    const run = this.chain.then(async () => {
      const file = authPath();
      options?.signal?.throwIfAborted();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try { writeFileSync(file, "{}", { mode: 0o600, flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const deadline = Date.now() + 30_000;
      let compromised: Error | undefined;
      let release: (() => Promise<void>) | undefined;
      let windowsLockRetries = 0;
      while (!release) {
        options?.signal?.throwIfAborted();
        try {
          release = await lockfile.lock(file, {
            realpath: false, stale: 30_000, retries: 0,
            onCompromised: (error) => { compromised = error; },
          });
        } catch (error) {
          const failure = error as NodeJS.ErrnoException;
          // Windows can briefly deny mkdir while another process removes the
          // lock directory. Retry only this acquisition race, never file access
          // failures, and surface persistent permission errors after five retries.
          const transientWindowsLock = process.platform === "win32" && failure.code === "EPERM"
            && failure.syscall === "mkdir" && failure.path === `${file}.lock` && windowsLockRetries++ < 5;
          if ((failure.code !== "ELOCKED" && !transientWindowsLock) || Date.now() >= deadline) throw error;
          await sleep(20, undefined, { signal: options?.signal });
        }
      }
      try {
        options?.signal?.throwIfAborted();
        if (compromised) throw compromised;
        const result = await fn(() => { if (compromised) throw compromised; });
        if (compromised) throw compromised;
        return result;
      } finally { await release(); }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  read(providerId: string): Promise<Credential | undefined> {
    return this.withLock(async () => (await readAuthData())[providerId]);
  }

  list(): Promise<readonly CredentialInfo[]> {
    return this.withLock(async () =>
      Object.entries(await readAuthData()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.withLock(async (beforeWrite) => {
      const data = await readAuthData();
      const next = await fn(data[providerId]);
      if (next === undefined) return data[providerId];
      const merged: Record<string, Credential> = { ...data, [providerId]: next };
      beforeWrite();
      await writeAuthData(merged);
      return next;
    }, options);
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.withLock(async (beforeWrite) => {
      const data = await readAuthData();
      delete data[providerId];
      beforeWrite();
      await writeAuthData(data);
    }, options);
  }
}

let sharedStore: FileCredentialStore | undefined;

/** Shared singleton so concurrent route calls serialize their writes. */
export function getAuthStore(): CredentialStore {
  if (!sharedStore) sharedStore = new FileCredentialStore();
  return sharedStore;
}
