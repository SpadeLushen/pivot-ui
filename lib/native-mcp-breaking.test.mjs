import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync, symlinkSync } from 'node:fs';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const servers = await jiti.import('../app/api/mcp/servers/route.ts');
const library = await jiti.import('../app/api/skill-library/mcp-servers/route.ts');
const entry = await jiti.import('../app/api/skill-library/mcp-servers/[serverKey]/route.ts');
const apply = await jiti.import('../app/api/workspace-skill-packs/apply/route.ts');
const workspace = await jiti.import('../app/api/workspace-skill-packs/route.ts');
const { computeSkillHash } = await jiti.import('./content-hash.ts');
const { createLibraryMcpServer } = await jiti.import('./mcp-library.ts');
const { applyWorkspacePackChange } = await jiti.import('./skill-pack-apply.ts');
const { allowFileRoot } = await jiti.import('./allowed-roots.ts');
const { requirePackWorkspace } = await jiti.import('./workspace-pack-access.ts');
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); };

for (const phase of ['absent', 'pending', 'succeeded']) test(`retired adapter writes are rejected independently of ${phase} markers`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'pivot-native-breaking-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true });
  });
  const config = path.join(root, 'mcp.json');
  await save(config, { mcpServers: { example: { command: 'user-owned', enabled: false } } });
  if (phase !== 'absent') await save(path.join(root, 'pivot-mcp-migration.json'), { phase, generation: 'native-v1' });
  const before = await readFile(config, 'utf8');
  for (const handler of [library.POST, entry.PATCH, entry.DELETE]) {
    const response = await handler();
    assert.equal(response.status, 501);
    assert.equal((await response.json()).code, 'NATIVE_MCP_CONFIGURATION_UNAVAILABLE');
  }
  const native = await servers.GET(new Request('http://localhost/api/mcp/servers?scope=global'));
  assert.equal(native.status, 200, 'native editor remains available regardless of retired migration markers');
  assert.equal((await native.json()).servers[0].serverKey, 'example');
  assert.equal(await readFile(config, 'utf8'), before);
});

async function packFixture(t, phase) {
  const root = await mkdtemp(path.join(tmpdir(), 'pivot-native-pack-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true });
  });
  if (phase !== 'absent') await save(path.join(root, 'pivot-mcp-migration.json'), { phase });
  const cwd = path.join(root, 'project'), libraryRoot = path.join(root, 'library');
  await save(path.join(root, 'settings.json'), { defaultProjectTrust: 'always' });
  allowFileRoot(cwd);
  const skill = path.join(libraryRoot, '.pi/skills/example');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: example\ndescription: fixture\n---\nfixture');
  const skills = [{ skillKey: 'example', contentHash: computeSkillHash(skill) }];
  const server = createLibraryMcpServer(libraryRoot, 'example', { name: 'Example', definition: { command: 'never-execute-fixture' } });
  const mcpServers = [{ serverKey: server.serverKey, configHash: server.configHash }];
  const config = { version: 2, libraryRoot, packs: [
    { id: 'skills', name: 'Skills', description: '', skills, mcpServers: [] },
    { id: 'mixed', name: 'Mixed', description: '', skills, mcpServers },
  ] };
  await save(path.join(root, 'skill-packs.json'), config);
  await save(path.join(cwd, '.pi/mcp.json'), { servers: { native: { command: 'user-owned-native' } } });
  return { root, cwd, libraryRoot, config };
}

const applyRequest = (cwd, packIds) => new Request('http://localhost/api/workspace-skill-packs/apply', {
  method: 'POST', body: JSON.stringify({ cwd, packIds, workspaceRevision: 0 }),
});

for (const phase of ['absent', 'pending', 'succeeded']) test(`skill-only apply works; mixed apply is atomic and rejected (${phase})`, async (t) => {
  const { root, cwd } = await packFixture(t, phase);
  const configFile = path.join(root, 'skill-packs.json'), mcpFile = path.join(cwd, '.pi/mcp.json');
  const before = await readFile(mcpFile, 'utf8'), configBefore = await readFile(configFile, 'utf8');
  const rejected = await apply.POST(applyRequest(cwd, ['mixed']));
  assert.equal(rejected.status, 501, await rejected.clone().text());
  assert.equal((await rejected.json()).code, 'NATIVE_MCP_CONFIGURATION_UNAVAILABLE');
  assert.equal(existsSync(path.join(cwd, '.pi/skills/example/SKILL.md')), false);
  assert.equal(existsSync(path.join(cwd, '.pi/skill-packs.json')), false);
  const accepted = await apply.POST(applyRequest(cwd, ['skills']));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal(existsSync(path.join(cwd, '.pi/skills/example/SKILL.md')), true);
  assert.equal(await readFile(mcpFile, 'utf8'), before);
  assert.equal(await readFile(configFile, 'utf8'), configBefore);
});

test('removing a historical mixed Pack stays blocked without changing skills or MCP ownership', async (t) => {
  const { cwd, libraryRoot, config } = await packFixture(t, 'succeeded');
  // Build a historical receipt in an isolated fixture, not through the retired API.
  await applyWorkspacePackChange(cwd, libraryRoot, ['mixed'], 0, config);
  const files = ['.pi/skill-packs.json', '.pi/mcp.json', '.pi/skills/example/SKILL.md'];
  const before = await Promise.all(files.map((file) => readFile(path.join(cwd, file), 'utf8')));
  const rejected = await workspace.DELETE(new Request('http://localhost/api/workspace-skill-packs?' + new URLSearchParams({
    cwd, packId: 'mixed', workspaceRevision: '1',
  })));
  assert.equal(rejected.status, 501);
  assert.equal((await rejected.json()).code, 'NATIVE_MCP_CONFIGURATION_UNAVAILABLE');
  assert.deepEqual(await Promise.all(files.map((file) => readFile(path.join(cwd, file), 'utf8'))), before);
});

test('HTTP target-set API enables native references, rejects stale revisions and accepts all-off', async (t) => {
  const { root, cwd, config } = await packFixture(t, 'absent');
  config.packs.push({ ...config.packs[0], id: 'native', nativeMcpServers: ['configured'] });
  await save(path.join(root, 'skill-packs.json'), config);
  await save(path.join(root, 'mcp.json'), { mcpServers: { configured: { command: 'never-spawn', enabled: false } } });
  assert.equal((await apply.POST(applyRequest(cwd, ['native']))).status, 200);
  assert.equal((await apply.POST(applyRequest(cwd, []))).status, 409);
  const disabled = await apply.POST(new Request('http://localhost/api/workspace-skill-packs/apply', {
    method: 'POST', body: JSON.stringify({ cwd, packIds: [], workspaceRevision: 1 }),
  }));
  assert.equal(disabled.status, 200, await disabled.clone().text());
  assert.equal(existsSync(path.join(cwd, '.pi/skills/example/SKILL.md')), true);
  assert.equal(JSON.parse(await readFile(path.join(cwd, '.pi/mcp.json'), 'utf8')).mcpServers.configured.enabled, false);
});

test('forbidden roots return 403; an explicitly allowed root alias resolves to the actual cwd', async (t) => {
  const { root } = await packFixture(t, 'absent');
  const target = path.join(root, 'separate'), alias = path.join(root, 'alias'); await mkdir(target);
  const denied = await workspace.GET(new Request('http://localhost/api/workspace-skill-packs?cwd=' + encodeURIComponent(target)));
  assert.equal(denied.status, 403);
  symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir'); allowFileRoot(alias);
  assert.equal(await requirePackWorkspace(alias), target);
});
