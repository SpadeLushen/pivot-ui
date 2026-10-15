import assert from "node:assert/strict";
import test from "node:test";
import { withMcpBrowser, waitFor, delay } from "../lib/fixtures/mcp-browser.mjs";
const browser = run => withMcpBrowser(run, { entry: "lib/fixtures/pi-120-model-refresh-ui.jsx", ready: "!!window.refreshApi" });

test("real refresh hook deduplicates requests, passes automatic/cwd and updates the catalog", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("window.first=window.refreshApi.refresh(false); window.second=window.refreshApi.refresh(false); void 0");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===1 && window.refreshApi.refreshing"));
    assert.equal(await c.evaluate("window.first===window.second"), true);
    assert.deepEqual(await c.evaluate("window.pendingRefresh[0].body"), { provider: "a", cwd: "/fixture/a", automatic: true });
    await c.evaluate('window.catalogValues.a="new-a"; window.pendingRefresh[0].finish({ok:true})');
    await waitFor(() => c.evaluate('!window.refreshApi.refreshing && document.querySelector("#catalog").textContent==="new-a"'));
    assert.equal(await c.evaluate("window.reloads"), 1);
    assert.equal(await c.evaluate("window.refreshApi.refreshError"), null);
    const text = await c.evaluate("document.body.textContent");
    assert.match(text, /catalog refreshed/); assert.match(text, /does not verify access/);
    await c.evaluate("document.querySelector('button').click()");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===2"));
    assert.equal(await c.evaluate("window.pendingRefresh[1].body.automatic"), false);
    await c.evaluate("window.pendingRefresh[1].finish({ok:true})");
  });
});

test("browser refresh failures preserve cached content, sanitize errors and release busy state", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("void window.beginRefresh(true)");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===1"));
    await c.evaluate('window.resultStatus={state:"failed"}; window.pendingRefresh[0].finish({ok:false,status:502,error:"secret-provider-error"})');
    await waitFor(() => c.evaluate("window.refreshResult===false && !window.refreshApi.refreshing"));
    assert.equal(await c.evaluate("window.refreshApi.refreshError"), "models.refreshFailed");
    assert.equal(await c.evaluate('document.querySelector("#catalog").textContent'), "cached-a");
    const text = await c.evaluate("document.body.textContent");
    assert.match(text, /may be out of date/); assert.doesNotMatch(text, /secret-provider-error|catalog refreshed/);
    await c.evaluate("window.snapshotFailure=true; void window.beginRefresh(true)");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===2"));
    await c.evaluate("window.pendingRefresh[1].finish({ok:true})");
    await waitFor(() => c.evaluate("window.refreshResult===false && !window.refreshApi.refreshing"));
    assert.equal(await c.evaluate('document.querySelector("#catalog").textContent'), "cached-a");
    assert.doesNotMatch(await c.evaluate("document.body.textContent"), /private-snapshot-error/);
  });
});

test("switching provider cancels the old browser request; a late result cannot overwrite the new list", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("void window.beginRefresh(true)");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===1"));
    await c.evaluate('window.setProvider("b")');
    await waitFor(() => c.evaluate('window.refreshApi.provider==="b" && !window.refreshApi.refreshing'));
    assert.equal(await c.evaluate("window.pendingRefresh[0].signal.aborted"), true);
    await c.evaluate("void window.beginRefresh(true)");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===2"));
    await c.evaluate('window.catalogValues.b="new-b"; window.pendingRefresh[1].finish({ok:true})');
    await waitFor(() => c.evaluate('document.querySelector("#catalog").textContent==="new-b"'));
    await c.evaluate('window.catalogValues.a="late-a"; window.pendingRefresh[0].finish({ok:true})');
    await delay(80);
    assert.equal(await c.evaluate('document.querySelector("#catalog").textContent'), "new-b");
    assert.equal(await c.evaluate("window.reloads"), 1);
    assert.equal(await c.evaluate("window.refreshApi.refreshError"), null);
  });
});

test("unmount cancels refresh and ignores late failure without reloading a snapshot", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("void window.beginRefresh(true)");
    await waitFor(() => c.evaluate("window.pendingRefresh.length===1"));
    await c.evaluate("window.unmountRefresh()");
    await waitFor(() => c.evaluate("window.pendingRefresh[0].signal.aborted"));
    await c.evaluate('window.pendingRefresh[0].finish({ok:false,status:500,error:"models.refreshFailed"})');
    await delay(80); assert.equal(await c.evaluate("window.reloads"), 0);
    assert.equal(await c.evaluate("document.body.textContent"), "unmounted");
  });
});

test("Web cursor rendering and copied DOM text contain no terminal payload and retain emoji", { timeout: 30000 }, async () => {
  await browser(async c => {
    assert.equal(await c.evaluate('document.querySelector("#cursor").textContent'), "前🙂后");
    assert.equal(await c.evaluate('getComputedStyle(Array.from(document.querySelectorAll("#cursor span")).find(s=>s.textContent==="🙂")).backgroundColor'), "rgb(255, 255, 255)");
    const copied = await c.evaluate('(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector("#cursor"));return r.toString()})()');
    assert.equal(copied, "前🙂后"); assert.doesNotMatch(copied, /pi:|\x1b|\x07/);
  });
});
