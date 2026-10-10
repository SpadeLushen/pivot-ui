import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createPivotAgentSessionServices } = await jiti.import('./model-runtime.ts');
const { activateAllSessionTools } = await jiti.import('./active-tools.ts');
const { mcpLoadStatus } = await jiti.import('./native-mcp-runtime.ts');
const server = fileURLToPath(new URL('./fixtures/native-mcp-server.mjs', import.meta.url));
function toolModel(services, tool, argumentsFor) {
  services.modelRuntime.registerProvider('native-fixture', {
    api: 'native-fixture-api', apiKey: 'fixture', baseUrl: 'http://unused.invalid',
    models: [{ id: 'stub', contextWindow: 100000, maxTokens: 1024, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const userIndex = context.messages.findLastIndex((message) => message.role === 'user');
      const completed = context.messages.slice(userIndex + 1).some((message) => message.role === 'toolResult');
      const input = context.messages[userIndex].content.map((block) => block.text ?? '').join('');
      const stream = createAssistantMessageEventStream();
      const reason = completed ? 'stop' : 'toolUse';
      const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: completed ? [{ type: 'text', text: 'done' }] : [{ type: 'toolCall', id: `call-${Date.now()}`, name: tool, arguments: argumentsFor(input) }],
        stopReason: reason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { stream.push({ type: 'done', reason, message }); stream.end(); });
      return stream;
    },
  });
  return services.modelRuntime.getModel('native-fixture', 'stub');
}
const closing = new Map();
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); };
async function fixture(t, exposure = 'direct', trusted = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pivot-native-mcp-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    const session = closing.get(dir);
    if (session) { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); closing.delete(dir); }
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await save(path.join(dir, 'settings.json'), { defaultProjectTrust: trusted ? 'always' : 'never' });
  const pid = path.join(dir, 'server.pid');
  await save(path.join(dir, '.pi/mcp.json'), { mcpServers: { local: { command: process.execPath, args: [server, pid], exposure } } });
  return { dir, pid };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn) { for (let n = 0; n < 100; n++) { if (await fn()) return; await delay(50); } assert.fail('Native MCP timeout'); }
test('native stdio tool loads, calls through permission hooks, and shuts down its process', async (t) => {
  const { dir, pid } = await fixture(t);
  const services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir, resourceLoaderOptions: { extensionFactories: [
    (pi) => { pi.on('tool_call', (event) => event.toolName === 'mcp__local__echo' && event.input.text === 'blocked' ? { block: true, reason: 'Fixture denied' } : undefined); },
  ] } });
  assert.equal(mcpLoadStatus(services.resourceLoader.getExtensions()).state, 'native');
  await assert.rejects(readFile(pid), /ENOENT/, 'loading services for a model probe must not connect MCP');
  const model = toolModel(services, 'mcp__local__echo', (text) => ({ text }));
  const { session } = await createAgentSessionFromServices({ services, model, sessionManager: SessionManager.inMemory(dir) });
  closing.set(dir, session);
  await session.bindExtensions({});
  await waitFor(() => session.getAllTools().some((tool) => tool.name === 'mcp__local__echo'));
  activateAllSessionTools(session);
  await session.prompt('native-real-call');
  const value = session.messages.findLast((message) => message.role === 'toolResult');
  assert.equal(value.isError, false);
  assert.equal(value.content[0].text, 'native-real-call');
  await session.prompt('blocked');
  const blocked = session.messages.findLast((message) => message.role === 'toolResult');
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked.content), /Fixture denied/);
  assert.equal(await readFile(`${pid}.calls`, 'utf8'), 'native-real-call\n');
  const childPid = Number(await readFile(pid, 'utf8'));
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  await waitFor(() => { try { process.kill(childPid, 0); return false; } catch { return true; } });
});
test('globally disabled native definitions keep full project activation and never connect elsewhere', async (t) => {
  const { dir, pid } = await fixture(t);
  const dormantPid = path.join(dir, 'dormant.pid');
  await save(path.join(dir, 'mcp.json'), { mcpServers: {
    local: { command: process.execPath, args: [server, pid], exposure: 'direct', enabled: false },
    dormant: { command: process.execPath, args: [server, dormantPid], enabled: false },
  } });
  let services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  let { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir) });
  closing.set(dir, session); await session.bindExtensions({});
  await waitFor(() => session.getAllTools().some((tool) => tool.name === 'mcp__local__echo'));
  await assert.rejects(readFile(dormantPid), /ENOENT/);
  const originalPid = await readFile(pid, 'utf8');
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); closing.delete(dir);
  const other = path.join(dir, 'other-workspace'); await mkdir(other);
  services = await createPivotAgentSessionServices({ cwd: other, agentDir: dir });
  ({ session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(other) }));
  closing.set(dir, session); await session.bindExtensions({}); await delay(250);
  assert.ok(!session.getAllTools().some((tool) => tool.name.startsWith('mcp__')));
  assert.equal(await readFile(pid, 'utf8'), originalPid);
  await assert.rejects(readFile(dormantPid), /ENOENT/);
});
test('default codemode exposure stays indirect and its WASM worker can call a real MCP tool', async (t) => {
  const { dir } = await fixture(t, 'codemode');
  const services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const model = toolModel(services, 'codemode', () => ({ code: 'text(await tools.mcp__local__echo({text: "worker-call"}))' }));
  const { session } = await createAgentSessionFromServices({ services, model, sessionManager: SessionManager.inMemory(dir) });
  closing.set(dir, session);
  await session.bindExtensions({});
  await waitFor(() => session.getAllTools().some((tool) => tool.name === 'mcp__local__echo'));
  activateAllSessionTools(session);
  assert.ok(!session.getActiveToolNames().includes('mcp__local__echo'));
  assert.ok(session.getActiveToolNames().includes('codemode'));
  await session.prompt('worker');
  const result = session.messages.findLast((message) => message.role === 'toolResult');
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result.content), /worker-call/);
});
test('untrusted project configuration never starts a server', async (t) => {
  const { dir, pid } = await fixture(t, 'direct', false);
  const services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir) });
  await session.bindExtensions({});
  await delay(200);
  assert.equal(session.settingsManager.isProjectTrusted(), false);
  await assert.rejects(readFile(pid), /ENOENT/);
  assert.ok(!session.getAllTools().some((tool) => tool.name === 'mcp__local__echo'));
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
});
test('SDK replacement warnings identify a local third-party command without package-name guessing', async (t) => {
  const { dir, pid } = await fixture(t);
  const extension = path.join(dir, 'extensions/third-party.ts');
  await mkdir(path.dirname(extension), { recursive: true });
  await writeFile(extension, 'export default pi => pi.registerCommand("mcp", {description:"replacement", handler:async()=>{}});');
  const services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const result = services.resourceLoader.getExtensions();
  assert.ok(result.warnings.some((warning) => warning.path === 'builtin:mcp'));
  assert.equal(mcpLoadStatus(result).state, 'replaced');
  assert.equal(mcpLoadStatus(result).plugins.length, 1);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir) });
  await session.bindExtensions({}); await delay(100);
  await assert.rejects(readFile(pid), /ENOENT/);
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
});
for (const phase of ['absent', 'pending', 'succeeded']) test(`native tools work without migration decisions (${phase}) and preserve old files`, async (t) => {
  const { dir } = await fixture(t);
  const marker = path.join(dir, 'pivot-mcp-migration.json');
  if (phase !== 'absent') await save(marker, { generation: 'native-v1', phase });
  const legacy = path.join(dir, 'mcp-adapter.json');
  await save(legacy, { mcpServers: { old: { command: 'never-execute-legacy' } } });
  const oldConfig = await readFile(legacy, 'utf8');
  const nativeConfig = await readFile(path.join(dir, '.pi/mcp.json'), 'utf8');
  const oldMarker = phase === 'absent' ? null : await readFile(marker, 'utf8');
  const services = await createPivotAgentSessionServices({ cwd: dir, agentDir: dir });
  const model = toolModel(services, 'mcp__local__echo', (text) => ({ text }));
  const { session } = await createAgentSessionFromServices({ services, model, sessionManager: SessionManager.inMemory(dir) });
  closing.set(dir, session); await session.bindExtensions({});
  await waitFor(() => session.getAllTools().some((tool) => tool.name === 'mcp__local__echo'));
  activateAllSessionTools(session); await session.prompt('native-only');
  assert.equal(session.messages.findLast((m) => m.role === 'toolResult').content[0].text, 'native-only');
  assert.equal(await readFile(legacy, 'utf8'), oldConfig);
  assert.equal(await readFile(path.join(dir, '.pi/mcp.json'), 'utf8'), nativeConfig);
  if (oldMarker === null) await assert.rejects(readFile(marker), /ENOENT/);
  else assert.equal(await readFile(marker, 'utf8'), oldMarker);
});
test('command presence is not a replacement diagnosis and missing assembly is unknown', () => {
  const result = { extensions: [{ path: 'third-party.ts', commands: new Map([['mcp', {}]]) }], warnings: [], errors: [] };
  assert.equal(mcpLoadStatus(result).state, 'unknown');
  assert.equal(mcpLoadStatus(result, true).state, 'disabled');
  assert.equal(mcpLoadStatus(result).plugins.length, 1);
  result.warnings.push({ path: 'builtin:mcp', warning: 'SDK replacement' });
  assert.equal(mcpLoadStatus(result).state, 'replaced');
});
