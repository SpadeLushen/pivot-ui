import assert from "node:assert/strict";
import test from "node:test";
import { withMcpBrowser, waitFor, delay, findChrome } from "../../lib/fixtures/mcp-browser.mjs";
const skip = process.env.PIVOT_TEST_BROWSER !== "1" && !await findChrome();
const browserTest = (name, run) => test(name, { skip, timeout: 30000 }, run);
const select = async (client, key) => {
  await client.evaluate(`Array.from(document.querySelectorAll(".tools-row")).find(b=>b.textContent.trim()===${JSON.stringify(key)}).click()`);
  await waitFor(() => client.evaluate(`document.querySelector(".tools-details h3")?.textContent===${JSON.stringify(key)}`));
  await delay(80);
};
const text = client => client.evaluate('document.querySelector(".tools-details").textContent');
browserTest("MCP grouping and override X preserve global definitions and Pack ownership", async () => {
  await withMcpBrowser(async client => {
    const groups = await client.evaluate(`Array.from(document.querySelectorAll(".tools-group")).map(h=>({label:h.textContent, rows:Array.from(h.parentElement.querySelectorAll(".tools-row")).map(r=>r.textContent.trim())}))`);
    assert.deepEqual(groups.find(g=>g.label==="Pack managed").rows, ["pack"]);
    assert.deepEqual(groups.find(g=>g.label==="Workspace override").rows, ["override"]);
    await select(client, "pack");
    assert.equal(await client.evaluate('!!document.querySelector(".tools-badge-remove")'), false);
    assert.equal(await client.evaluate('document.querySelector(".tools-details [role=switch]").disabled'), true);
    await select(client, "override");
    assert.equal(await client.evaluate('document.querySelector(".tools-badge-remove").parentElement.textContent.trim()'), "Workspace override");
    await client.evaluate('document.querySelector(".tools-badge-remove").click()');
    await waitFor(() => client.evaluate('!document.querySelector(".tools-badge-remove")'));
    const deletion = await client.evaluate('window.requests.find(r=>r.method==="DELETE")');
    assert.equal(deletion.body.scope, "project"); assert.equal(deletion.body.serverKey, "override");
    assert.equal(await client.evaluate('window.confirms.length'), 1);
  });
});
browserTest("resource failures and empty lists are silent; successful lists and templates are independent", async () => {
  await withMcpBrowser(async client => {
    for (const key of ["plain", "broken"]) {
      await select(client, key);
      assert.equal(await client.evaluate('!!document.querySelector(".tools-mcp-resources")'), false);
      assert.doesNotMatch(await text(client), /Failed to list|no resources|no resource templates/);
    }
    await select(client, "resources");
    assert.match(await text(client), /Guide/); assert.doesNotMatch(await text(client), /Resource Templates/);
    await select(client, "templates");
    assert.match(await text(client), /Resource Templates/); assert.doesNotMatch(await text(client), /Guide/);
    await select(client, "both");
    assert.match(await text(client), /Guide/); assert.match(await text(client), /Resource Templates/);
    await client.evaluate('Array.from(document.querySelectorAll(".tools-mcp-resources button")).find(b=>b.textContent==="Load more").click()');
    await waitFor(async () => (await text(client)).includes("Next guide"));
    assert.match(await text(client), /Guide/); assert.match(await text(client), /Resource Templates/);
    await select(client, "slow");
    await waitFor(() => client.evaluate('typeof window.resolveSlow === "function"'));
    await select(client, "plain"); await client.evaluate('window.resolveSlow()'); await delay(80);
    assert.doesNotMatch(await text(client), /STALE/);
  });
});
browserTest("Connection owns status, Refresh and authentication; expired credentials always offer reauthentication", async () => {
  await withMcpBrowser(async client => {
    await select(client, "explicit");
    assert.deepEqual(await client.evaluate('Array.from(document.querySelector(".tools-mcp-connection .tools-detail-heading").children).map(e=>e.textContent)'), ["Connection", "Connected", "Refresh", "Authenticate"]);
    await client.evaluate('document.querySelector(".tools-mcp-connection button:last-of-type").click()');
    await waitFor(() => client.evaluate('window.opened.length===1'));
    assert.equal(await client.evaluate('!!document.querySelector("dialog.tools-oauth-dialog")'), false);
    await client.evaluate('Array.from(document.querySelectorAll(".tools-mcp-connection button")).find(b=>b.textContent==="Cancel").click()');
    await select(client, "detected");
    assert.equal(await client.evaluate('document.querySelector(".tools-mcp-connection button:last-of-type").textContent'), "Authenticate");
    await select(client, "expired");
    assert.equal(await client.evaluate('document.querySelector(".tools-mcp-connection button:last-of-type").textContent'), "Reauthenticate");
  });
});
browserTest("remote browser host opens OAuth link and requires callback URL dialog", async () => {
  await withMcpBrowser(async (client, base) => {
    await client.send("Page.navigate", { url: base.replace("127.0.0.1", "remote.test") });
    await waitFor(() => client.evaluate('!!document.querySelector(".tools-row")'));
    await select(client, "explicit");
    await client.evaluate('document.querySelector(".tools-mcp-connection button:last-of-type").click()');
    await waitFor(() => client.evaluate('!!document.querySelector("dialog.tools-oauth-dialog[open]")'));
    assert.equal(await client.evaluate('document.querySelector("dialog textarea").disabled'), false);
    assert.equal(await client.evaluate('window.opened.length'), 1);
    await client.evaluate('document.querySelector("dialog button[type=button]").click()');
    await waitFor(() => client.evaluate('!document.querySelector("dialog.tools-oauth-dialog")'));
    assert.equal(await client.evaluate('window.requests.some(r=>r.body.action==="cancel")'), true);
  });
});
browserTest("Force OAuth hint is conditional and Sensitive fields hint follows headers Add only while masked", async () => {
  await withMcpBrowser(async client => {
    const edit = () => client.evaluate('Array.from(document.querySelectorAll(".tools-details button")).find(b=>b.getAttribute("aria-label")==="Edit MCP server").click()');
    const force = () => client.evaluate('Array.from(document.querySelectorAll("input")).find(i=>i.getAttribute("aria-label")==="Force OAuth").click()');
    await select(client, "plain"); await edit();
    await waitFor(() => client.evaluate('Array.from(document.querySelectorAll(".tools-editor-form input")).some(i=>i.getAttribute("aria-label")==="Force OAuth" && !i.disabled)'));
    const formText = () => client.evaluate('document.querySelector(".tools-editor-form").textContent');
    assert.doesNotMatch(await formText(), /Enable OAuth even|Sensitive fields/);
    await force(); assert.match(await formText(), /Enable OAuth even/);
    await force(); assert.doesNotMatch(await formText(), /Enable OAuth even/);
    await client.evaluate('Array.from(document.querySelectorAll(".tools-editor-actions button")).find(b=>b.textContent==="Cancel").click()');
    await select(client, "secret"); await edit();
    await waitFor(() => client.evaluate('!!document.querySelector(".tools-editor-form fieldset .tools-help")'));
    assert.equal(await client.evaluate('document.querySelector("fieldset .tools-help").previousElementSibling.textContent.trim()'), "Add");
    await client.evaluate(`const el=Array.from(document.querySelectorAll("input")).find(i=>i.getAttribute("aria-label")==="headers 1 Value"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"replacement");el.dispatchEvent(new Event("input",{bubbles:true}));`);
    await waitFor(() => client.evaluate('!document.querySelector("fieldset .tools-help")'));
  });
});
