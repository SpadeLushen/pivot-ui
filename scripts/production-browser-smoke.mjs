import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(100); }
  throw new Error(`Browser timeout: ${label}`);
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
async function connect(port, child, errors) {
  let url;
  await waitFor(async () => {
    assert.equal(child.exitCode, null, "Chrome exited");
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((page) => page.type === "page")?.webSocketDebuggerUrl; } catch {}
    return !!url;
  }, "Chrome debugger");
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (!data.id) return;
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result);
  });
  return makeClient(socket, pending, () => ++nextId);
}
function makeClient(socket, pending, nextId) {
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId(); pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  return { socket, send, evaluate };
}

async function clickLogin(client) {
  const point = await client.evaluate("(() => { const r = document.querySelector('button[type=submit]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

export async function verifyBrowser(base, token, afterAuthenticated) {
  const chrome = process.env.CHROME_PATH ?? (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium");
  await access(chrome);
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-production-browser-"));
  const port = await freePort();
  const child = spawn(chrome, ["--headless", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
  const errors = [];
  let client;
  try {
    client = await connect(port, child, errors);
    await client.send("Runtime.enable"); await client.send("Page.enable");
    await client.send("Page.navigate", { url: `${base}/login` });
    const evaluate = async (expression) => {
      assert.deepEqual(errors, [], "browser must not throw during hydration");
      return client.evaluate(expression);
    };
    await waitFor(() => evaluate("!!document.querySelector('input[type=password]')"), "login input");
    await evaluate("document.querySelector('input[type=password]').focus()");
    await client.send("Input.insertText", { text: token });
    await waitFor(() => evaluate("!document.querySelector('button[type=submit]').disabled"), "hydrated login form");
    await clickLogin(client);
    await waitFor(() => evaluate("location.pathname === '/' && !!document.querySelector('textarea')"), "hydrated home composer");
    await delay(1000); assert.deepEqual(errors, [], "home must hydrate without exceptions");
    if (afterAuthenticated) await afterAuthenticated({ ...client, evaluate });
    assert.deepEqual(errors, [], "browser interactions must not throw");
  } finally {
    client?.socket.close();
    if (process.platform === "win32" && child.exitCode === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
