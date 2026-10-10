import assert from "node:assert/strict";
import test from "node:test";
import { withMcpBrowser, waitFor, delay } from "../lib/fixtures/mcp-browser.mjs";
test("D1 browser fast SSE settlement cannot be resurrected by a late started receipt", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("window.send()"); await waitFor(() => c.evaluate("window.pending.length===1"));
    await c.evaluate('window.emit({type:"agent_start"})');
    await waitFor(() => c.evaluate("window.chat.agentRunning"));
    await c.evaluate('window.emit({type:"agent_end"})');
    await delay(50); assert.equal(await c.evaluate("window.chat.agentRunning"), true);
    assert.equal(await c.evaluate("window.ends"), 0);
    await c.evaluate('window.emit({type:"agent_settled",aborted:false})');
    await waitFor(() => c.evaluate("!window.chat.agentRunning"));
    assert.equal(await c.evaluate("window.ends"), 1);
    await c.evaluate('window.pending.shift()({success:true,data:{disposition:"started"}})');
    await waitFor(() => c.evaluate("window.sendResult===true"));
    assert.equal(await c.evaluate("window.chat.agentRunning"), false);
    assert.equal(await c.evaluate("window.ends"), 1);
  });
});
test("D1 browser cancelled runs do not notify; late HTTP cannot contaminate another session", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("window.send()"); await waitFor(() => c.evaluate("window.pending.length===1"));
    await c.evaluate('window.emit({type:"agent_start"}); window.emit({type:"agent_settled",aborted:true})');
    await waitFor(() => c.evaluate("!window.chat.agentRunning"));
    assert.equal(await c.evaluate("window.ends"), 0);
    await c.evaluate('window.setSid("b")');
    await waitFor(() => c.evaluate('window.chat.sessionIdRef.current==="b" && !window.chat.loading'));
    await c.evaluate('window.pending.shift()({success:true,data:{disposition:"started"}})');
    await delay(100);
    assert.equal(await c.evaluate("window.chat.agentRunning"), false);
    assert.equal(await c.evaluate("window.chat.messages.length"), 0);
  });
});
test("D1/D3 browser trusts delivered text and actual successful model, never overwrites router selection", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("window.send()"); await waitFor(() => c.evaluate("window.pending.length===1"));
    await c.evaluate('window.busy=true; window.emit({type:"agent_start"}); window.emit({type:"message_end",message:{role:"user",content:"transformed",timestamp:1}})');
    await waitFor(() => c.evaluate("window.chat.messages.length===1"));
    assert.equal(await c.evaluate("window.chat.messages[0].content"), "transformed");
    for (const model of ["a", "b"]) {
      await c.evaluate(`window.emit({type:"message_end",message:{role:"assistant",provider:"physical",model:${JSON.stringify(model)},api:"fixture",stopReason:"stop",content:[],timestamp:2}})`);
      await waitFor(() => c.evaluate(`window.chat.routedModel?.modelId===${JSON.stringify(model)}`));
    }
    await c.evaluate('window.emit({type:"message_end",message:{role:"assistant",provider:"physical",model:"failed",api:"fixture",stopReason:"error",content:[],timestamp:3}})');
    await delay(50); assert.equal(await c.evaluate("window.chat.routedModel.modelId"), "b");
    assert.equal(await c.evaluate("window.chat.currentModel.modelId"), "auto");
    await c.evaluate('window.pending.shift()({success:true,data:null})');
    await waitFor(() => c.evaluate("window.sendResult===true"));
    assert.equal(await c.evaluate("window.chat.agentRunning"), true);
  });
});
const browser = run => withMcpBrowser(run, { entry: "lib/fixtures/stage-d-chat-ui.jsx", ready: "!!window.chat && !window.chat.loading" });
test("D1 browser sending is not running; handled/rejected inputs create no ghost messages or audio", { timeout: 30000 }, async () => {
  await browser(async c => {
    await c.evaluate("window.send()");
    await waitFor(() => c.evaluate("window.pending.length===1"));
    assert.equal(await c.evaluate("window.chat.inputSending"), true);
    assert.equal(await c.evaluate("window.chat.agentRunning"), false);
    assert.equal(await c.evaluate("window.chat.messages.length"), 0);
    await c.evaluate('window.pending.shift()({success:true,data:{disposition:"handled"}})');
    await waitFor(() => c.evaluate("window.sendResult===true && !window.chat.inputSending"));
    assert.equal(await c.evaluate("window.ends"), 0);
    await c.evaluate("window.send()"); await waitFor(() => c.evaluate("window.pending.length===1"));
    await c.evaluate('window.pending.shift()({error:"fixture input rejected"})');
    await waitFor(() => c.evaluate("window.sendResult===false"));
    assert.equal(await c.evaluate("window.chat.messages.length"), 0);
    assert.equal(await c.evaluate("window.chat.notices.at(-1).message"), "fixture input rejected");
    assert.equal(await c.evaluate("window.ends"), 0);
  });
});
