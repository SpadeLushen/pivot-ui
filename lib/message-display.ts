import type { AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function getLastThinkingLine(thinking: string): string {
  const trimmed = thinking.trimEnd();
  if (!trimmed) return "";
  return trimmed.split(/\r?\n/).at(-1)?.trim() ?? "";
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isEmptyThinkingBlock(block, options));
}

export interface StreamingAssistantBlockItem {
  block: AssistantContentBlock;
  originalIndex: number;
}

export interface StreamingAssistantBlocks {
  blockItems: StreamingAssistantBlockItem[];
  hasNextContent: boolean;
}

/**
 * Build the live assistant blocks shown before Pi has necessarily emitted a
 * thinking_start event. The provisional block is presentation-only and is
 * removed when the first non-thinking block arrives without visible thinking.
 */
export function getStreamingAssistantBlockItems(message: AssistantMessage): StreamingAssistantBlocks {
  const rawBlockItems = (message.content ?? []).map((block, originalIndex) => ({ block, originalIndex }));
  const hasNextContent = rawBlockItems.some(({ block }) => block.type !== "thinking");
  const displayBlockItems = rawBlockItems.filter(({ block }) => (
    block.type !== "thinking"
      || !hasNextContent
      || block.deferred
      || block.thinking.trim() !== ""
  ));
  const hasThinkingBlock = displayBlockItems.some(({ block }) => block.type === "thinking");

  return {
    blockItems: !hasNextContent && !hasThinkingBlock
      ? [
        { block: { type: "thinking", thinking: "" }, originalIndex: -1 },
        ...displayBlockItems,
      ]
      : displayBlockItems,
    hasNextContent,
  };
}

export interface StreamingThinkingTiming {
  start: number;
  end?: number;
}

/**
 * Advance live thinking timers in place and return durations for the blocks
 * currently displayed. A block's timer ends when its successor appears.
 */
export function updateStreamingThinkingDurations(
  items: StreamingAssistantBlockItem[],
  timings: Map<number, StreamingThinkingTiming>,
  now: number,
): Map<number, number> {
  const currentThinking = items.filter(({ block }) => block.type === "thinking");
  const currentThinkingKeys = new Set(currentThinking.map(({ originalIndex }) => originalIndex));

  // The first real thinking block is the same logical block as the
  // presentation-only placeholder if no other content appeared first.
  const firstThinkingPosition = items.findIndex(({ block }) => block.type === "thinking");
  const firstThinking = firstThinkingPosition === -1 ? undefined : items[firstThinkingPosition];
  const hasContentBeforeThinking = firstThinkingPosition >= 0
    && items.slice(0, firstThinkingPosition).some(({ block }) => block.type !== "thinking");
  const provisional = timings.get(-1);
  if (
    firstThinking
    && firstThinking.originalIndex !== -1
    && !hasContentBeforeThinking
    && !timings.has(firstThinking.originalIndex)
    && provisional
    && provisional.end === undefined
  ) {
    timings.set(firstThinking.originalIndex, provisional);
    timings.delete(-1);
  }

  // End blocks that were removed because a later non-thinking block arrived
  // without visible thinking content.
  for (const [originalIndex, timing] of timings) {
    if (!currentThinkingKeys.has(originalIndex) && timing.end === undefined) {
      timing.end = now;
    }
  }

  for (const item of currentThinking) {
    if (!timings.has(item.originalIndex)) {
      timings.set(item.originalIndex, { start: now });
    }
  }

  // Any successor, including another thinking block, ends this block.
  for (let i = 0; i < items.length - 1; i++) {
    const item = items[i];
    if (item.block.type !== "thinking") continue;
    const timing = timings.get(item.originalIndex);
    if (timing && timing.end === undefined) timing.end = now;
  }

  const durations = new Map<number, number>();
  for (const item of currentThinking) {
    const timing = timings.get(item.originalIndex);
    if (!timing) continue;
    const end = timing.end ?? now;
    durations.set(item.originalIndex, Math.max(0, Math.floor((end - timing.start) / 1000)));
  }
  return durations;
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}
