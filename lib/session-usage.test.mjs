import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager, AgentSession } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { aggregateSessionUsage, recordedCost } = await jiti.import("./session-usage.ts");
const { sessionStatistics } = await jiti.import("./session-statistics.ts");
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const usage = (cost = 1) => ({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1,
  totalTokens: 18, reasoning: 3, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
const assistant = u => ({ role: "assistant", content: [{ type: "text", text: "reply" }],
  api: "test", model: "local", provider: "local", usage: u, timestamp: 1, stopReason: "stop" });
function ledger() {
  const sm = SessionManager.inMemory();
  sm.appendMessage({ role: "user", content: "start", timestamp: 1 });
  const a = sm.appendMessage(assistant(usage()));
  sm.appendMessage({ role: "toolResult", toolCallId: "parent", content: [], isError: false,
    usage: usage(2), nestedCalls: { complete: true, calls: [{ id: "parent/1", name: "model", status: "ok", usage: usage(9) }] } });
  sm.appendUsage("warm", "local", "local", usage(3));
  sm.appendCompaction("summary", a, 99, undefined, false, usage(4));
  const leaf = sm.getLeafId();
  sm.branch(a); sm.appendMessage(assistant(usage(5)));
  return { sm, leaf };
}

test("all entry categories count once; reasoning and nested usage do not add spend", () => {
  const { sm } = ledger(), total = aggregateSessionUsage(sm.getEntries());
  assert.equal(total.tokens.total, 90); assert.equal(total.tokens.output, 25);
  assert.equal(total.records, 5); assert.equal(total.cost, 15);
  assert.equal(total.categories.chat.cost, 6); assert.equal(total.categories.tools.cost, 2);
  assert.equal(total.categories.other.cost, 7);
  assert.deepEqual(aggregateSessionUsage([...sm.getEntries(), ...sm.getEntries()]), total);
});
test("branch ancestors retain pre-compaction spend; full session includes sibling branches", () => {
  const { sm, leaf } = ledger(), stats = sessionStatistics(sm, undefined, leaf);
  assert.equal(stats.accounting.branch.tokens.total, 72);
  assert.equal(stats.accounting.branch.cost, 10); assert.equal(stats.tokens.total, 90);
  assert.equal(stats.accounting.source, "history");
  assert.ok(buildSessionContext(sm.getEntries(), leaf).messages.length < sm.getBranch(leaf).length);
  assert.throws(() => sessionStatistics(sm, undefined, "absent"), /leaf not found/);
});
test("SDK complete-session totals match the read-only ledger, including branch summaries", () => {
  const { sm } = ledger();
  sm.branchWithSummary(sm.getLeafId(), "branch summary", undefined, false, usage(6));
  const sdk = { sessionManager: sm, getContextUsage: () => ({ tokens: 12, contextWindow: 100, percent: 12 }) };
  sdk.getSessionStats = () => AgentSession.prototype.getSessionStats.call(sdk);
  const history = sessionStatistics(sm), live = sessionStatistics(sm, sdk);
  assert.deepEqual(live.tokens, history.tokens); assert.equal(live.cost, history.cost);
  assert.equal(live.accounting.source, "sdk"); assert.equal(live.contextUsage.tokens, 12);
});

test("missing model cost is not recorded zero; ordinary tools need not have usage", () => {
  const entries = [{ id: "a", type: "message", message: assistant({ input: 10 }) },
    { id: "b", type: "message", message: assistant(usage(0)) },
    { id: "t", type: "message", message: { role: "toolResult", content: [] } }];
  const sum = aggregateSessionUsage(entries);
  assert.equal(sum.cost, 0); assert.equal(sum.costRecords, 1); assert.equal(sum.missingCostRecords, 1);
  assert.equal(sum.categories.tools.records, 0);
  assert.equal(recordedCost({}), null); assert.equal(recordedCost(usage(0)), 0);
  assert.equal(recordedCost({ cost: { total: NaN } }), null);
});
test("failed and cancelled recorded responses retain spend", () => {
  for (const stopReason of ["error", "aborted"]) {
    const sum = aggregateSessionUsage([{ type: "message", message: { ...assistant(usage(0.2)), stopReason } }]);
    assert.equal(sum.cost, 0.2); assert.equal(sum.tokens.total, 18);
  }
});
test("malformed legacy SDK totals fall back to partial history without repricing", () => {
  const sm = SessionManager.inMemory(); sm.appendMessage(assistant({ input: 10 }));
  const live = { getSessionStats: () => { throw new TypeError("legacy usage"); }, getContextUsage: () => undefined };
  const stats = sessionStatistics(sm, live);
  assert.equal(stats.accounting.source, "history"); assert.equal(stats.accounting.full.missingCostRecords, 1);
  assert.equal(stats.tokens.input, 10); assert.equal(stats.cost, 0);
});
test("history projection preserves tool usage while deferring images", () => {
  const sm = SessionManager.inMemory(); sm.appendMessage({ role: "toolResult", toolCallId: "t",
    usage: usage(0.4), timestamp: 1, content: [{ type: "image", data: "aA==", mimeType: "image/png" }] });
  const projected = buildSessionContext(sm.getEntries(), sm.getLeafId(), { deferToolResultImages: true });
  assert.equal(projected.messages[0].usage.cost.total, 0.4);
  assert.equal(projected.messages[0].deferredImages.images.length, 1);
});

