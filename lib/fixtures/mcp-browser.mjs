import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import webpackModule from "next/dist/compiled/webpack/webpack.js";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../..", import.meta.url));
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function findChrome() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
}
export async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(30); }
  assert.fail("MCP browser condition timed out");
}
async function bundle(dir) {
  const swc = require.resolve("next/dist/build/swc"), loader = path.join(dir, "loader.cjs"), css = path.join(dir, "css.cjs");
  await writeFile(loader, 'const swc=require(' + JSON.stringify(swc) + ');module.exports=function(source){return swc.transformSync(source,{filename:this.resourcePath,jsc:{parser:{syntax:"typescript",tsx:/\\.(tsx|jsx)$/.test(this.resourcePath)},target:"es2022",transform:{react:{runtime:"automatic"}}},module:{type:"es6"}}).code}');
  await writeFile(css, 'module.exports=()=>\'module.exports={backdrop:"backdrop",modal:"modal",editorModal:"editorModal"}\';');
  const i18n = path.join(dir, "i18n.js");
  await writeFile(i18n, 'import en from ' + JSON.stringify(path.join(root, "lib/i18n/en.ts").replaceAll("\\", "/")) +
    ';export function useI18n(){return {t:(key)=>en[key]??key}}');
  await new Promise((resolve, reject) => webpackModule.webpack({
    mode: "development", devtool: false, entry: path.join(root, "lib/fixtures/mcp-tools-ui.jsx"),
    output: { path: dir, filename: "bundle.js" },
    resolve: { extensions: [".ts", ".tsx", ".js", ".jsx"], alias: { "@/lib/i18n$": i18n, "@": root },
      modules: [path.join(root, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.(tsx?|jsx)$/, use: loader }, { test: /\.css$/, use: css }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString("errors-only"))) : resolve()));
}
async function connect(port, child) {
  let url;
  await waitFor(async () => {
    assert.equal(child.exitCode, null, "Chrome exited");
    try { url = (await (await fetch("http://127.0.0.1:" + port + "/json")).json()).find(p => p.type === "page")?.webSocketDebuggerUrl; } catch {}
    return !!url;
  });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.text);
    const action = pending.get(data.id); if (!action) return; pending.delete(data.id);
    if (data.error) action.reject(new Error(data.error.message)); else action.resolve(data.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const data = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (data.exceptionDetails) throw new Error(data.exceptionDetails.exception?.description ?? data.exceptionDetails.text);
    return data.result.value;
  };
  return { socket, send, evaluate, errors };
}
export async function withMcpBrowser(run) {
  const chrome = await findChrome();
  assert.ok(chrome, "Chrome is required for the requested MCP browser tests (set CHROME_PATH)");
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-mcp-browser-"));
  let child, client, server;
  try {
    await bundle(dir);
    server = createServer(async (req, res) => {
      res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
      res.end(req.url === "/bundle.js" ? await readFile(path.join(dir, "bundle.js")) : '<div id="app"></div><script src="/bundle.js"></script>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const debug = createServer(); await new Promise(resolve => debug.listen(0, "127.0.0.1", resolve));
    const port = debug.address().port; await new Promise(resolve => debug.close(resolve));
    child = spawn(chrome, ["--headless", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--no-proxy-server",
      "--host-resolver-rules=MAP remote.test 127.0.0.1", "--remote-debugging-port=" + port,
      "--user-data-dir=" + path.join(dir, "profile"), "about:blank"], { stdio: "ignore" });
    client = await connect(port, child);
    await client.send("Runtime.enable"); await client.send("Page.enable");
    const base = "http://127.0.0.1:" + server.address().port;
    await client.send("Page.navigate", { url: base });
    await waitFor(() => client.evaluate('!!document.querySelector(".tools-row")'));
    await run(client, base); assert.deepEqual(client.errors, []);
  } finally {
    client?.socket.close();
    if (child?.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      else child.kill("SIGTERM");
      await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
