import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { persistEmptySession } = await jiti.import("./session-persistence.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
test("empty sessions stay discoverable and retain deferred metadata before first append", async (t) => {
  const manager = await fixture(t);
  manager.appendModelChange("test", "initial");
  persistEmptySession(manager);
  assert.equal(existsSync(manager.getSessionFile()), true);
  manager.appendModelChange("test", "selected");
  manager.appendCustomEntry("pivot-tool-preset", { preset: "none" });
  persistEmptySession(manager);
  manager.appendMessage(user("first"));
  const file = manager.getSessionFile();
  const before = readFileSync(file, "utf8");
  persistEmptySession(manager);
  assert.equal(readFileSync(file, "utf8"), before, "never rewrite a conversation");
  const reopened = SessionManager.open(file);
  assert.equal(reopened.buildSessionContext().model.modelId, "selected");
  assert.equal(reopened.getEntries().filter((entry) => entry.type === "custom").length, 1);
  assert.equal(entries(file).filter((entry) => entry.type === "session").length, 1);
  reopened.appendMessage(user("second"));
  assert.equal(entries(file).filter((entry) => entry.type === "message").length, 2);
});

test("extension-consumed empty sessions can be reopened without changing identity", async (t) => {
  const manager = await fixture(t);
  persistEmptySession(manager);
  const reopened = SessionManager.open(manager.getSessionFile());
  assert.equal(reopened.getSessionId(), manager.getSessionId());
  assert.deepEqual(reopened.buildSessionContext().messages, []);
  persistEmptySession(reopened);
  assert.equal(entries(reopened.getSessionFile()).length, 1);
});

for (const withSetup of [false, true]) for (const phase of ["idle", "running", "compacting"]) {
  test(`empty fork ${withSetup ? "after setup" : "at root"} preserves ${phase} source and receives its first user`, async (t) => {
  const manager = await fixture(t);
  if (withSetup) manager.appendModelChange("test", "model");
  const firstUser = manager.appendMessage(user("fork here"));
  const sourceFile = manager.getSessionFile();
  const sourceId = manager.getSessionId();
  const before = readFileSync(sourceFile, "utf8"), leaf = manager.getLeafId();
  let disposed = 0;
  const inner = {
    sessionId: sourceId, sessionFile: sourceFile, sessionManager: manager,
    isStreaming: phase === "running", isCompacting: phase === "compacting", dispose() { disposed++; },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const result = await wrapper.send({ type: "fork", entryId: firstUser });
  assert.equal(wrapper.isAlive(), true, "fork must preserve the source wrapper");
  assert.equal(wrapper.isRunning(), phase !== "idle");
  assert.equal(disposed, 0);
  assert.equal(inner.sessionManager, manager);
  assert.equal(manager.getSessionId(), sourceId);
  assert.equal(manager.getSessionFile(), sourceFile);
  assert.equal(manager.getLeafId(), leaf);
  assert.equal(readFileSync(sourceFile, "utf8"), before);
  const fork = SessionManager.open(globalThis.__piSessionPathCache.get(result.newSessionId));
  assert.notEqual(fork.getSessionId(), sourceId);
  assert.equal(fork.getHeader().parentSession, sourceFile);
  assert.deepEqual(fork.buildSessionContext().messages, []);
  fork.appendMessage(user("first fork message"));
  assert.equal(SessionManager.open(fork.getSessionFile()).buildSessionContext().messages.length, 1);
  assert.equal(SessionManager.open(sourceFile).buildSessionContext().messages.length, 1);
  assert.equal(readFileSync(sourceFile, "utf8"), before, "child writes cannot mutate its source");
  assert.equal(manager.getLeafId(), leaf);
  });
}

test("first user message invalidates sidebar cache immediately", async (t) => {
  let listener;
  const wrapper = new AgentSessionWrapper({
    sessionId: "first-user-cache", isStreaming: false, isCompacting: false,
    sessionManager: await fixture(t), settingsManager: { isProjectTrusted: () => false },
    subscribe(next) { listener = next; return () => {}; }, dispose() {},
  });
  t.after(() => { wrapper.destroy(); delete globalThis.__piSessionListCache; });
  wrapper.start();
  globalThis.__piSessionListCache = { data: [], ts: Date.now() };
  listener({ type: "message_end", message: user("first") });
  assert.equal(globalThis.__piSessionListCache, undefined);
});

const user = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const entries = (file) => readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-persistence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return SessionManager.create(dir, dir);
}

test("pi 0.99 persists on the first user message without an assistant", async (t) => {
  const manager = await fixture(t);
  manager.appendModelChange("test", "model");
  assert.equal(existsSync(manager.getSessionFile()), false);
  manager.appendMessage(user("failed or aborted before any assistant"));
  const file = manager.getSessionFile();
  const reopened = SessionManager.open(file);
  assert.equal(reopened.getSessionId(), manager.getSessionId());
  assert.equal(reopened.buildSessionContext().messages[0].role, "user");
  assert.equal(entries(file).filter((entry) => entry.type === "session").length, 1);
});
