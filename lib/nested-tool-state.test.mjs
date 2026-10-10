import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { NestedToolState, historicalNestedGroup, nestedTreeRows } = await createJiti(import.meta.url).import("./nested-tool-state.ts");
function fixture() {
  const state = new NestedToolState(); state.begin("session", 1); state.register("parent");
  const event = (type, id = "parent/1", extra = {}) => state.observe({ type, toolCallId: id,
    parentToolCallId: id.slice(0, id.lastIndexOf("/")), toolName: "read", ...extra }, "session", 1);
  return { state, event, group: () => state.snapshot().get("parent") };
}
test("parallel roots and nested hierarchy retain observed order without leaking to transcript", () => {
  const f = fixture(); f.state.register("other");
  f.event("tool_execution_start"); f.event("tool_execution_start", "parent/1/1");
  f.event("tool_execution_start", "other/1");
  const rows = nestedTreeRows("parent", f.group().calls, new Set(["parent/1"]));
  assert.deepEqual(rows.map(row => [row.node.id, row.depth]), [["parent/1", 0], ["parent/1/1", 1]]);
  assert.equal(f.state.snapshot().get("other").calls.length, 1);
});
test("end-before-start, replay, wrong session/run and unknown roots cannot resurrect state", () => {
  const f = fixture(); f.event("tool_execution_end", "parent/1", { isError: true });
  assert.equal(f.group().uncertain, true);
  assert.equal(f.event("tool_execution_start"), false); assert.equal(f.group().calls[0].status, "error");
  for (const [sid, run] of [["old", 1], ["session", 0]]) assert.equal(f.state.observe({
    type: "tool_execution_start", toolCallId: "parent/2", parentToolCallId: "parent" }, sid, run), false);
  assert.equal(f.event("tool_execution_start", "unknown/1"), false);
});

test("saved parent summary wins; child failure does not invent parent failure", () => {
  const f = fixture(); f.event("tool_execution_start");
  f.state.settle("parent", { complete: true, calls: [{ id: "parent/1", name: "read", status: "error", durationMs: 0 }] });
  assert.equal(f.group().calls[0].status, "error"); assert.equal(f.group().calls[0].durationMs, 0);
  assert.equal(f.group().finalized, true); assert.equal(f.event("tool_execution_end"), false);
});
test("disconnect and run replacement leave unfinished unknowns, not success", () => {
  const f = fixture(); f.event("tool_execution_start"); f.state.interrupt();
  assert.equal(f.group().calls[0].status, "unfinished"); assert.equal(f.group().uncertain, true);
  f.state.begin("session", 2); assert.equal(f.state.snapshot().size, 0);
});
test("node and argument caps mark incomplete without retaining oversized parameters", () => {
  const f = fixture(); f.event("tool_execution_start", "parent/1", { args: { text: "x".repeat(9000) } });
  assert.equal(f.group().calls[0].arguments, undefined); assert.ok(f.group().calls[0].argumentsBytes > 8192);
  for (let n = 2; n <= 257; n++) f.event("tool_execution_start", "parent/" + n);
  assert.equal(f.group().calls.length, 256); assert.equal(f.group().complete, false);
});
test("preview truncation is bounded, images are whole, usage and private details are not cached", () => {
  const f = fixture(); f.event("tool_execution_update", "parent/1", { partialResult: {
    content: [{ type: "text", text: "x".repeat(100000) }, { type: "image", data: "A".repeat(2 * 1024 * 1024), mimeType: "image/png" }],
    details: { secret: "not retained" }, usage: { cost: { total: 99 } } } });
  const call = f.group().calls[0];
  assert.equal(call.preview.content[0].text.length, 32768); assert.equal(call.preview.content.length, 1);
  assert.equal(call.previewTruncated, true); assert.equal(call.preview.usage, undefined);
  assert.deepEqual(call.preview.details, {});
});

test("collapsed descendants do not turn into orphans; malformed cycles stay finite", () => {
  const calls = [{ id: "parent/1", parentId: "parent" }, { id: "parent/1/1", parentId: "parent/1" },
    { id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
  const rows = nestedTreeRows("parent", calls, new Set(["x", "y"]));
  assert.deepEqual(rows.map(row => row.node.id), ["parent/1", "x", "y"]);
  assert.equal(rows[1].orphan, true);
});
test("history keeps missing arguments and unfinished statuses honest", () => {
  const group = historicalNestedGroup("parent", { complete: false, calls: [
    { id: "parent/1", name: "read", status: "unfinished", argumentsBytes: 9000, durationMs: -1 },
    { id: "parent/1", name: "read", status: "ok" }] });
  assert.equal(group.calls.length, 1); assert.equal(group.calls[0].arguments, undefined);
  assert.equal(group.calls[0].durationMs, undefined); assert.equal(group.calls[0].status, "unfinished");
  assert.equal(group.complete, false);
});

test("root cap evicts finalized roots only and bounds live state", () => {
  const f = fixture();
  for (let n = 1; n <= 63; n++) f.state.register("root-" + n);
  f.state.register("extra"); assert.equal(f.state.owns("extra"), false);
  f.state.settle("parent"); f.state.register("extra");
  assert.equal(f.state.owns("extra"), true); assert.equal(f.state.owns("parent"), false);
});
test("per-root parameter budget omits later arguments instead of retaining unbounded objects", () => {
  const f = fixture();
  for (let n = 1; n <= 6; n++) f.event("tool_execution_start", "parent/" + n, { args: { text: "x".repeat(7000) } });
  const calls = f.group().calls;
  assert.equal(calls.filter(c => c.arguments).length, 4);
  assert.equal(calls.filter(c => c.argumentsBytes).length, 2);
  assert.equal(f.group().complete, false);
});
test("global preview budget omits excess whole images, keeping child state", () => {
  const f = fixture();
  for (let n = 1; n <= 5; n++) f.event("tool_execution_update", "parent/" + n, { partialResult: {
    content: [{ type: "image", mimeType: "image/png", data: "A".repeat(1024 * 1024) }] } });
  const calls = f.group().calls;
  assert.equal(calls.filter(c => c.preview).length, 4);
  assert.equal(calls[4].previewOmitted, true); assert.equal(calls[4].status, "running");
});


