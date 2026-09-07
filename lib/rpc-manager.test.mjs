import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("RPC wrapper moves the selected queued message without changing its content", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const textMessage = (text) => ({ role: "user", content: [{ type: "text", text }] });
  const inner = {
    _steeringMessages: ["first", "duplicate"],
    _followUpMessages: ["duplicate", "later"],
    _emitQueueUpdate() {},
    agent: {
      steeringQueue: { messages: [textMessage("first"), textMessage("duplicate")] },
      followUpQueue: { messages: [textMessage("duplicate"), textMessage("later")] },
    },
  };
  const wrapper = Object.create(AgentSessionWrapper.prototype);
  wrapper.inner = inner;

  try {
    const moved = await wrapper.send({ type: "toggle_queue_message", mode: "steer", index: 1, message: "duplicate" });
    assert.deepEqual(moved, { steering: ["first"], followUp: ["duplicate", "later", "duplicate"] });
    assert.deepEqual(inner.agent.steeringQueue.messages.map((message) => message.content[0].text), ["first"]);
    assert.deepEqual(inner.agent.followUpQueue.messages.map((message) => message.content[0].text), ["duplicate", "later", "duplicate"]);

    const movedBack = await wrapper.send({ type: "toggle_queue_message", mode: "followUp", index: 2, message: "duplicate" });
    assert.deepEqual(movedBack, { steering: ["first", "duplicate"], followUp: ["duplicate", "later"] });
    assert.deepEqual(inner.agent.steeringQueue.messages.map((message) => message.content[0].text), ["first", "duplicate"]);
    assert.deepEqual(inner.agent.followUpQueue.messages.map((message) => message.content[0].text), ["duplicate", "later"]);
  } finally {
    clearTimeout(wrapper.idleTimer);
  }
});

test("RPC wrapper exposes the browser-backed extension UI as interactive mode", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  let bindings;
  const inner = {
    sessionId: "test-session",
    agent: { state: {} },
    bindExtensions: async (next) => {
      bindings = next;
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);

  try {
    await wrapper.ensureExtensionsBound();
    assert.equal(bindings.mode, "tui");

    bindings.uiContext.setTitle("Restored title");
    let restoredTitle;
    wrapper.onEvent((event) => {
      if (event.type === "extension_ui_request" && event.method === "setTitle") restoredTitle = event.title;
    });
    assert.equal(restoredTitle, "Restored title");

    const requestPromise = new Promise((resolve) => {
      wrapper.onEvent((event) => {
        if (event.type === "extension_ui_request" && event.method === "confirm") resolve(event);
      });
    });
    const confirmation = bindings.uiContext.confirm("Continue?", "The browser UI can answer this.");
    const request = await requestPromise;
    assert.equal(request.method, "confirm");
    await wrapper.send({
      type: "extension_ui_response",
      id: request.id,
      confirmed: true,
    });
    assert.equal(await confirmation, true);
  } finally {
    wrapper.destroy();
  }
});

test("RPC wrapper serializes the shared extension statusline widget", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  let bindings;
  const events = [];
  const inner = {
    sessionId: "test-statusline",
    agent: { state: {} },
    bindExtensions: async (next) => {
      bindings = next;
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);

  try {
    wrapper.onEvent((event) => events.push(event));
    await wrapper.ensureExtensionsBound();
    bindings.uiContext.setWidget("pi-plugins:statusline", (_tui, theme) => ({
      render: () => [theme.fg("dim", " [fast mode] ")],
      invalidate() {},
    }));

    const update = events.at(-1);
    assert.equal(update.method, "setWidget");
    assert.deepEqual(update.widgetLines, [" [fast mode] "]);

    const replayed = [];
    wrapper.onEvent((event) => replayed.push(event));
    assert.deepEqual(replayed.at(-1).widgetLines, [" [fast mode] "]);

    bindings.uiContext.setWidget("pi-plugins:statusline", undefined);
    assert.equal(events.at(-1).widgetLines, undefined);
  } finally {
    wrapper.destroy();
  }
});

test("RPC wrapper invalidates the session-list cache when a session name changes", async () => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  let listener;
  const inner = {
    sessionId: "test-session-name",
    isStreaming: false,
    isCompacting: false,
    subscribe(next) {
      listener = next;
      return () => {};
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  globalThis.__piSessionListCache = { data: [], ts: Date.now() };

  try {
    wrapper.start();
    listener({ type: "session_info_changed", name: "Generated title" });
    assert.equal(globalThis.__piSessionListCache, undefined);
  } finally {
    wrapper.destroy();
    delete globalThis.__piSessionListCache;
  }
});
test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC wrapper releases a stuck SDK session and rejects a second prompt", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /export class AgentBusyError extends Error/);
  assert.match(source, /if \(this\.isRunning\(\)\) throw new AgentBusyError\(\)/);
  assert.match(source, /MODEL_START_TIMEOUT_MS = 300_000/);
  assert.match(source, /this\.inner\.abort\(\)/);
  assert.match(source, /this\.inner\.dispose\(\);/);
});
