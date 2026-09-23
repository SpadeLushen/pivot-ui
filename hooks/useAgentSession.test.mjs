import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { reconcileOptimisticUserMessage } = await jiti.import("./useAgentSession.ts");
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const key = (text) => JSON.stringify({ text, images: [] });

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
