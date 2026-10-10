import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { verifyNativeMcpEditor } from "./native-mcp-browser-smoke.mjs";
import { verifyWorkspacePackSwitches } from "./workspace-packs-browser-smoke.mjs";
import { createJiti } from "jiti";
import { verifyWorkspacePackRuntime } from "./workspace-pack-runtime-smoke.mjs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyBrowser } from "./production-browser-smoke.mjs";

const buildRoot = process.env.PIVOT_TEST_PRODUCTION_DIR;

async function verifyPages(port, child, output, cwd) {
  const base = `http://127.0.0.1:${port}`;
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, output());
    try {
      page = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.equal(page?.status, 200, output());
  assert.match(await page.text(), /<html/);
  const login = await fetch(`${base}/api/gateway/login`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: '{"token":"production-page-test"}' });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  const home = await fetch(base, { headers });
  assert.equal(home.status, 200, output());
  const html = await home.text();
  assert.match(html, /<html/);
  assert.match(html, /Pivot UI/);
  const script = html.match(/src="([^" ]*\/_next\/static\/[^" ]+)"/);
  assert.ok(script, "home must reference its compiled client assets");
  assert.equal((await fetch(base + script[1])).status, 200);
  const created = await fetch(`${base}/api/agent/new`, { method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, type: "ensure_session", toolPreset: "none", toolNames: [] }) });
  assert.equal(created.status, 200, await created.clone().text());
  const { sessionId } = await created.json();
  const command = (body) => fetch(`${base}/api/agent/${sessionId}`, { method: "POST",
    headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const toolsResponse = await command({ type: "get_tools" });
  assert.equal(toolsResponse.status, 200, `${await toolsResponse.clone().text()}\n${output()}`);
  const tools = (await toolsResponse.json()).data;
  assert.ok(tools.find((tool) => tool.name === "grep")?.active);
  assert.ok(tools.filter((tool) => !["codemode", "tool_search"].includes(tool.name) && !tool.name.startsWith("mcp__")).every((tool) => tool.active));
  if (process.env.PIVOT_TEST_NATIVE_MCP !== "1") assert.ok(tools.filter((tool) => ["codemode", "tool_search"].includes(tool.name)).every((tool) => !tool.active));
  assert.equal((await command({ type: "set_tools", preset: "none" })).status, 200);
  const after = (await (await command({ type: "get_tools" })).json()).data;
  assert.ok(after.filter((tool) => !["codemode", "tool_search"].includes(tool.name) && !tool.name.startsWith("mcp__")).every((tool) => tool.active));
  const nativeInfo = await fetch(base + "/api/mcp/native-servers?cwd=" + encodeURIComponent(cwd), { headers });
  assert.equal(nativeInfo.status, 200, `${await nativeInfo.clone().text()}\n${output()}`);
  const keyUrl = `${base}/api/auth/api-key/azure-openai-responses`;
  const privateKey = "local-production-key-fixture";
  const keySaved = await fetch(keyUrl, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: privateKey }) });
  assert.equal(keySaved.status, 200, await keySaved.clone().text());
  const keyStatus = await (await fetch(keyUrl, { headers })).json();
  assert.equal(keyStatus.configured, true);
  assert.equal(keyStatus.source, "stored");
  assert.ok(keyStatus.models > 0);
  assert.doesNotMatch(JSON.stringify(keyStatus), new RegExp(privateKey));
  assert.equal((await fetch(keyUrl, { method: "DELETE", headers })).status, 200);
  assert.notEqual((await (await fetch(keyUrl, { headers })).json()).source, "stored");
  assert.doesNotMatch(output(), /this\.load is not a function|renderToPipeableStream is not implemented/);
  const packConfigBefore = process.env.PIVOT_TEST_NATIVE_MCP === "1"
    ? await readFile(path.join(cwd, 'skill-packs.json'), 'utf8') : null;
  if (process.env.PIVOT_TEST_BROWSER === "1") await verifyBrowser(base, "production-page-test", async (client) => {
    await verifyNativeMcpEditor(client, cwd);
    if (process.env.PIVOT_TEST_NATIVE_MCP === "1") await verifyWorkspacePackSwitches(client, cwd);
  });
  if (packConfigBefore !== null) assert.equal(await readFile(path.join(cwd, 'skill-packs.json'), 'utf8'), packConfigBefore);
  if (process.env.PIVOT_TEST_NATIVE_MCP === "1") {
    const tracked = ['settings.json', '.pi/mcp.json', 'mcp-adapter.json', 'pivot-mcp-migration.json'];
    const snapshot = await Promise.all(tracked.map((file) => readFile(path.join(cwd, file), 'utf8').catch((e) => { if (e.code === 'ENOENT') return null; throw e; })));
    let nativeTools;
    for (let i = 0; i < 100; i++) {
      nativeTools = (await (await command({ type: 'get_tools' })).json()).data;
      if (nativeTools.some((tool) => tool.name === 'mcp__fixture__echo')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(nativeTools.some((tool) => tool.name === 'mcp__fixture__echo'));
    assert.equal(nativeTools.find((tool) => tool.name === 'codemode').active, true);
    assert.equal(nativeTools.find((tool) => tool.name === 'mcp__fixture__echo').active, false);
    await verifyWorkspacePackRuntime(base, headers, cwd, sessionId);
    assert.equal((await fetch(base + '/api/mcp/migration', { headers })).status, 404);
    assert.equal((await fetch(base + '/api/mcp/migration', { method: 'POST', headers, body: '{"action":"manual"}' })).status, 404);
    const status = await (await fetch(base + '/api/mcp/status?cwd=' + encodeURIComponent(cwd), { headers })).json();
    assert.equal(status.backend, 'native'); assert.equal(status.state, 'native');
    for (const type of ['prompt', 'steer', 'follow_up']) {
      const response = await command({ type, message: 'Handled locally; no migration decision required' });
      assert.equal(response.status, 200, await response.clone().text());
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const sent = await fetch(base + '/api/agent/new', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, type: 'prompt', message: 'Handled locally' }) });
    assert.equal(sent.status, 200, await sent.clone().text());
    const afterFiles = await Promise.all(tracked.map((file) => readFile(path.join(cwd, file), 'utf8').catch((e) => { if (e.code === 'ENOENT') return null; throw e; })));
    assert.deepEqual(afterFiles, snapshot);
  }
}


test("production login and authenticated home render HTML, not just API JSON", {
  skip: !buildRoot, timeout: 90000,
}, async () => {
  const root = path.resolve(buildRoot);
  const require = createRequire(path.join(root, "package.json"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pivot-page-smoke-"));
  if (process.env.PIVOT_TEST_NATIVE_MCP === "1") {
    const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); };
    await save(path.join(agentDir, 'settings.json'), { defaultProjectTrust: 'always', extensions: ['./handle-input.ts'] });
    const skillDir = path.join(agentDir, 'library/.pi/skills/workspace-fixture');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: workspace-fixture\ndescription: workspace fixture\n---\nbody');
    const { computeSkillHash } = await createJiti(import.meta.url).import('../lib/content-hash.ts');
    await save(path.join(agentDir, 'skill-packs.json'), { version: 2, libraryRoot: path.join(agentDir, 'library'), packs: [
      { id: 'native-workspace', name: 'Native workspace fixture', skills: [{ skillKey: 'workspace-fixture', contentHash: computeSkillHash(skillDir) }], mcpServers: [], nativeMcpServers: ['fixture'] },
      { id: 'legacy-mixed', name: 'Legacy mixed', skills: [{ skillKey: 'legacy-skill', contentHash: 'old' }],
        mcpServers: [{ serverKey: 'legacy', configHash: 'old' }] },
    ] });
    await writeFile(path.join(agentDir, 'handle-input.ts'), 'export default pi => pi.on("input", async e => { if (e.text === "hold") await new Promise(r => setTimeout(r, 4000)); return {action:"handled"}; });');
    await save(path.join(agentDir, '.pi/mcp.json'), { mcpServers: { fixture: { command: process.execPath,
      args: [path.resolve('lib/fixtures/native-mcp-server.mjs'), path.join(agentDir, 'server.pid')] } } });
    if (process.env.PIVOT_TEST_OLD_MCP_MARKER !== 'absent') {
      await save(path.join(agentDir, 'pivot-mcp-migration.json'), { generation: 'native-v1',
        phase: process.env.PIVOT_TEST_OLD_MCP_MARKER ?? 'pending' });
    }
    await save(path.join(agentDir, 'mcp-adapter.json'), { mcpServers: { legacy: { command: 'never-execute-legacy', disabled: true } } });
  }
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir,
      PIVOT_GATEWAY_TOKEN: "production-page-test", NEXT_TELEMETRY_DISABLED: "1",
      ...{ USERPROFILE: agentDir, HOME: agentDir },
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await verifyPages(port, child, () => output, agentDir);
  } finally {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
