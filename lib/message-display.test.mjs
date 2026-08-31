import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./message-display.ts");
}

function assistant(content) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content,
  };
}

test("extracts the last non-empty thinking line for a collapsed preview", async () => {
  const { getLastThinkingLine } = await loadSubject();

  assert.equal(getLastThinkingLine("first line\r\nlast line  \r\n"), "last line");
  assert.equal(getLastThinkingLine("   \n\t"), "");

  const longLastLine = "last line ".repeat(80);
  assert.equal(getLastThinkingLine(`older context\n${longLastLine}`), longLastLine.trim());
});

test("splits trailing final answer blocks from process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
    { type: "image", source: { type: "url", url: "https://example.com/final.png" } },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text", "image"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "toolCall"]);
});

test("keeps pre-tool text in process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "text", text: "I will inspect the repo first." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.equal(result.answerBlocks[0].text, "Final answer");
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["text", "toolCall"]);
});

test("does not expose text before a trailing tool call as final answer", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "text", text: "I need to call a tool." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks, []);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "text", "toolCall"]);
});

test("drops empty thinking blocks after completion", async () => {
  const { getDisplayableAssistantBlocks, splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["text"],
  );

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });
  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks, []);
});

test("keeps empty thinking while streaming", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Partial answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: true });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking"]);
});


test("shows provisional thinking until real thinking content or a later block arrives", async () => {
  const { getStreamingAssistantBlockItems } = await loadSubject();
  const initial = getStreamingAssistantBlockItems(assistant([]));
  assert.deepEqual(initial.blockItems.map(({ block }) => block.type), ["thinking"]);
  assert.equal(initial.blockItems[0].originalIndex, -1);
  assert.equal(initial.hasNextContent, false);

  const delayed = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "" },
  ]));
  assert.deepEqual(delayed.blockItems.map(({ block }) => block.type), ["thinking"]);

  const real = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "reasoning arrived" },
  ]));
  assert.deepEqual(real.blockItems.map(({ block }) => block.type), ["thinking"]);
  const consecutive = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "first" },
    { type: "thinking", thinking: "second" },
  ]));
  assert.deepEqual(consecutive.blockItems.map(({ block }) => block.type), ["thinking", "thinking"]);
  assert.deepEqual(consecutive.blockItems.map(({ originalIndex }) => originalIndex), [0, 1]);
});

test("keeps provisional timing when real thinking arrives and splits consecutive blocks", async () => {
  const { getStreamingAssistantBlockItems, updateStreamingThinkingDurations } = await loadSubject();
  const timings = new Map();

  const provisional = getStreamingAssistantBlockItems(assistant([])).blockItems;
  assert.deepEqual(
    [...updateStreamingThinkingDurations(provisional, timings, 1000)],
    [[-1, 0]],
  );

  const first = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "first" },
  ])).blockItems;
  assert.deepEqual(
    [...updateStreamingThinkingDurations(first, timings, 2500)],
    [[0, 1]],
  );
  assert.equal(timings.has(-1), false);
  assert.equal(timings.get(0).start, 1000);

  const consecutive = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "first" },
    { type: "thinking", thinking: "second" },
  ])).blockItems;
  assert.deepEqual(
    [...updateStreamingThinkingDurations(consecutive, timings, 4000)],
    [[0, 3], [1, 0]],
  );
  assert.equal(timings.get(0).end, 4000);
  assert.equal(timings.get(1).start, 4000);
  assert.deepEqual(
    [...updateStreamingThinkingDurations(consecutive, timings, 5500)],
    [[0, 3], [1, 1]],
  );
});
test("removes empty provisional thinking when text or a tool call is next", async () => {
  const { getStreamingAssistantBlockItems } = await loadSubject();
  for (const nextBlock of [
    { type: "text", text: "answer" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
  ]) {
    const result = getStreamingAssistantBlockItems(assistant([
      { type: "thinking", thinking: "   " },
      nextBlock,
    ]));
    assert.equal(result.hasNextContent, true);
    assert.deepEqual(result.blockItems.map(({ block }) => block.type), [nextBlock.type]);
  }

  const resultWithThinking = getStreamingAssistantBlockItems(assistant([
    { type: "thinking", thinking: "visible reasoning" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
  ]));
  assert.deepEqual(resultWithThinking.blockItems.map(({ block }) => block.type), ["thinking", "toolCall"]);
});


test("keeps deferred historical thinking placeholders", async () => {
  const { getDisplayableAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "", deferred: true },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["thinking", "text"],
  );
});
