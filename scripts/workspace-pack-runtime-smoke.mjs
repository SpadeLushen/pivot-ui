import assert from 'node:assert/strict';
const delay = (ms) => new Promise(r => setTimeout(r, ms));
export async function verifyWorkspacePackRuntime(base, headers, cwd, sessionId) {
  const command = async (id, body) => {
    const response = await fetch(base + '/api/agent/' + id, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const tools = async id => (await command(id, { type: 'get_tools' })).data;
  const echo = list => list.some(t => t.name === 'mcp__fixture__echo');
  const created = await fetch(base + '/api/agent/new', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, type: 'ensure_session' }) });
  assert.equal(created.status, 200, await created.clone().text());
  const second = (await created.json()).sessionId;
  for (let i = 0; i < 100 && !echo(await tools(second)); i++) await delay(100);
  assert.ok(echo(await tools(second)));
  await command(sessionId, { type: 'prompt', message: 'hold' });
  const state = await (await fetch(base + '/api/agent/' + sessionId, { headers })).json();
  assert.equal(Boolean(state.state.isStreaming || state.state.isPromptRunning), true);
  const switchTo = async ids => {
    const currentResponse = await fetch(base + '/api/workspace-skill-packs?cwd=' + encodeURIComponent(cwd), { headers });
    assert.equal(currentResponse.status, 200, await currentResponse.clone().text());
    const current = await currentResponse.json();
    assert.equal(typeof current.revision, 'number', JSON.stringify(current));
    const result = await fetch(base + '/api/workspace-skill-packs/apply', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, packIds: ids, workspaceRevision: current.revision }) });
    assert.equal(result.status, 200, await result.clone().text());
  };
  await switchTo([]);
  assert.ok(echo(await tools(sessionId)), 'busy session must keep its in-flight native loadout');
  assert.equal(echo(await tools(second)), false, 'idle same-cwd session must refresh immediately');
  for (let i = 0; i < 100 && echo(await tools(sessionId)); i++) await delay(100);
  assert.equal(echo(await tools(sessionId)), false, 'busy session must refresh after finishing');
  await switchTo(['native-workspace']);
  for (let i = 0; i < 100 && !echo(await tools(sessionId)); i++) await delay(100);
  assert.ok(echo(await tools(sessionId)));
}
