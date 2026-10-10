import assert from 'node:assert/strict';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(100); }
  assert.fail('Workspace Pack switch browser timeout');
}
export async function verifyWorkspacePackSwitches(client, cwd) {
  await client.evaluate(`(() => {
    window.__packRequests = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      window.__packRequests.push({ url: String(args[0]), status: response.status, body: args[1]?.body });
      return response;
    };
    localStorage.setItem('pi-last-session-packs', '["legacy-mixed"]');
  })()`);
  const button = 'Array.from(document.querySelectorAll("button[title]")).find(b => b.title === "Workspace Packs")';
  await waitFor(() => client.evaluate(`!!(${button})`));
  await client.evaluate(`(${button}).click()`);
  const selector = 'Array.from(document.querySelectorAll("[role=group] label")).find(l => l.textContent.includes("Native workspace fixture"))?.querySelector("input")';
  await waitFor(() => client.evaluate(`!!(${selector}) && !(${selector}).disabled`));
  await client.evaluate(`(${selector}).click()`);
  await waitFor(() => client.evaluate(`(${selector})?.checked && !(${selector}).disabled`));
  const state = async () => client.evaluate(`fetch('/api/workspace-skill-packs?cwd=' + encodeURIComponent(${JSON.stringify(cwd)})).then(r => r.json())`);
  await waitFor(async () => (await state()).appliedPacks.some(p => p.packId === 'native-workspace'));
  assert.equal(await client.evaluate(`(${button}).textContent.trim()`), '1');
  await client.evaluate(`(${selector}).click()`);
  await waitFor(async () => (await state()).appliedPacks.length === 0);
  await waitFor(() => client.evaluate(`!(${selector}).checked && !(${selector}).disabled`));
  assert.ok((await state()).disabledPacks.some(p => p.packId === 'native-workspace'));
  assert.equal(await client.evaluate(`(${button}).textContent.trim()`), '0');
  await client.evaluate(`(${selector}).click()`);
  await waitFor(async () => (await state()).appliedPacks.some(p => p.packId === 'native-workspace'));
  await waitFor(() => client.evaluate(`!(${selector}).disabled`));
  await client.evaluate(`(${button}).click()`);
  // New cwd starts empty, regardless of the untouched legacy localStorage value.
  await client.evaluate('window.__packRequests = []; Array.from(document.querySelectorAll("button[aria-label]")).find(b => b.getAttribute("aria-label") === "New workspace").click()');
  await waitFor(() => client.evaluate('Array.from(document.querySelectorAll("button.sidebar-workspace-menu-item")).some(b => b.textContent.includes("Use default directory"))'));
  await client.evaluate('Array.from(document.querySelectorAll("button.sidebar-workspace-menu-item")).find(b => b.textContent.includes("Use default directory")).click()');
  await waitFor(() => client.evaluate('window.__packRequests.some(r => r.url.includes("/api/workspace-skill-packs?"))'));
  assert.equal(await client.evaluate('document.body.textContent.includes("Failed to prepare workspace Packs")'), false);
  // The first prompt must not depend on Pack preparation.
  await client.evaluate('document.querySelector("textarea").focus()');
  await client.send('Input.insertText', { text: 'Workspace Pack browser fixture' });
  await waitFor(() => client.evaluate('!document.querySelector(".chat-send-button").disabled'));
  await client.evaluate('document.querySelector(".chat-send-button").click()');
  await waitFor(() => client.evaluate('window.__packRequests.some(r => r.url === "/api/agent/new" && r.status === 200) && window.__packRequests.some(r => /\\/api\\/agent\\/[^/]+$/.test(r.url) && r.status === 200 && JSON.parse(r.body || "{}").type === "prompt")'));
  assert.equal(await client.evaluate('window.__packRequests.some(r => r.url.endsWith("/workspace-skill-packs/apply"))'), false);
  assert.equal(await client.evaluate('localStorage.getItem("pi-last-session-packs")'), '["legacy-mixed"]');
  assert.equal(await client.evaluate('document.body.textContent.includes("Skipped 1 whole Packs")'), false);
}
