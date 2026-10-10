import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { reconcileOptimisticUserMessage } = await jiti.import("./useAgentSession.ts");
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const key = (text) => JSON.stringify({ text, images: [] });

test("settled owns final cleanup and aborted runs cannot trigger completion audio", async () => {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  const end = source.slice(source.indexOf('case "agent_end"'), source.indexOf('case "agent_settled"'));
  const settled = source.slice(source.indexOf('case "agent_settled"'), source.indexOf('case "prompt_done"'));
  assert.ok(end.length > 0 && settled.length > 0);
  assert.doesNotMatch(end, /\.finish\(|setAgentRunning\(false\)|onAgentEnd/);
  assert.match(end, /event\.willRetry !== true/);
  assert.match(settled, /if \(!agentRunRef\.current\.finish\(\)\) break/);
  assert.match(settled, /setAgentRunning\(false\)/);
  assert.match(settled, /if \(event\.aborted !== true\) onAgentEnd\?\.\(\)/);
});

test("first prompt reconciles across pi 0.87 system message before assistant responds", () => {
  const optimistic = { role: "user", content: "hello", timestamp: 1 };
  const system = { role: "system", content: "prompt update", timestamp: 2 };
  const before = [optimistic, system];
  const reconciled = reconcileOptimisticUserMessage(before, user("hello"), key("hello"));
  assert.equal(reconciled, before);
  assert.equal(reconciled.filter((message) => message.role === "user").length, 1);
  assert.deepEqual(reconcileOptimisticUserMessage(before, user("expanded"), key("hello")), [user("expanded"), system]);
});

test("queue deliveries with identical text remain separate after the initial prompt", () => {
  const initial = [user("hello")];
  assert.deepEqual(reconcileOptimisticUserMessage(initial, user("hello"), null), [user("hello"), user("hello")]);
  const assistant = { role: "assistant", content: [], timestamp: 2 };
  assert.deepEqual(reconcileOptimisticUserMessage([...initial, assistant], user("hello"), key("hello")), [user("hello"), assistant, user("hello")]);
});
