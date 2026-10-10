import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import lockfile from "proper-lockfile";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const { getAuthStore } = await createJiti(import.meta.url).import("./auth-store.ts");

test("saved API keys and unexpired Codex OAuth remain readable by the real SDK", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-auth-102-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, "models.json"), JSON.stringify({ providers: { "pivot-key-store-p0": {
    api: "openai-completions", baseUrl: "http://unused.invalid/v1", models: [{ id: "stub" }],
  } } }));
  const store = getAuthStore();
  await store.modify("pivot-key-store-p0", async () => ({ type: "api_key", key: "local-saved-key" }));
  const codex = { type: "oauth", access: "local-codex-access", refresh: "local-refresh",
    expires: Date.now() + 3600000, accountId: "local-account" };
  await store.modify("openai-codex", async () => codex);
  const runtime = await ModelRuntime.create();
  const local = runtime.getModel("pivot-key-store-p0", "stub");
  assert.equal((await runtime.getAuth(local)).auth.apiKey, "local-saved-key");
  const model = runtime.getModel("openai-codex", "gpt-6.1-sol");
  assert.ok(model);
  assert.equal((await runtime.getAuth(model)).auth.apiKey, codex.access);
  assert.deepEqual(await store.read("openai-codex"), codex);
  await store.delete("pivot-key-store-p0");
  assert.equal(await store.read("pivot-key-store-p0"), undefined);
});

async function lockFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-auth-lock-")), file = path.join(dir, "auth.json");
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  await writeFile(file, '{"existing":{"type":"api_key","key":"untouched"}}');
  t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true }); });
  return { file, store: getAuthStore() };
}

test("Windows lock-directory deletion races are retried before obtaining the real lock", { skip: process.platform !== "win32" }, async (t) => {
  const f = await lockFixture(t), original = lockfile.lock; let attempts = 0;
  t.mock.method(lockfile, "lock", async (file, options) => {
    if (++attempts === 1) throw Object.assign(new Error("delete pending"), { code: "EPERM", syscall: "mkdir", path: file + ".lock" });
    return original(file, options);
  });
  await f.store.modify("new", async () => ({ type: "api_key", key: "saved" }));
  assert.equal(attempts, 2);
  assert.equal((await f.store.read("existing")).key, "untouched");
  assert.equal((await f.store.read("new")).key, "saved");
});
for (const syscall of ["mkdir", "read"]) test(`persistent EPERM during ${syscall} cannot write credentials`, async (t) => {
  const f = await lockFixture(t); let attempts = 0;
  t.mock.method(lockfile, "lock", async () => {
    attempts++; throw Object.assign(new Error("denied"), { code: "EPERM", syscall, path: f.file + ".lock" });
  });
  await assert.rejects(f.store.modify("new", async () => ({ type: "api_key", key: "not-written" })), { code: "EPERM" });
  assert.equal(attempts, syscall === "mkdir" && process.platform === "win32" ? 6 : 1);
  const { readFile } = await import("node:fs/promises");
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), { existing: { type: "api_key", key: "untouched" } });
});

test("Windows lock retries remain abortable", { skip: process.platform !== "win32" }, async (t) => {
  const f = await lockFixture(t), controller = new AbortController(); let attempts = 0, modified = false;
  t.mock.method(lockfile, "lock", async () => {
    attempts++; queueMicrotask(() => controller.abort());
    throw Object.assign(new Error("delete pending"), { code: "EPERM", syscall: "mkdir", path: f.file + ".lock" });
  });
  await assert.rejects(f.store.modify("new", async () => { modified = true; }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(attempts, 1); assert.equal(modified, false);
});
