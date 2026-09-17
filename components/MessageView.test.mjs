import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");

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

test("collapsed previews use the first non-args field when tool is absent", () => {
  for (const key of ["command", "path", "file_path", "pattern", "query", "server"]) {
    for (const input of [{ args: {}, [key]: "first", other: "second" }, { [key]: "first", args: {} }]) {
      assert.equal(collapsedPreview("custom", input), "first");
    }
  }
  assert.equal(collapsedPreview("bash", { path: "first", command: "pwd" }), "first");
  assert.equal(collapsedPreview("custom", { text: "fallback" }), "fallback");
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
      for (const input of [{ args, tool }, { tool, args }, { args, server: "ignored", query: "ignored", tool }]) {
        for (const streaming of [false, true]) {
          assert.equal(collapsedPreview(toolName, input, streaming), tool);
        }
      }
    }
  }
});
