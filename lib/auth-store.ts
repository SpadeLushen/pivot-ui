import { mkdirSync, readFileSync } from "fs";
import { rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
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
// and vice versa. Writes are serialized through an in-process promise chain.
// ============================================================================

function authPath(): string {
  return join(getAgentDir(), "auth.json");
}

async function readAuthData(): Promise<Record<string, Credential>> {
  try {
    return JSON.parse(readFileSync(authPath(), "utf8")) as Record<string, Credential>;
  } catch {
    return {};
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

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
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
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.withLock(async () => {
      const data = await readAuthData();
      const next = await fn(data[providerId]);
      if (next === undefined) return data[providerId];
      const merged: Record<string, Credential> = { ...data, [providerId]: next };
      await writeAuthData(merged);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.withLock(async () => {
      const data = await readAuthData();
      delete data[providerId];
      await writeAuthData(data);
    });
  }
}

let sharedStore: FileCredentialStore | undefined;

/** Shared singleton so concurrent route calls serialize their writes. */
export function getAuthStore(): CredentialStore {
  if (!sharedStore) sharedStore = new FileCredentialStore();
  return sharedStore;
}
