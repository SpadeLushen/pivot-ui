import assert from "node:assert/strict";
import test from "node:test";
import { withMcpBrowser, waitFor, delay } from "../lib/fixtures/mcp-browser.mjs";
const browser = run => withMcpBrowser(run, { entry: "lib/fixtures/stage-c-ui.jsx", ready: "!!window.controls" });
test("C3 browser editor stages by scope, accepts zero, unbolds inheritance and retains failed drafts", { timeout: 30000 }, async () => {
  await browser(async c => {
    assert.equal(await c.evaluate('document.querySelectorAll(".tools-field-overridden").length'), 2);
    await c.evaluate('window.editor.editCodemode({mode:"on",budget:"3000"})');
    await waitFor(() => c.evaluate('document.querySelectorAll(".tools-field-overridden").length===0'));
    assert.equal(await c.evaluate('window.editor.canSave'), true);
    await c.evaluate('window.editor.changeTarget("global")');
    await waitFor(() => c.evaluate('window.editor.target==="global"'));
    assert.equal(await c.evaluate('window.editor.dirty'), false);
    await c.evaluate('window.editor.editCodemode({budget:"0"})');
    await waitFor(() => c.evaluate('window.editor.dirty'));
    assert.equal(await c.evaluate('window.editor.canSave'), true);
    assert.equal(await c.evaluate('window.requests.filter(r=>r.method==="PATCH").length'), 0);
    await c.evaluate('window.failSave=true; window.editor.save()');
    await waitFor(() => c.evaluate('window.editor.error==="conflict"'));
    const body = await c.evaluate('window.requests.find(r=>r.method==="PATCH").body');
    assert.equal(body.target, "global"); assert.equal(body.revision, "g1"); assert.equal(body.codemode.inlineBudget, 0);
    await c.evaluate('window.editor.changeTarget("workspace")');
    await waitFor(() => c.evaluate('window.editor.target==="workspace"'));
    assert.equal(await c.evaluate('window.editor.error'), null);
    assert.deepEqual(await c.evaluate('window.editor.draft.codemode'), { mode: "on", budget: "3000" });
  });
});

test("C4 browser snapshot races, failed refresh, branch and run changes never add spend twice", { timeout: 30000 }, async () => {
  await browser(async c => {
    await waitFor(() => c.evaluate('window.statistics?.sessionId==="a"'));
    await c.evaluate('window.deferStats=true; window.controls.setSid("b")');
    await waitFor(() => c.evaluate('window.pendingStats.length===1'));
    await c.evaluate('window.controls.setSid("c")');
    await waitFor(() => c.evaluate('window.pendingStats.length===2'));
    await c.evaluate('window.pendingStats[1]({sessionId:"c",cost:3});');
    await waitFor(() => c.evaluate('window.statistics?.cost===3'));
    await c.evaluate('window.pendingStats[0]({sessionId:"b",cost:99});');
    await delay(80); assert.equal(await c.evaluate('window.statistics.cost'), 3);
    await c.evaluate('window.deferStats=false; window.failStats=true; window.refreshStats()');
    await waitFor(() => c.evaluate('window.statistics?.statsUnavailable===true'));
    assert.equal(await c.evaluate('window.statistics.cost'), 3);
    await c.evaluate('window.failStats=false; window.statsData={sessionId:"c",cost:4}; window.dispatchEvent(new Event("online"))');
    await waitFor(() => c.evaluate('window.statistics?.cost===4'));
    await c.evaluate('window.controls.setLeaf("leaf");');
    await waitFor(() => c.evaluate('window.requests.some(r=>r.query.includes("leafId=leaf"))'));
    await c.evaluate('window.controls.setLeaf(null); window.controls.setLive(true)');
    await waitFor(() => c.evaluate('window.statistics?.cost===4'));
    await c.evaluate('window.statsData={sessionId:"c",cost:5}');
    await delay(500); await waitFor(() => c.evaluate('window.statistics?.cost===5'));
    await c.evaluate('window.statsData={sessionId:"c",cost:6}; window.controls.setLive(false); window.controls.setRun(2)');
    await waitFor(() => c.evaluate('window.statistics?.cost===6'));
    await c.evaluate('window.controls.setRevision(1)');
    await waitFor(() => c.evaluate('window.statistics?.cost===6'));
  });
});

test("C3 browser trust checks every opening; stale responses and opening never grant trust", { timeout: 30000 }, async () => {
  await browser(async c => {
    await waitFor(() => c.evaluate('window.trust.trusted===false'));
    assert.equal(await c.evaluate('window.requests.filter(r=>r.method==="POST").length'), 0);
    await c.evaluate('window.controls.setOpen(false)');
    await waitFor(() => c.evaluate('window.trust.trusted===null'));
    await c.evaluate('window.deferTrust=true; window.controls.setOpen(true)');
    await waitFor(() => c.evaluate('window.pendingTrust.length===1'));
    await c.evaluate('window.controls.setCwd("/fixture/b")');
    await waitFor(() => c.evaluate('window.pendingTrust.length===2'));
    await c.evaluate('window.pendingTrust[0](true)');
    await delay(80); assert.equal(await c.evaluate('window.trust.trusted'), null);
    await c.evaluate('window.deferTrust=false; window.pendingTrust[1](false)');
    await waitFor(() => c.evaluate('window.trust.trusted===false'));
    await c.evaluate('window.trust.grant()');
    await waitFor(() => c.evaluate('window.trust.trusted===true'));
    const post = await c.evaluate('window.requests.find(r=>r.method==="POST")');
    assert.deepEqual(post.body, { cwd: "/fixture/b", trusted: true });
    assert.equal(await c.evaluate('window.requests.filter(r=>r.path.includes("pack")&&r.method==="POST").length'), 0);
  });
});
test("C1/C2 browser codemode blocks lazily mount images; plain order and block reset remain intact", { timeout: 30000 }, async () => {
  await browser(async c => {
    assert.equal(await c.evaluate('document.querySelectorAll("#output img").length'), 0);
    assert.match(await c.evaluate('document.querySelector("#output").textContent'), /Script completed/);
    await c.evaluate('document.querySelectorAll("#output details")[1].open=true');
    await waitFor(() => c.evaluate('document.querySelectorAll("#output img").length===1'));
    await c.evaluate('document.querySelector("#output [aria-pressed=false]").click()');
    await waitFor(() => c.evaluate('document.querySelectorAll("#output details").length===0'));
    const text = await c.evaluate('document.querySelector("#output").textContent');
    assert.ok(text.indexOf("first") < text.indexOf("last"));
    await c.evaluate('document.querySelector("#output [aria-pressed=false]").click()');
    await waitFor(() => c.evaluate('document.querySelectorAll("#output img").length===0'));
    assert.equal(await c.evaluate('Array.from(document.querySelectorAll("#output details")).some(d=>d.open)'), false);
  });
});

test("C4 browser late branch and run snapshots cannot overwrite a new scope", { timeout: 30000 }, async () => {
  await browser(async c => {
    await waitFor(() => c.evaluate('window.statistics?.sessionId==="a"'));
    await c.evaluate('window.deferStats=true; window.controls.setLeaf("old")');
    await waitFor(() => c.evaluate('window.pendingStats.length===1'));
    await c.evaluate('window.controls.setLeaf("new")');
    await waitFor(() => c.evaluate('window.pendingStats.length===2'));
    await c.evaluate('window.pendingStats[1]({sessionId:"a",cost:20}); window.pendingStats[0]({sessionId:"a",cost:99})');
    await waitFor(() => c.evaluate('window.statistics?.cost===20'));
    await c.evaluate('window.controls.setRun(2)');
    await waitFor(() => c.evaluate('window.pendingStats.length===3'));
    assert.equal(await c.evaluate('window.statistics'), null, "old-run snapshot is not current");
    await c.evaluate('window.controls.setRun(3)');
    await waitFor(() => c.evaluate('window.pendingStats.length===4'));
    await c.evaluate('window.pendingStats[3]({sessionId:"a",cost:30}); window.pendingStats[2]({sessionId:"a",cost:100})');
    await waitFor(() => c.evaluate('window.statistics?.cost===30'));
  });
});


