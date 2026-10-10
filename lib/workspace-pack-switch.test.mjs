import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { previewWorkspacePackSwitch, applyWorkspacePackSwitch } = await jiti.import('./workspace-pack-switch.ts');
const { readWorkspaceState } = await jiti.import('./workspace-packs.ts');
const { computeSkillHash } = await jiti.import('./content-hash.ts');
const { loadNativeMcpConfig, nativeMcpServerInfo } = await jiti.import('./native-mcp-config.ts');
const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
const { notifyWorkspacePacks } = await jiti.import('./workspace-pack-events.ts');
const { SessionManager, SettingsManager, ModelRuntime } = await import('@earendil-works/pi-coding-agent');
const save = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pivot-workspace-switch-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const cwd = path.join(root, 'workspace'), libraryRoot = path.join(root, 'library');
  mkdirSync(cwd); save(path.join(root, 'settings.json'), { defaultProjectTrust: 'always' });
  return { root, cwd, libraryRoot };
}

function setup(t) {
  const f = fixture(t), dir = path.join(f.libraryRoot, '.pi/skills/example');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: example\ndescription: example\n---\nbody');
  save(path.join(f.root, 'mcp.json'), { mcpServers: { shared: { command: 'never-run', enabled: false, env: { TOKEN: 'private-fixture' } } } });
  save(path.join(f.cwd, '.pi/mcp.json'), { custom: 7, mcpServers: { shared: { exposure: 'deferred' }, unrelated: { command: 'unrelated' } } });
  save(path.join(f.cwd, '.pi/settings.json'), { theme: 'dark', skills: ['-skills/user-disabled'], packages: [] });
  const skills = [{ skillKey: 'example', contentHash: computeSkillHash(dir) }];
  const pack = { id: 'one', name: 'One', description: '', skills, mcpServers: [], nativeMcpServers: ['shared'] };
  const config = { version: 2, libraryRoot: f.libraryRoot, packs: [pack, { ...pack, id: 'two', name: 'Two' }] };
  return { ...f, config };
}
const switchTo = (f, ids, deps) => applyWorkspacePackSwitch(f.cwd, f.libraryRoot, ids, readWorkspaceState({ cwd: f.cwd }).revision, f.config, deps);

test('native override and skill exclusion switch a mixed Pack without deleting resources', async (t) => {
  const f = setup(t), globalBefore = readFileSync(path.join(f.root, 'mcp.json'), 'utf8');
  await switchTo(f, ['one']);
  assert.equal((await loadNativeMcpConfig(f.cwd)).servers.find((s) => s.name === 'shared').config.enabled, true);
  await switchTo(f, []);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skills/example/SKILL.md')), true);
  assert.equal(read(path.join(f.cwd, '.pi/mcp.json')).mcpServers.shared.enabled, false);
  assert.deepEqual(read(path.join(f.cwd, '.pi/settings.json')).skills, ['-skills/user-disabled', '-skills/example']);
  await switchTo(f, ['one']);
  assert.deepEqual(read(path.join(f.cwd, '.pi/settings.json')).skills, ['-skills/user-disabled']);
  assert.equal(readFileSync(path.join(f.root, 'mcp.json'), 'utf8'), globalBefore);
});

test('native selector metadata never exposes commands, env or credentials', async (t) => {
  const f = setup(t), info = await nativeMcpServerInfo(f.cwd);
  assert.ok(info.servers.some((s) => s.serverKey === 'shared'));
  assert.doesNotMatch(JSON.stringify(info), /private-fixture|TOKEN|never-run/);
});

test('skill destinations cannot escape through a project symlink', async (t) => {
  const f = setup(t), outside = path.join(f.root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, path.join(f.cwd, '.pi/skills'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(switchTo(f, ['one']), /symlinks/);
  assert.equal(existsSync(path.join(outside, 'example')), false);
});

test('SDK resource loader removes disabled Pack skills and restores commands on enable', async (t) => {
  const f = setup(t);
  const { DefaultResourceLoader, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const settingsManager = SettingsManager.create(f.cwd, f.root); settingsManager.setProjectTrusted(true);
  const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.root, settingsManager, noExtensions: true });
  await switchTo(f, ['one']); await loader.reload();
  assert.ok(loader.getSkills().skills.some((skill) => skill.name === 'example'));
  await switchTo(f, []); await loader.reload();
  assert.equal(loader.getSkills().skills.some((skill) => skill.name === 'example'), false);
  await switchTo(f, ['one']); await loader.reload();
  assert.ok(loader.getSkills().skills.some((skill) => skill.name === 'example'));
});

test('shared resources remain enabled until the last enabled Pack is disabled', async (t) => {
  const f = setup(t); await switchTo(f, ['one', 'two']); await switchTo(f, ['two']);
  assert.equal(read(path.join(f.cwd, '.pi/mcp.json')).mcpServers.shared.enabled, true);
  assert.equal(read(path.join(f.cwd, '.pi/settings.json')).skills.includes('-skills/example'), false);
  await switchTo(f, []);
  assert.equal(read(path.join(f.cwd, '.pi/mcp.json')).mcpServers.shared.enabled, false);
});

test('native definitions, unrelated entries and user settings are preserved', async (t) => {
  const f = setup(t);
  save(path.join(f.cwd, '.pi/mcp.json'), { custom: 7, mcpServers: {
    shared: { command: 'project-owned', args: ['arg'], env: { TOKEN: 'project-private' }, enabled: false }, unrelated: { url: 'https://example.com/mcp' },
  } });
  await switchTo(f, ['one']); await switchTo(f, []);
  const mcp = read(path.join(f.cwd, '.pi/mcp.json'));
  assert.equal(mcp.custom, 7); assert.equal(mcp.mcpServers.shared.command, 'project-owned');
  assert.deepEqual(mcp.mcpServers.shared.env, { TOKEN: 'project-private' });
  assert.deepEqual(mcp.mcpServers.unrelated, { url: 'https://example.com/mcp' });
  assert.equal(read(path.join(f.cwd, '.pi/settings.json')).theme, 'dark');
});

test('unconfigured native references block mixed Packs before any skill copy', async (t) => {
  const f = setup(t); f.config.packs[0].nativeMcpServers = ['missing'];
  const preview = await previewWorkspacePackSwitch(f.cwd, f.libraryRoot, ['one'], f.config);
  assert.equal(preview.canApply, false);
  assert.equal(preview.mcp.blocked[0].reason, 'missing_native_server');
  await assert.rejects(switchTo(f, ['one']), /cannot be applied/);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skills/example')), false);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skill-packs.json')), false);
});

test('failed receipt write rolls back both overrides and newly copied Skills', async (t) => {
  const f = setup(t), files = ['mcp.json', 'settings.json'];
  const before = files.map((file) => readFileSync(path.join(f.cwd, '.pi', file), 'utf8'));
  await assert.rejects(switchTo(f, ['one'], { beforeStateWrite: () => { throw new Error('fixture failure'); } }), /fixture failure/);
  assert.deepEqual(files.map((file) => readFileSync(path.join(f.cwd, '.pi', file), 'utf8')), before);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skills/example')), false);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skill-packs.json')), false);
});

test('invalid project overrides cannot masquerade as enabled global references', async (t) => {
  const f = setup(t);
  save(path.join(f.cwd, '.pi/mcp.json'), { mcpServers: { shared: { unsupported: 1 } } });
  const plan = await previewWorkspacePackSwitch(f.cwd, f.libraryRoot, ['one'], f.config);
  assert.equal(plan.canApply, false); assert.equal(plan.mcp.blocked[0].reason, 'missing_native_server');
  await assert.rejects(switchTo(f, ['one']), /cannot be applied/);
});

test('rollback restores remaining files even when one file has a concurrent external edit', async (t) => {
  const f = setup(t); await switchTo(f, ['one']);
  const settings = readFileSync(path.join(f.cwd, '.pi/settings.json'), 'utf8');
  await assert.rejects(switchTo(f, [], { beforeStateWrite: () => {
    const file = path.join(f.cwd, '.pi/mcp.json'), value = read(file);
    value.external = true; save(file, value); throw new Error('fixture failure');
  } }), /rollback conflict/);
  assert.equal(readFileSync(path.join(f.cwd, '.pi/settings.json'), 'utf8'), settings);
  assert.equal(read(path.join(f.cwd, '.pi/mcp.json')).external, true);
  assert.equal(readWorkspaceState({ cwd: f.cwd }).revision, 1);
});

test('canonical aliases serialize switches and stale revisions reject without effects', async (t) => {
  const f = setup(t), alias = path.join(f.cwd, '..', path.basename(f.cwd));
  const results = await Promise.allSettled([
    applyWorkspacePackSwitch(f.cwd, f.libraryRoot, ['one'], 0, f.config),
    applyWorkspacePackSwitch(alias, f.libraryRoot, ['two'], 0, f.config),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /state changed/);
  const other = path.join(f.root, 'other'); mkdirSync(other);
  assert.deepEqual(readWorkspaceState({ cwd: other }).appliedPacks, []);
  assert.equal((await loadNativeMcpConfig(other)).servers.find((s) => s.name === 'shared').config.enabled, false);
});

test('untrusted workspaces are not silently trusted or allowed to enable project resources', async (t) => {
  const f = setup(t); save(path.join(f.root, 'settings.json'), { defaultProjectTrust: 'never' });
  const preview = await previewWorkspacePackSwitch(f.cwd, f.libraryRoot, ['one'], f.config);
  assert.equal(preview.canApply, false); assert.equal(preview.mcp.blocked[0].reason, 'untrusted_project');
  await assert.rejects(switchTo(f, ['one']), /cannot be applied/);
  assert.equal(existsSync(path.join(f.root, 'trust.json')), false);
});

test('legacy Library definitions and hashes are not imported or rewritten', async (t) => {
  const f = setup(t); f.config.packs[0].mcpServers = [{ serverKey: 'shared', configHash: 'old-hash' }];
  delete f.config.packs[0].nativeMcpServers;
  const file = path.join(f.libraryRoot, '.pi/mcp-servers/shared.mcp.json');
  save(file, { serverKey: 'shared', definition: { command: 'never-import' }, configHash: 'old-hash' });
  const before = readFileSync(file, 'utf8');
  await assert.rejects(switchTo(f, ['one']), /legacy Library MCP references/);
  assert.equal(existsSync(path.join(f.cwd, '.pi/skills/example')), false);
  // An explicit Pack edit binds an already configured native name, not that definition.
  f.config.packs[0].nativeMcpServers = ['shared']; await switchTo(f, ['one']);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(read(path.join(f.cwd, '.pi/mcp.json')).mcpServers.shared.command, undefined);
  assert.equal(f.config.packs[0].mcpServers[0].configHash, 'old-hash');
});

async function fakeSession(cwd) {
  const sessionManager = SessionManager.inMemory(cwd);
  const modelRuntime = await ModelRuntime.create({ modelsPath: path.join(process.env.PI_CODING_AGENT_DIR, 'models.json') });
  const inner = { sessionManager, modelRuntime,
    resourceLoader: { getExtensions: () => ({ extensions: [], errors: [], warnings: [] }) }, settingsManager: SettingsManager.create(cwd, process.env.PI_CODING_AGENT_DIR, { projectTrusted: true }), sessionId: sessionManager.getSessionId(), isStreaming: false, isCompacting: false,
    reloads: 0, agent: { state: {} }, bindExtensions: async () => {},
    extensionRunner: { getRegisteredCommands: () => [] }, subscribe: () => () => {}, dispose: () => {},
    getAllTools: () => [], getActiveToolNames: () => [], setActiveToolsByName: () => {},
    reload: async options => { await options?.beforeSessionStart?.(); inner.reloads++; },
  };
  return inner;
}

test('all idle sessions in one workspace reload; another workspace stays unchanged', async (t) => {
  const f = setup(t), other = path.join(f.root, 'other'); mkdirSync(other);
  const { initTheme } = await import('@earendil-works/pi-coding-agent'); initTheme();
  const inners = await Promise.all([fakeSession(f.cwd), fakeSession(f.cwd), fakeSession(other)]);
  const wrappers = inners.map((inner) => { const wrapper = new AgentSessionWrapper(inner); wrapper.start(); wrapper.beginExtensionBinding(); return wrapper; });
  t.after(async () => { await Promise.all(wrappers.map((wrapper) => wrapper.destroyAndWait())); });
  await switchTo(f, ['one']); notifyWorkspacePacks(f.cwd);
  await Promise.all(wrappers.map((wrapper) => wrapper.ensureWorkspacePacksReloaded()));
  assert.deepEqual(inners.map((inner) => inner.reloads), [1, 1, 0]);
  inners[0].isStreaming = true;
  await switchTo(f, []); notifyWorkspacePacks(f.cwd);
  await wrappers[1].ensureWorkspacePacksReloaded();
  assert.deepEqual(inners.map((inner) => inner.reloads), [1, 2, 0]);
  inners[0].isStreaming = false;
  await wrappers[0].send({ type: 'get_tools' });
  assert.equal(inners[0].reloads, 2);
  await wrappers[0].send({ type: 'reload_workspace_packs' });
  assert.equal(inners[0].reloads, 2, 'client revision refresh must not cause duplicate SDK reload');
});
