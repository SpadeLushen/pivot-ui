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
