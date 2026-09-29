import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import webpackModule from "next/dist/compiled/webpack/webpack.js";

const require = createRequire(import.meta.url);
const webpack = webpackModule.webpack;
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const chrome = process.env.CHROME_PATH ?? (process.platform === "win32"
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium");

async function bundleFixture(dir) {
  const loader = path.join(dir, "ts-loader.cjs");
  await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve("typescript"))});
module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022
}}).outputText; };`);
  await writeFile(path.join(dir, "entry.jsx"), `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useChatViewport } from ${JSON.stringify(path.join(projectRoot, "components/useChatViewport.ts").replaceAll("\\", "/"))};
import { getVisibleRenderWindow } from ${JSON.stringify(path.join(projectRoot, "lib/chat-lazy-load.ts").replaceAll("\\", "/"))};
import { MessageView } from ${JSON.stringify(path.join(projectRoot, "components/MessageView.tsx").replaceAll("\\", "/"))};
const historyMessage = { role: "assistant", provider: "test", model: "test", content: [
  { type: "thinking", thinking: "Earlier reasoning" },
  { type: "toolCall", toolCallId: "tool-old", toolName: "read", input: { path: "old.txt" } },
  { type: "text", text: "Historical text to keep selected" },
] };
function Demo() {
  const [started, setStarted] = useState(location.hash === "#existing");
  const [count, setCount] = useState(51);
  const [tick, setTick] = useState(0);
  const [stream, setStream] = useState(null);
  window.startChat = () => setStarted(true);
  window.tickChat = () => {
    setTick(v => v + 1);
    setStream({ role: "assistant", content: [
      { type: "thinking", thinking: "Working " + Date.now() },
      { type: "toolCall", toolCallId: "tool-1", toolName: "read", input: { path: "file.txt" } },
      { type: "text", text: "Live text " + Date.now() },
    ] });
  };
  window.updateChat = () => { setCount(v => v + 1); window.tickChat(); };
  const { visibleCount, pinnedVisibleStart, rememberVisibleStart, scrollContainerRef, messagesEndRef } = useChatViewport({
    messageCount: started ? count : 0, streamingMessage: stream,
    agentRunning: started, loading: false, hasMessageViewport: started, promptGeneration: 0,
  });
  const { startIndex } = getVisibleRenderWindow(count, visibleCount, pinnedVisibleStart);
  rememberVisibleStart(startIndex);
  return started ? <><div ref={scrollContainerRef} style={{height:100,overflowY:"auto"}}>
    <div>{Array.from({length: count - startIndex}, (_, i) => {
      const index = startIndex + i;
      return <div key={index} id={index === 1 ? "history" : undefined}>
        {index === 1 ? <MessageView message={historyMessage} entryId="history-1" timingRevision={tick}
          liveThinking={new Map([[0, tick]])} runningThinking={new Set([0])}
          liveTools={new Map([["tool-old", tick]])} runningTools={new Set(["tool-old"])} /> : "Message " + index}
      </div>;
    })}<MessageView message={stream ?? { role: "assistant", content: [] }} isStreaming />
      <div style={{height:500}} /><div ref={messagesEndRef} /></div>
  </div><textarea id="composer" /></> : <div>Empty new session</div>;
}
createRoot(document.getElementById("app")).render(<Demo />);
`);
  await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, entry: path.join(dir, "entry.jsx"),
    output: { path: dir, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".jsx"], alias: { "@": projectRoot }, modules: [path.join(projectRoot, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.(tsx?|jsx)$/, use: loader }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString("errors-only"))) : resolve()));
  await writeFile(path.join(dir, "index.html"), '<div id="app"></div><script src="./bundle.js"></script>');
}

async function connectChrome(port, processHandle) {
  let socketUrl;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (processHandle.exitCode !== null) throw new Error("Chrome exited before the debugger was ready");
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      socketUrl = pages.find((page) => page.type === "page")?.webSocketDebuggerUrl;
      if (socketUrl) break;
    } catch { /* Still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!socketUrl) throw new Error("Chrome debugger did not start");
  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    if (!response.id) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  return { socket, send, evaluate };
}

for (const initiallyEmpty of [true, false]) test(`selection survives ${initiallyEmpty ? "new" : "existing"} session updates`, async (t) => {
  try { await access(chrome); } catch { t.skip("Chrome not available"); return; }
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-chat-select-"));
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
  let child;
  let client;
  try {
    await bundleFixture(dir);
    child = spawn(chrome, ["--headless", "--no-first-run", "--no-default-browser-check",
      `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(dir, "profile")}`, "about:blank"],
    { stdio: "ignore" });
    client = await connectChrome(port, child);
    await client.send("Page.enable");
    await client.send("Page.navigate", { url: pathToFileURL(path.join(dir, "index.html")).href + (initiallyEmpty ? "" : "#existing") });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await client.evaluate("typeof window.startChat === 'function'")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await client.evaluate("typeof window.startChat"), "function");
    if (initiallyEmpty) await client.evaluate("window.startChat()");
    await client.evaluate(`new Promise(resolve => setTimeout(() => {
      const viewport = document.querySelector("#history").parentElement.parentElement;
      viewport.scrollTop = 0;
      const paragraph = document.querySelector("#history .markdown-body p");
      paragraph.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 15);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      resolve();
    }, 50))`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const target = await client.evaluate(`(() => {
      window.savedAnchor = getSelection().anchorNode;
      window.savedFocus = getSelection().focusNode;
      window.savedAnchorOffset = getSelection().anchorOffset;
      window.savedFocusOffset = getSelection().focusOffset;
      const rect = document.querySelector("#composer").getBoundingClientRect();
      return { x: rect.left + 5, y: rect.top + 5 };
    })()`);
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
    for (let tick = 0; tick < 4; tick++) {
      await client.evaluate(tick % 2 ? "window.updateChat()" : "window.tickChat()");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = await client.evaluate(`(() => ({
        text: getSelection().toString(),
        connected: getSelection().anchorNode?.isConnected,
        sameAnchor: getSelection().anchorNode === window.savedAnchor && getSelection().anchorOffset === window.savedAnchorOffset,
        sameFocus: getSelection().focusNode === window.savedFocus && getSelection().focusOffset === window.savedFocusOffset,
        scrollTop: document.querySelector("#history").parentElement.parentElement.scrollTop,
      }))()`);
      assert.deepEqual(state, { text: "Historical text", connected: true, sameAnchor: true, sameFocus: true, scrollTop: 0 });
    }
    await client.evaluate("getSelection().removeAllRanges()");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.evaluate("window.updateChat()");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await client.evaluate("document.querySelector('#history') === null"), true);
    await client.evaluate(`(() => {
      const viewport = document.querySelector("#composer").previousElementSibling;
      viewport.scrollTop = viewport.scrollHeight;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.evaluate("window.tickChat()");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await client.evaluate(`(() => {
      const viewport = document.querySelector("#composer").previousElementSibling;
      return Math.abs(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) <= 1;
    })()`), true);
  } finally {
    client?.socket.close();
    child?.kill();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
