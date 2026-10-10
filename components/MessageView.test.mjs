import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");
const { NestedToolCalls } = await jiti.import("./NestedToolCalls.tsx");
const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const toolStart = source.indexOf("function ToolCallBlock(");
const inputStart = source.indexOf("  const input = block.input;", toolStart);
const inputEnd = source.indexOf("  const isEditTool", inputStart);
assert.ok(inputStart > toolStart && inputEnd > inputStart);
const expandedInput = new Function("block", `${source.slice(inputStart, inputEnd)}\nreturn inputStr;`);

function timedTool(durationMs, liveDuration, storageDuration) {
  const previous = globalThis.window;
  const records = new Map([["pivot-timing:v1:tool:sdk:call-1", String(storageDuration)]]);
  globalThis.window = { sessionStorage: { getItem: key => records.get(key) ?? null } };
  try {
    return renderToStaticMarkup(React.createElement(MessageView, {
      sessionId: "sdk", timingRevision: 1,
      message: { role: "assistant", content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: {} }] },
      toolResults: new Map([["call-1", { role: "toolResult", toolCallId: "call-1", durationMs, content: [] }]]),
      liveTools: liveDuration === undefined ? undefined : new Map([["call-1", liveDuration]]),
    }));
  } finally { globalThis.window = previous; }
}

test("completed tools prefer persisted SDK duration over live and cached timing", () => {
  for (const duration of [0, 12]) {
    const html = timedTool(duration, 42, 99);
    assert.match(html, new RegExp(`>${duration}ms<`));
    assert.doesNotMatch(html, />42ms<|>99ms</);
  }
});

test("legacy tools fall back to live then cached timing and never invent a missing duration", () => {
  assert.match(timedTool(undefined, 42, 99), />42ms</);
  assert.match(timedTool(-1, 42, 99), />42ms</);
  assert.match(timedTool(undefined, undefined, 99), />99ms</);
  assert.doesNotMatch(timedTool(undefined, undefined, undefined), />\d+ms</);
});

test("nested saved pipeline duration stays authoritative over observed execute timing", () => {
  for (const [durationMs, status, uncertain, expected] of [
    [0, "ok", false, "0ms"], [88, "ok", false, "88ms"],
    [undefined, "ok", false, "42ms"], [undefined, "unfinished", false, "—"],
    [undefined, "running", true, "—"],
  ]) {
    const html = renderToStaticMarkup(React.createElement(NestedToolCalls, {
      rootId: "root", group: { complete: true, uncertain, calls: [
        { id: "child", parentId: "root", name: "read", status, durationMs },
      ] }, liveTools: new Map([["child", 42]]), renderResult: () => null,
    }));
    assert.match(html, new RegExp(`>${expected}<`));
    if (expected !== "42ms") assert.doesNotMatch(html, />42ms</);
  }
});

test("expanded code-only calls preserve real newlines and literal backslashes without double decoding", () => {
  for (const code of ['console.log("first");\nconsole.log("second");', String.raw`const path = "C:\\workspace\\new";`, String.raw`const escaped = "\\n\\t";`, "\tindented\nnext", ""]) {
    assert.equal(expandedInput({ input: { code } }), code);
  }
});

test("other inputs retain their complete JSON representation", () => {
  for (const input of [{ code: "script", limit: 1 }, { code: 1 }, { path: "C:\\file" }, {}, undefined]) {
    assert.equal(expandedInput({ input }), JSON.stringify(input, null, 2));
  }
});

function collapsedPreview(toolName, input, isStreaming = false) {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName, input }],
    },
    isStreaming,
  }));
  assert.doesNotMatch(html, /<pre\b/);
  const match = html.match(/<button\b[^>]*><span\b[^>]*>.*?<\/span><span\b[^>]*>(.*?)<\/span>/s);
  assert.ok(match, "collapsed tool header contains a preview");
  return match[1];
}

function escaped(text) {
  return renderToStaticMarkup(React.createElement("span", null, text))
    .replace(/^<span>|<\/span>$/g, "");
}

test("collapsed previews ignore args, including partial MCP calls", () => {
  for (const args of [{ query: "example" }, [{ id: 1 }], "example", null, 0, false, undefined]) {
    for (const streaming of [false, true]) {
      assert.equal(collapsedPreview("mcp", { args }, streaming), "");
    }
  }
  assert.equal(collapsedPreview("mcp", {}, true), "");
  assert.equal(collapsedPreview("mcp", undefined, true), "");
});

test("collapsed previews use the first non-args field when tool, path, and question are absent", () => {
  for (const key of ["command", "file_path", "pattern", "query", "server"]) {
    for (const input of [{ args: {}, [key]: "first", other: "second" }, { [key]: "first", args: {} }]) {
      assert.equal(collapsedPreview("custom", input), "first");
    }
  }
  assert.equal(collapsedPreview("custom", { text: "fallback" }), "fallback");
});

test("collapsed previews prefer path over other fields when tool is absent", () => {
  const path = "components/MessageView.tsx";
  for (const input of [
    { args: {}, command: "ignored", path },
    { offset: 10, path, args: {} },
    { path, command: "ignored", args: {} },
    { question: "ignored", args: {}, path },
    { path, question: "ignored" },
  ]) {
    for (const streaming of [false, true]) {
      assert.equal(collapsedPreview("custom", input, streaming), path);
    }
  }
});

test("collapsed previews prefer question when tool and path are absent", () => {
  const question = "Which option should we use?";
  for (const input of [
    { args: {}, options: [{ label: "First" }], question },
    { question, options: [], args: {} },
    { command: "ignored", question },
  ]) {
    for (const streaming of [false, true]) {
      assert.equal(collapsedPreview("ask_question", input, streaming), question);
    }
  }
});

test("collapsed previews serialize selected values and retain the 120-character limit", () => {
  for (const value of [{ query: "example" }, [{ id: 1 }], null, 0, false]) {
    assert.equal(collapsedPreview("custom", { args: {}, data: value }), escaped(JSON.stringify(value)));
  }
  assert.equal(collapsedPreview("mcp", { args: {}, tool: "x".repeat(150) }), "x".repeat(120));
  const data = { query: "x".repeat(150) };
  assert.equal(collapsedPreview("custom", { args: {}, data }), escaped(JSON.stringify(data).slice(0, 120)));
});

test("collapsed MCP calls show the tool regardless of argument order", () => {
  const tool = "search/example";
  for (const toolName of ["mcp", "mcp__search"]) {
    for (const args of [{ query: "example" }, '{"query":"example"}']) {
      for (const input of [
        { args, tool },
        { tool, args },
        { args, server: "ignored", query: "ignored", tool },
        { args, path: "ignored", tool },
        { tool, path: "ignored", args },
        { question: "ignored", args, tool },
        { tool, question: "ignored", args },
      ]) {
        for (const streaming of [false, true]) {
          assert.equal(collapsedPreview(toolName, input, streaming), tool);
        }
      }
    }
  }
});
