import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startRpcSession } = await jiti.import("./rpc-manager.ts");
const { resolveSessionPath } = await jiti.import("./session-reader.ts");
const { readWorkspaceTools, writeWorkspaceTool } = await jiti.import("./workspace-tools.ts");
const { readOrchestration } = await jiti.import("./tool-orchestration.ts");

const extension = `export default function(pi) {
  pi.registerToolRenderer((name, next) => name !== "p0_extension_tool" ? next() : {
    renderResult: () => {
      globalThis.__pivotRendererCalls = (globalThis.__pivotRendererCalls ?? 0) + 1;
      return { render: () => ["custom terminal result"], invalidate() {} };
    },
  });
  pi.on("tool_call", (event) => {
    if (event.toolName === "p0_extension_tool" && event.input.block) {
      return { block: true, reason: "local permission denied" };
    }
  });
  pi.registerProvider("p0-test", {
    api: "p0-test-api", apiKey: "local-test", baseUrl: "http://unused.invalid",
    models: [{ id: "stub", name: "Stub", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
    streamSimple: (...args) => globalThis.__pivotP0Stream(...args),
  });
  pi.registerCommand("p0-handled", { description: "Handled locally", handler: async () => {} });
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("p0", "ready");
    for (const [name, exposure] of [["p0_extension_tool", "direct"], ["p0_hidden", "hidden"]]) {
      pi.registerTool({ name, label: name, description: "Local test tool", exposure,
        parameters: { type: "object", properties: { block: { type: "boolean" } } },
        execute: async () => {
          globalThis.__pivotToolExecutions = (globalThis.__pivotToolExecutions ?? 0) + 1;
          return { content: [{ type: "text", text: "ok" }], details: { preserved: true } };
        } });
    }
  });
}`;

function replyStream(captures, reason = "stop", errorMessage) {
  return (model, context) => {
    captures.push({ prompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages) });
    const stream = createAssistantMessageEventStream();
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "local reply" }], stopReason: reason, timestamp: Date.now(),
      ...(errorMessage ? { errorMessage } : {}),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push(reason === "stop" ? { type: "done", reason, message } : { type: "error", reason, error: message });
      stream.end();
    });
    return stream;
  };
}

async function prompt(session, message) {
  const done = new Promise((resolve) => {
    const unsubscribe = session.onEvent((event) => {
      if (event.type === "prompt_done") { unsubscribe(); resolve(); }
    });
  });
  await session.send({ type: "prompt", message });
  await done;
}

function assertAllTools(session) {
  const available = session.inner.getAllTools().filter((tool) => tool.exposure !== "hidden" && !["codemode", "tool_search"].includes(tool.name)).map((tool) => tool.name).sort();
  assert.deepEqual(session.inner.getActiveToolNames().sort(), available);
  assert.ok(available.includes("p0_extension_tool"));
  assert.ok(available.includes("grep"));
}

test("real SDK ignores legacy presets and uses all tools after startup, reload and resume", { timeout: 30000 }, async (t) => {
  const captures = [];
  globalThis.__pivotP0Stream = replyStream(captures);
  const { session, cwd } = await fixture(t);
  assert.equal(session.inner.model.provider, "p0-test");
  assert.deepEqual(session.inner.resourceLoader.getExtensions().errors, []);
  assert.equal(typeof session.inner.extensionRunner.resolveToolRenderers("p0_extension_tool", () => undefined).renderResult, "function");
  assert.equal((await session.send({ type: "get_state" })).extensionStatuses[0].text, "ready");
  await prompt(session, "first");
  assertAllTools(session);
  assert.ok(captures[0].prompt.length > 0);
  assert.ok(captures[0].tools.some((tool) => tool.name === "p0_extension_tool"));
  assert.ok(!captures[0].tools.some((tool) => tool.name === "p0_hidden"));
  await session.send({ type: "reload" });
  await prompt(session, "after reload");
  assertAllTools(session);
  assert.ok(captures[1].prompt.length > 0);
  for (const command of [{ preset: "none" }, { preset: "default" }, { toolNames: [] }]) {
    await session.send({ type: "set_tools", ...command });
    assertAllTools(session);
  }
  assert.ok(!session.inner.sessionManager.getEntries().some((entry) => entry.customType === "pivot-ui:tool-preset"));
  await prompt(session, "with tools");
  assert.ok(captures[2].tools.some((tool) => tool.name === "read"));
  const id = session.sessionId;
  const file = session.sessionFile;
  session.destroy();
  const { session: resumed } = await startRpcSession(id, file, cwd);
  t.after(() => resumed.destroy());
  await prompt(resumed, "resumed");
  assertAllTools(resumed);
  assert.ok(captures[3].tools.some((tool) => tool.name === "p0_extension_tool"));
  assert.equal(SessionManager.open(file).getSessionId(), id);
});

test("renderer registration leaves execution, permission hooks and reload intact", { timeout: 30000 }, async (t) => {
  let block = false;
  let toolCalls = 0;
  globalThis.__pivotP0Stream = (model, context) => {
    const lastUser = context.messages.findLastIndex((message) => message.role === "user");
    if (context.messages.slice(lastUser + 1).some((message) => message.role === "toolResult")) return replyStream([])(model, context);
    const stream = createAssistantMessageEventStream();
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "toolCall", id: `p0-call-${++toolCalls}`, name: "p0_extension_tool", arguments: { block } }],
      stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { stream.push({ type: "done", reason: "toolUse", message }); stream.end(); });
    return stream;
  };
  const { session } = await fixture(t);
  await prompt(session, "execute locally");
  assert.equal(globalThis.__pivotToolExecutions, 1);
  const result = session.inner.messages.find((message) => message.role === "toolResult");
  assert.deepEqual(result.details, { preserved: true });
  assert.equal(result.content[0].text, "ok");
  block = true;
  await session.send({ type: "reload" });
  await prompt(session, "deny locally");
  assert.equal(globalThis.__pivotToolExecutions, 1);
  const denied = session.inner.messages.filter((message) => message.role === "toolResult").at(-1);
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /permission denied/);
  assert.equal(globalThis.__pivotRendererCalls ?? 0, 0, "Web execution must not invoke terminal renderers");
});

test("historical none sessions and both fork paths resume with all tools", { timeout: 30000 }, async (t) => {
  const captures = [];
  globalThis.__pivotP0Stream = replyStream(captures);
  const { session, cwd } = await fixture(t);
  session.inner.sessionManager.appendCustomEntry("pivot-ui:tool-preset", { preset: "none" });
  session.inner.setActiveToolsByName([]);
  await session.inner.prompt("legacy none conversation");
  assert.deepEqual(captures[0].tools, []);
  const id = session.sessionId;
  const file = session.sessionFile;
  session.destroy();
  const manager = SessionManager.open(file);
  const entries = manager.getEntries();
  const user = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  for (const entryId of [entries[0].id, user.id]) {
    const { session: resumed } = await startRpcSession(id, file, cwd, [], "none");
    t.after(() => resumed.destroy());
    await resumed.send({ type: "get_commands" });
    assertAllTools(resumed);
    const fork = await resumed.send({ type: "fork", entryId });
    assert.equal(fork.cancelled, false);
    assert.equal(resumed.isAlive(), false);
    const forkFile = await resolveSessionPath(fork.newSessionId);
    const childManager = SessionManager.open(forkFile);
    assert.equal(path.resolve(childManager.getHeader().parentSession), path.resolve(file));
    const { session: child } = await startRpcSession(fork.newSessionId, forkFile, cwd);
    t.after(() => child.destroy());
    await prompt(child, "fork continues with all tools");
    assertAllTools(child);
    assert.ok(captures.at(-1).prompt.length > 0);
  }
  assert.ok(SessionManager.open(file).getEntries().some((entry) => entry.customType === "pivot-ui:tool-preset" && entry.data.preset === "none"));
});

test("capacity retry finishes without leaving the wrapper running", { timeout: 30000 }, async (t) => {
  let attempts = 0;
  globalThis.__pivotP0Stream = (...args) => (++attempts === 1
    ? replyStream([], "error", "model is at capacity") : replyStream([]))(...args);
  const { session } = await fixture(t, "full", { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 100 } });
  const events = [];
  session.onEvent((event) => events.push(event));
  await prompt(session, "retry local capacity error");
  assert.equal(attempts, 2);
  assert.ok(events.some((event) => event.type === "auto_retry_start"));
  assert.ok(events.some((event) => event.type === "auto_retry_end" && event.success));
  assert.equal(session.isRunning(), false);
});

test("real SDK extension-handled input and first model failure preserve sessions", { timeout: 30000 }, async (t) => {
  const captures = [];
  globalThis.__pivotP0Stream = replyStream(captures, "error");
  const { session } = await fixture(t);
  await prompt(session, "/p0-handled");
  assert.equal(captures.length, 0);
  assert.deepEqual(SessionManager.open(session.sessionFile).buildSessionContext().messages, []);
  await prompt(session, "fails on first model response");
  const messages = SessionManager.open(session.sessionFile).buildSessionContext().messages;
  assert.ok(messages.some((message) => message.role === "user"));
  assert.ok(messages.some((message) => message.role === "assistant" && message.stopReason === "error"));
});

test("real SDK abort preserves the first user and queue switching works", { timeout: 30000 }, async (t) => {
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  globalThis.__pivotP0Stream = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    options.signal.addEventListener("abort", async () => {
      for await (const event of replyStream([], "aborted")(model, context)) stream.push(event);
      stream.end();
    }, { once: true });
    began();
    return stream;
  };
  const { session } = await fixture(t);
  const finished = prompt(session, "abort first response");
  await started;
  await session.send({ type: "steer", message: "queued text" });
  assert.deepEqual(session.inner.getSteeringMessages(), ["queued text"]);
  await session.send({ type: "toggle_queue_message", mode: "steer", index: 0, message: "queued text" });
  assert.deepEqual(session.inner.getFollowUpMessages(), ["queued text"]);
  await session.send({ type: "abort" });
  await finished;
  assert.ok(SessionManager.open(session.sessionFile).buildSessionContext().messages.some((message) => message.role === "user"));
});

function toolReply(model, name, args) {
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "toolCall", id: `call-${name}-${Date.now()}`, name, arguments: args }], stopReason: "toolUse", timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  queueMicrotask(() => { stream.push({ type: "done", reason: "toolUse", message }); stream.end(); });
  return stream;
}

test("deferred SDK tools require discovery on startup and SDK-factory resume", { timeout: 30000 }, async (t) => {
  const captures = [];
  const discover = (model, context) => {
    captures.push(getCurrentTools(context.messages).map(tool => tool.name));
    const results = context.messages.slice(context.messages.findLastIndex(m => m.role === "user") + 1).filter(m => m.role === "toolResult");
    if (!results.length) return toolReply(model, "tool_search", { query: "p0_extension_tool" });
    if (results.length === 1) return toolReply(model, "p0_extension_tool", {});
    return replyStream([])(model, context);
  };
  globalThis.__pivotP0Stream = discover;
  const { session, cwd } = await fixture(t, "none", {}, extension.replace('"p0_extension_tool", "direct"', '"p0_extension_tool", "deferred"'));
  await prompt(session, "discover and execute");
  assert.ok(captures[0].includes("tool_search")); assert.ok(!captures[0].includes("p0_extension_tool"));
  assert.ok(captures[1].includes("p0_extension_tool")); assert.equal(globalThis.__pivotToolExecutions, 1);
  const id = session.sessionId, file = session.sessionFile; await session.destroyAndWait();
  assert.ok(getCurrentTools(SessionManager.open(file).buildSessionContext().messages).some(tool => tool.name === "p0_extension_tool"));
  captures.length = 0;
  const { session: resumed } = await startRpcSession(id, file, cwd);
  await resumed.send({ type: "get_commands" });
  assert.equal(resumed.inner.getToolDefinition("p0_extension_tool").exposure, "deferred");
  // SDK 1.0.3's factory always supplies initialActiveToolNames from defaults;
  // transcript discovery remains historical, not the new runtime's loadout.
  assert.ok(!resumed.inner.getActiveToolNames().includes("p0_extension_tool"));
  await prompt(resumed, "rediscover after factory resume");
  assert.ok(!captures[0].includes("p0_extension_tool"));
  assert.ok(captures[1].includes("p0_extension_tool"));
  assert.equal(globalThis.__pivotToolExecutions, 2);
});

test("tool writes do not alter an active SDK run; next prompt sees disabled exposure", { timeout: 30000 }, async (t) => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  globalThis.__pivotP0Stream = (...args) => {
    const result = createAssistantMessageEventStream();
    release = async () => { for await (const event of replyStream([])(...args)) result.push(event); result.end(); };
    began(); return result;
  };
  const { session, cwd } = await fixture(t);
  const running = prompt(session, "paused run"); await started;
  await writeWorkspaceTool(cwd, readWorkspaceTools(cwd).revision, "p0_extension_tool", { enabled: false, exposure: "direct" });
  assert.equal(session.inner.getToolDefinition("p0_extension_tool").exposure, "direct");
  assert.ok(session.inner.getActiveToolNames().includes("p0_extension_tool"));
  await release(); await running;
  const captures = []; globalThis.__pivotP0Stream = replyStream(captures);
  await prompt(session, "next run");
  assert.equal(session.inner.getToolDefinition("p0_extension_tool").exposure, "hidden");
  assert.ok(!captures[0].tools.some(tool => tool.name === "p0_extension_tool"));
});

async function fixture(t, preset = "none", settings = {}, extensionCode = extension) {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-sdk-p0-"));
  const agentDir = path.join(dir, "agent");
  const cwd = path.join(dir, "workspace");
  await mkdir(agentDir);
  await mkdir(path.join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "p0-test", defaultModel: "stub", defaultProjectTrust: "always", defaultTools: ["read"], retry: { enabled: false }, ...settings,
  }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    await Promise.all([...(globalThis.__piSessions?.values() ?? [])].map((wrapper) => wrapper.destroyAndWait()));
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    delete globalThis.__pivotP0Stream;
    delete globalThis.__pivotRendererCalls;
    delete globalThis.__pivotToolExecutions;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(cwd, ".pi", "extensions", "mock.ts"), extensionCode);
  const { session } = await startRpcSession(`p0-${dir}`, "", cwd, [], preset);
  t.after(() => session.destroy());
  await session.send({ type: "get_commands" });
  return { session, cwd };
}

test("C3 real SDK on/only declarations and zero inline budget preserve guidelines", { timeout: 30000 }, async t => {
  for (const mode of ["on", "only"]) {
    const captures = []; globalThis.__pivotP0Stream = replyStream(captures);
    const { session } = await fixture(t, "none", { defaultTools: ["read", "codemode"], codemode: { mode, inlineBudget: 0 } });
    await prompt(session, "inspect actual declarations");
    const names = captures[0].tools.map(tool => tool.name);
    assert.ok(names.includes("codemode")); assert.ok(!names.includes("p0_hidden"));
    assert.equal(names.includes("read"), mode === "on");
    assert.match(captures[0].prompt, /Use codemode to batch independent tool calls/);
    assert.equal(session.getToolApplicationState(readOrchestration(session.inner.sessionManager.getCwd())).codemode.inlineBudget, 0);
    await session.destroyAndWait();
  }
});
test("C3 codemode child execution goes through real SDK permission hooks", { timeout: 30000 }, async t => {
  globalThis.__pivotP0Stream = (model, context) => {
    const results = context.messages.slice(context.messages.findLastIndex(m => m.role === "user") + 1).filter(m => m.role === "toolResult");
    return results.length ? replyStream([])(model, context)
      : toolReply(model, "codemode", { code: 'await tools.p0_extension_tool({block:true});' });
  };
  const { session } = await fixture(t, "none", { defaultTools: ["read", "codemode"], codemode: { mode: "only", inlineBudget: 0 } });
  await prompt(session, "deny indirect child");
  assert.equal(globalThis.__pivotToolExecutions ?? 0, 0);
  const result = session.inner.messages.findLast(m => m.role === "toolResult");
  assert.match(result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), /permission denied/);
});


test("C3 mode changes stay pending during a run and reload failure retries at idle", { timeout: 30000 }, async t => {
  let release, began; const started = new Promise(resolve => { began = resolve; });
  globalThis.__pivotP0Stream = (...args) => {
    const stream = createAssistantMessageEventStream();
    release = async () => { for await (const e of replyStream([])(...args)) stream.push(e); stream.end(); };
    began(); return stream;
  };
  const { session, cwd } = await fixture(t, "none", { codemode: { mode: "on", inlineBudget: 3000 } });
  const run = prompt(session, "paused"); await started;
  await writeFile(path.join(cwd, ".pi/settings.json"), JSON.stringify({ codemode: { mode: "only", inlineBudget: 0 } }));
  await session.refreshWorkspaceTools();
  assert.equal(session.getToolApplicationState(readOrchestration(cwd)).state, "pending");
  assert.equal(session.inner.settingsManager.getSettings().codemode.mode, "on");
  await release(); await run;
  const reload = session.inner.reload;
  session.inner.reload = async () => { throw new Error("injected reload failure"); };
  try { await assert.rejects(session.refreshWorkspaceTools(), /injected reload failure/);
    assert.equal(session.getToolApplicationState(readOrchestration(cwd)).state, "failed"); }
  finally { session.inner.reload = reload; }
  await session.refreshWorkspaceTools();
  const state = session.getToolApplicationState(readOrchestration(cwd));
  assert.equal(state.state, "applied"); assert.deepEqual(state.codemode, { mode: "only", inlineBudget: 0 });
});


test("C3 real same-cwd sessions converge without affecting a different worktree", { timeout: 30000 }, async t => {
  globalThis.__pivotP0Stream = replyStream([]);
  const { session, cwd } = await fixture(t);
  const { session: second } = await startRpcSession("c3-second-" + cwd, "", cwd);
  const otherCwd = path.join(path.dirname(cwd), "other-worktree");
  await mkdir(path.join(otherCwd, ".pi/extensions"), { recursive: true });
  await writeFile(path.join(otherCwd, ".pi/extensions/mock.ts"), extension);
  const { session: other } = await startRpcSession("c3-other-" + cwd, "", otherCwd);
  t.after(() => second.destroy()); t.after(() => other.destroy());
  await second.send({ type: "get_commands" }); await other.send({ type: "get_commands" });
  await writeWorkspaceTool(cwd, readWorkspaceTools(cwd).revision, "p0_extension_tool", { enabled: false });
  await Promise.all([session, second, other].map(s => s.refreshWorkspaceTools()));
  for (const s of [session, second]) assert.equal(s.inner.getToolDefinition("p0_extension_tool").exposure, "hidden");
  assert.equal(other.inner.getToolDefinition("p0_extension_tool").exposure, "direct");
});

test("C4 actual SDK wrapper and stats API agree on recorded parent and standalone usage", { timeout: 30000 }, async t => {
  globalThis.__pivotP0Stream = replyStream([]);
  const { session } = await fixture(t); await prompt(session, "recorded usage");
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 } };
  session.inner.sessionManager.appendMessage({ role: "toolResult", toolCallId: "parent", content: [], usage, timestamp: 1 });
  session.inner.sessionManager.appendUsage("fixture", "p0-test", "stub", usage);
  const command = await session.send({ type: "get_session_stats" });
  const route = await jiti.import("../app/api/sessions/[id]/stats/route.ts");
  const response = await route.GET(new Request("http://localhost/stats"), { params: Promise.resolve({ id: session.sessionId }) });
  assert.equal(response.status, 200); const snapshot = await response.json();
  assert.deepEqual(snapshot.accounting, command.accounting);
  assert.equal(snapshot.accounting.source, "sdk"); assert.equal(snapshot.cost, 2);
  assert.equal(snapshot.accounting.full.categories.tools.cost, 1);
  assert.equal(snapshot.accounting.full.categories.other.cost, 1);
});



