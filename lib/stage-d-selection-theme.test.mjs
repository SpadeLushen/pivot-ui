import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { VIRTUAL_MODEL_STATE_ENTRY } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { branchModelSelection } = await jiti.import("./session-models.ts");
const { successfulResponseModel, knownModelLimit } = await jiti.import("./response-model.ts");
const { PlainTextTheme } = await jiti.import("./plain-text-theme.ts");
const { aggregateSessionUsage } = await jiti.import("./session-usage.ts");
test("D3 actual-model costs include classifier usage once and leave aggregate parent spend unallocated", () => {
  const usage = cost => ({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: cost } });
  const total = aggregateSessionUsage([
    { type: "message", id: "a", message: { ...reply("a"), usage: usage(1) } },
    { type: "message", id: "b", message: { ...reply("b"), usage: usage(2) } },
    { type: "usage", id: "classifier", provider: "classifier", model: "decision", usage: usage(0.5) },
    { type: "message", id: "parent", message: { role: "toolResult", usage: usage(3),
      nestedCalls: { calls: [{ usage: usage(99) }] } } },
  ]);
  assert.equal(total.cost, 6.5);
  assert.deepEqual(total.models.map(m => [m.provider, m.model, m.cost]), [
    ["classifier", "decision", 0.5], ["physical", "a", 1], ["physical", "b", 2], [null, null, 3]
  ]);
});
const reply = (model, stopReason = "stop") => ({ role: "assistant", provider: "physical", model,
  api: "fixture", thinkingLevel: "high", stopReason, content: [] });
const entries = [
  { id: "select", parentId: null, type: "model_change", provider: "router", modelId: "auto" },
  { id: "state", parentId: "select", type: "custom", customType: VIRTUAL_MODEL_STATE_ENTRY,
    data: { provider: "router", modelId: "auto" } },
  { id: "a", parentId: "state", type: "message", message: reply("a") },
  { id: "compact", parentId: "a", type: "compaction", summary: "old context", firstKeptEntryId: "a" },
  { id: "b", parentId: "compact", type: "message", message: reply("b") },
  { id: "fail", parentId: "b", type: "message", message: reply("c", "error") },
  { id: "abort", parentId: "b", type: "message", message: reply("d", "aborted") },
];
test("D3 selected router survives compaction, branches, errors and cancellation", () => {
  for (const leaf of ["b", "fail", "abort"]) {
    const result = branchModelSelection(entries, leaf);
    assert.deepEqual(result.selectedModel, { provider: "router", modelId: "auto", virtual: true });
    assert.equal(result.routedModel.modelId, "b");
  }
  assert.equal(branchModelSelection(entries, "a").routedModel.modelId, "a");
  assert.equal(branchModelSelection(entries, null).selectedModel, null);
});
test("D3 successful actual response and unknown capacity never invent a routed model or limit", () => {
  for (const message of [reply("a", "error"), reply("a", "aborted"), { ...reply("a"), api: "pi-virtual" },
    { role: "user", content: "x" }]) assert.equal(successfulResponseModel(message), null);
  assert.equal(successfulResponseModel(reply("a")).thinkingLevel, "high");
  for (const value of [0, -1, NaN, Infinity, undefined, null, "100"]) assert.equal(knownModelLimit(value), null);
  assert.equal(knownModelLimit(100), 100);
});
test("D5a every theme token has usable color math and formatting remains ANSI-free", () => {
  const theme = new PlainTextTheme(), text = "插件 fixture";
  assert.equal(theme.appearance, "dark"); assert.equal(theme.getColorMode(), "truecolor");
  for (const name of ["bold", "italic", "underline", "inverse", "strikethrough"]) assert.equal(theme[name](text), text);
  assert.equal(theme.style(text, { fg: "accent", bg: "selectedBg", bold: true }), text);
  assert.equal(theme.getFgAnsi("accent"), ""); assert.equal(theme.getBgAnsi("selectedBg"), "");
  assert.equal(theme.getThinkingBorderColor("high")(text), text);
  assert.equal(theme.getBashModeBorderColor()(text), text);
  for (const token of Object.keys(theme.colors)) {
    assert.ok(theme.colors[token]);
    assert.equal(theme.fg(token, text), text); assert.equal(theme.bg(token, text), text);
  }
});
test("D5a independently constructed/reloaded bridges cannot mutate another session palette", () => {
  const a = new PlainTextTheme(), b = new PlainTextTheme(), c = new PlainTextTheme();
  assert.notEqual(a.colors, b.colors); assert.deepEqual(a.colors, c.colors);
  const before = b.colors.accent;
  assert.throws(() => { a.colors.accent = "#000000"; }, TypeError);
  assert.deepEqual(b.colors.accent, before); assert.deepEqual(c.colors.accent, before);
});
