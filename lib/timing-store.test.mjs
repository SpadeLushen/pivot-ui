import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { useTimings } = await jiti.import("../hooks/useTimings.ts");
const { MAX_TIMING_RECORDS, readTiming, saveTiming, saveTimings, assistantTimingId, recordedDuration, formatElapsed, formatDisplayedElapsed, appendElapsedToUsage } = await jiti.import("./timing-store.ts");

// Capture the real hook's ref-backed event callback; no effects or timers are mounted.
function timingEvents(t) {
  const previous = globalThis.window;
  globalThis.window = { sessionStorage: mockStorage() };
  let clock = 0, api;
  t.mock.method(performance, "now", () => clock);
  t.after(() => { globalThis.window = previous; });
  function Capture() { api = useTimings({ current: "sdk" }); return null; }
  renderToStaticMarkup(React.createElement(Capture));
  return (type, fields = {}, at = clock) => {
    clock = at;
    api.recordEvent({ type, ...fields });
  };
}

function mockStorage() {
  const items = new Map();
  const calls = { orderWrites: 0, evictions: 0 };
  return {
    items, calls,
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (key === "pivot-timing:v1:order") calls.orderWrites++;
      items.set(key, value);
    },
    removeItem: (key) => {
      calls.evictions++;
      items.delete(key);
    },
  };
}

test("finished timings survive a reload and evict the oldest of 1000 records", () => {
  const previous = globalThis.window;
  const storage = mockStorage();
  globalThis.window = { sessionStorage: storage };
  try {
    for (let i = 0; i <= MAX_TIMING_RECORDS; i++) saveTiming(`s:${["tool", "thinking", "turn"][i % 3]}:${i}`, i / 2);
    assert.equal(readTiming("s:tool:0"), undefined);
    assert.equal(readTiming("s:thinking:1"), 0.5);
    saveTiming("s:thinking:1", 42);
    assert.equal(readTiming("s:thinking:1"), 42);
    assert.equal(storage.items.size, MAX_TIMING_RECORDS + 1); // includes the order index
    saveTiming("another-session:tool:0", 12);
    assert.equal(readTiming("s:turn:2"), undefined); // global cap across sessions
  } finally { globalThis.window = previous; }
});

test("flushes all completions once at turn end and evicts oldest records together", () => {
  const previous = globalThis.window;
  const storage = mockStorage();
  globalThis.window = { sessionStorage: storage };
  try {
    for (let i = 0; i < MAX_TIMING_RECORDS; i++) saveTiming(`old:${i}`, i);
    const pending = new Map([
      ["thinking:turn:0", 12], ["tool:turn:0", 23], ["tool:turn:1", 34], ["turn:turn", 45],
    ]);
    assert.equal(storage.calls.evictions, 0);
    assert.equal(readTiming("thinking:turn:0"), undefined); // pending, not yet persisted
    const priorWrites = storage.calls.orderWrites;
    saveTimings(pending); // turn_end: one index update and one trim
    assert.equal(storage.calls.orderWrites, priorWrites + 1);
    assert.equal(storage.calls.evictions, 4);
    assert.equal(readTiming("old:0"), undefined);
    assert.equal(readTiming("old:4"), 4);
    assert.equal(readTiming("thinking:turn:0"), 12);
    assert.equal(readTiming("turn:turn"), 45);
    assert.equal(storage.items.size, MAX_TIMING_RECORDS + 1);
    pending.clear(); // later agent_settled/unmount must not write the same batch again
    saveTimings(pending);
    assert.equal(storage.calls.orderWrites, priorWrites + 1);
    assert.equal(storage.calls.evictions, 4);
  } finally { globalThis.window = previous; }
});

test("deferred thinking keeps the same turn identity", () => {
  const base = { timestamp: 123, provider: "test", model: "model", content: [
    { type: "thinking", thinking: "private reasoning" },
    { type: "toolCall", toolCallId: "call-a", toolName: "read", input: {} },
  ] };
  assert.equal(assistantTimingId(base), assistantTimingId({ ...base, content: [
    { type: "thinking", thinking: "", thinkingPreview: "reasoning", deferred: true },
    base.content[1],
  ] }));
  assert.notEqual(assistantTimingId(base), assistantTimingId({ ...base, content: [
    base.content[0], { ...base.content[1], toolCallId: "call-b" },
  ] }));
});

test("unavailable and corrupt storage never fabricates a duration", () => {
  const previous = globalThis.window;
  const storage = mockStorage();
  globalThis.window = { sessionStorage: storage };
  try {
    storage.setItem("pivot-timing:v1:order", "not JSON");
    assert.equal(readTiming("missing"), undefined);
    saveTiming("working", 200);
    assert.equal(readTiming("working"), 200);
    Object.defineProperty(globalThis.window, "sessionStorage", { get() { throw Error("blocked"); } });
    assert.equal(readTiming("working"), undefined);
    assert.doesNotThrow(() => saveTiming("blocked", 100));
  } finally { globalThis.window = previous; }
});

test("uses Pi lifecycle events and no longer estimates tool duration from message timestamps", async () => {
  const [hook, view, session] = await Promise.all([
    readFile(new URL("../hooks/useTimings.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/MessageView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /case "thinking_end"|update.type === "thinking_end"/);
  assert.match(hook, /case "turn_end"/);
  assert.match(hook, /stage\(`thinking:/);
  assert.match(hook, /stage\(`tool:/);
  assert.match(hook, /pending\.current\.size > MAX_TIMING_RECORDS/);
  assert.match(hook, /flushPending\(\);\s+turn\.current = null/);
  assert.match(hook, /saveTimings\(pending\.current\);\s+pending\.current\.clear\(\)/);
  assert.match(hook, /case "agent_settled":\s+stopActive\(\)/);
  assert.doesNotMatch(hook, /case "agent_end":\s+stopActive\(\)/);
  assert.match(hook, /case "turn_start":\s+flushPending\(\)/);
  assert.match(hook, /stage\(`tool:\$\{sid\}:\$\{id\}`/);
  const thinkingCompletion = hook.slice(hook.indexOf('case "message_end"'), hook.indexOf('case "turn_end"'));
  const toolCompletion = hook.slice(hook.indexOf('case "tool_execution_end"'), hook.indexOf('\n    }\n  }, [flushPending'));
  assert.doesNotMatch(thinkingCompletion + toolCompletion, /flushPending\(|saveTimings\(/);
  assert.match(hook, /case "tool_execution_start"/);
  assert.match(hook, /case "tool_execution_end"/);
  assert.match(session, /if \(!agentRunning\) stopActiveTimings\(\)/);
  assert.doesNotMatch(view, /result.timestamp - message.timestamp/);
});

test("real timing callback prefers SDK end duration, including zero and missing start", t => {
  const event = timingEvents(t);
  event("tool_execution_start", { toolCallId: "measured" }, 10);
  event("tool_execution_end", { toolCallId: "measured", durationMs: 7 }, 100);
  event("tool_execution_end", { toolCallId: "zero", durationMs: 0 });
  event("agent_settled");
  assert.equal(readTiming("tool:sdk:measured"), 7);
  assert.equal(readTiming("tool:sdk:zero"), 0);
});

test("real timing callback keeps legacy and nested pipeline fallback without fabricating values", t => {
  const event = timingEvents(t);
  for (const [id, fields] of [["legacy", {}], ["invalid", { durationMs: -1 }],
    ["nested", { parentToolCallId: "root", durationMs: 7 }]]) {
    event("tool_execution_start", { toolCallId: id }, 10);
    event("tool_execution_end", { toolCallId: id, ...fields }, 100);
  }
  event("tool_execution_end", { toolCallId: "missing" });
  event("tool_execution_end", { toolCallId: "nested-missing", parentToolCallId: "root", durationMs: 7 });
  event("agent_settled");
  for (const id of ["legacy", "invalid", "nested"]) assert.equal(readTiming(`tool:sdk:${id}`), 90);
  for (const id of ["missing", "nested-missing"]) assert.equal(readTiming(`tool:sdk:${id}`), undefined);
});

test("real timing callback waits through agent_end and flushes on aborted settlement", t => {
  const event = timingEvents(t);
  event("tool_execution_end", { toolCallId: "done", durationMs: 12 });
  event("agent_end", { willRetry: true });
  assert.equal(readTiming("tool:sdk:done"), undefined);
  event("tool_execution_start", { toolCallId: "interrupted" });
  event("agent_settled", { aborted: true });
  assert.equal(readTiming("tool:sdk:done"), 12);
  assert.equal(readTiming("tool:sdk:interrupted"), undefined);
  event("tool_execution_end", { toolCallId: "interrupted" }, 100);
  event("agent_settled");
  assert.equal(readTiming("tool:sdk:interrupted"), undefined);
});

test("SDK durations retain zero and reject invalid or absent values", () => {
  for (const value of [0, 0.5, 42]) assert.equal(recordedDuration(value), value);
  for (const value of [undefined, null, "42", -1, NaN, Infinity, -Infinity]) {
    assert.equal(recordedDuration(value), undefined);
  }
});

test("live labels suppress subsecond values while completed labels keep milliseconds", () => {
  for (const ms of [0, 999]) {
    assert.equal(formatDisplayedElapsed(ms, true), undefined);
    assert.equal(formatDisplayedElapsed(ms, false), formatElapsed(ms));
  }
  assert.equal(formatDisplayedElapsed(1000, true), "1s");
  assert.equal(formatDisplayedElapsed(60_000, true), "1m0s");
  assert.equal(formatDisplayedElapsed(60_000, false), "1m0s");
  assert.equal(formatDisplayedElapsed(undefined, false), undefined);
});

test("turn time uses a dot separator only when other usage text is present", () => {
  assert.equal(appendElapsedToUsage("4 in · 2 out · $0.0010", 4200), "4 in · 2 out · $0.0010 · 4s");
  assert.equal(appendElapsedToUsage("", 42), "42ms");
  assert.equal(appendElapsedToUsage("4 in", undefined, 250), "4 in · 250ms");
  assert.equal(appendElapsedToUsage("4 in", 0, 250), "4 in · 0ms");
  assert.equal(appendElapsedToUsage("4 in", undefined), "4 in");
});

test("subsecond timing uses milliseconds; minute timing uses minutes and seconds", () => {
  assert.equal(formatElapsed(0), "0ms");
  assert.equal(formatElapsed(234.6), "235ms");
  assert.equal(formatElapsed(1000), "1s");
  assert.equal(formatElapsed(59_999), "60s");
  assert.equal(formatElapsed(60_000), "1m0s");
  assert.equal(formatElapsed(61_000), "1m1s");
});
