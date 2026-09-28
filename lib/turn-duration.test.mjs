import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { estimateTurnDuration, estimateGroupedTurnDuration, sumPreciseTurnDurations } = await jiti.import("./turn-duration.ts");
const user = { role: "user", content: "go", timestamp: 999999 };
const assistant = (toolIds = []) => ({
  role: "assistant", timestamp: 999999,
  content: toolIds.length ? toolIds.map((id) => ({ type: "toolCall", toolCallId: id })) : [{ type: "text", text: "done" }],
});
const result = (id) => ({ role: "toolResult", toolCallId: id, content: [] });

test("no-tool turn uses the assistant entry write time, not its message creation time", () => {
  assert.equal(estimateTurnDuration([user, assistant()], [1000, 3550], 1), 2550);
  assert.equal(estimateTurnDuration([assistant()], [3550], 0), undefined);
  assert.equal(estimateTurnDuration([user, assistant()], [null, 3550], 1), undefined);
  assert.equal(estimateTurnDuration([user, assistant()], [3550, 3550], 1), undefined);
});

test("tool turn ends at the last matching result, including parallel tool calls", () => {
  const messages = [user, assistant(["one", "two"]), result("two"), result("one"), assistant()];
  const times = [1000, 2500, 3500, 4000, 5700];
  assert.equal(estimateTurnDuration(messages, times, 1), 3000);
  assert.equal(estimateTurnDuration(messages, times, 4), 1700);
  assert.equal(estimateTurnDuration(messages, [1000, 2500, 3500, null, 5700], 1), undefined);
});

test("collapsed group sums every precise turn, or estimates from the user entry", () => {
  const messages = [user, assistant(["one", "two"]), result("one"), result("two"), assistant()];
  const timestamps = [1000, 1900, 3200, 4000, 6000];
  const exact = (message) => message === messages[1] ? 1800 : 1300;
  assert.equal(sumPreciseTurnDurations(messages, 0, 4, exact), 3100);
  assert.equal(sumPreciseTurnDurations(messages, 0, 4, (message) => message === messages[1] ? 1800 : undefined), undefined);
  assert.equal(sumPreciseTurnDurations(messages, 0, 4, () => 0), 0);
  assert.equal(estimateGroupedTurnDuration(messages, timestamps, 0, 4), 5000);
  assert.equal(estimateTurnDuration(messages, timestamps, 4), 2000); // expanded: last turn only
});

test("single-turn and consecutive user groups keep their own boundaries", () => {
  const messages = [user, assistant(), user, assistant(["next"]), result("next"), assistant()];
  const timestamps = [1000, 1500, 5000, 6100, 7500, 8500];
  assert.equal(sumPreciseTurnDurations(messages, 0, 1, () => 400), 400);
  assert.equal(estimateGroupedTurnDuration(messages, timestamps, 0, 1), 500);
  assert.equal(sumPreciseTurnDurations(messages, 2, 5, (message) => message === messages[3] ? 1600 : 800), 2400);
  assert.equal(estimateGroupedTurnDuration(messages, timestamps, 2, 5), 3500);
});

test("collapsed estimates need a user write time and completed final turn, not complete intermediate turns", () => {
  const messages = [user, assistant(["one"]), result("one"), assistant()];
  assert.equal(estimateGroupedTurnDuration(messages, [null, 2000, 3000, 4000], 0, 3), undefined);
  assert.equal(estimateGroupedTurnDuration(messages, [1000, 2000, null, 4000], 0, 3), 3000);
  assert.equal(estimateGroupedTurnDuration([user, assistant(["one"]), assistant()], [1000, 2000, 4000], 0, 2), 3000);
  const withError = [user, assistant(["one"]), result("one"), { ...assistant(), stopReason: "error" }, assistant()];
  assert.equal(sumPreciseTurnDurations(withError, 0, 4, (message) => message.stopReason === "error" ? undefined : 500), undefined);
  assert.equal(estimateGroupedTurnDuration(withError, [1000, 2000, 3000, 3200, 4000], 0, 4), 3000);
  assert.equal(estimateGroupedTurnDuration([user, assistant(), user, assistant()], [1000, 2000, 3000, 4000], 0, 3), undefined);
  assert.equal(estimateGroupedTurnDuration([user, assistant(), { ...assistant(), stopReason: "error" }], [1000, 2000, 4000], 0, 2), undefined);
  assert.equal(sumPreciseTurnDurations([user, assistant(), user, assistant()], 0, 3, () => 500), undefined);
});

test("incomplete turns and unrelated results never provide an estimated end", () => {
  assert.equal(estimateTurnDuration([user, assistant(["one", "two"]), result("one")], [1000, 2000, 4000], 1), undefined);
  assert.equal(estimateTurnDuration([user, assistant(["one"]), result("other"), assistant()], [1000, 2000, 4000, 5000], 1), undefined);
  assert.equal(estimateTurnDuration([user, assistant(["one"]), result("one")], [1000, 2000, 4000], 0), undefined);
  assert.equal(estimateTurnDuration([user, assistant(), assistant()], [1000, 2000, 4000], 2), undefined);
  assert.equal(estimateTurnDuration([user, { ...assistant(), stopReason: "aborted" }], [1000, 4000], 1), undefined);
  assert.equal(estimateTurnDuration([user, { ...assistant(), stopReason: "error" }], [1000, 4000], 1), undefined);
});
