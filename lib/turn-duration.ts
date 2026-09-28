import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

/** Approximate one Pi turn using persisted JSONL entry write times, not message creation times. */
export function estimateTurnDuration(
  messages: AgentMessage[],
  entryTimestamps: (number | null)[],
  assistantIndex: number,
): number | undefined {
  if (messages[assistantIndex]?.role !== "assistant") return undefined;
  let start: number | undefined;
  for (let index = assistantIndex - 1; index >= 0; index--) {
    const role = messages[index].role;
    if (role === "user" || role === "toolResult") {
      start = entryTime(entryTimestamps, index);
      break;
    }
    // A prior assistant without an intervening result is not this turn's start.
    if (role === "assistant") return undefined;
  }
  if (start === undefined) return undefined;

  const end = turnEndTime(messages, entryTimestamps, assistantIndex);
  return end !== undefined && end > start ? end - start : undefined;
}

function entryTime(timestamps: (number | null)[], index: number): number | undefined {
  const value = timestamps[index];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function completeAssistant(message: AgentMessage | undefined): message is AssistantMessage {
  return message?.role === "assistant"
    && !["aborted", "error", "pending", "length", "deferred"].includes(message.stopReason ?? "");
}

function turnEndTime(messages: AgentMessage[], timestamps: (number | null)[], assistantIndex: number): number | undefined {
  const assistant = messages[assistantIndex];
  if (!completeAssistant(assistant)) return undefined;
  const toolIds = new Set(assistant.content
    .filter((block): block is ToolCallContent => block.type === "toolCall")
    .map((block) => block.toolCallId));
  let end = entryTime(timestamps, assistantIndex);
  if (toolIds.size > 0) {
    end = undefined;
    for (let index = assistantIndex + 1; index < messages.length; index++) {
      const message = messages[index];
      if (message.role === "assistant" || message.role === "user") break;
      if (message.role !== "toolResult") continue;
      const id = (message as ToolResultMessage).toolCallId;
      if (!toolIds.has(id)) continue;
      const resultTime = entryTime(timestamps, index);
      if (resultTime === undefined) return undefined;
      end = Math.max(end ?? resultTime, resultTime);
      toolIds.delete(id);
    }
    if (toolIds.size > 0) return undefined;
  }
  return end;
}

function groupAssistants(messages: AgentMessage[], userIndex: number, finalIndex: number): number[] | undefined {
  if (messages[userIndex]?.role !== "user" || messages[finalIndex]?.role !== "assistant" || finalIndex <= userIndex) return undefined;
  const indices: number[] = [];
  for (let index = userIndex + 1; index <= finalIndex; index++) {
    if (messages[index].role === "user") return undefined;
    if (messages[index].role === "assistant") indices.push(index);
  }
  return indices;
}

/** Sum event-observed turn durations only when every turn in the group has one. */
export function sumPreciseTurnDurations(
  messages: AgentMessage[], userIndex: number, finalIndex: number,
  getDuration: (assistant: AssistantMessage) => number | undefined,
): number | undefined {
  const indices = groupAssistants(messages, userIndex, finalIndex);
  if (!indices) return undefined;
  let total = 0;
  for (const index of indices) {
    const duration = getDuration(messages[index] as AssistantMessage);
    if (duration === undefined || !Number.isFinite(duration) || duration < 0) return undefined;
    total += duration;
  }
  return total;
}

/** Fallback for the collapsed group: user entry write → final turn completion. */
export function estimateGroupedTurnDuration(
  messages: AgentMessage[], entryTimestamps: (number | null)[], userIndex: number, finalIndex: number,
): number | undefined {
  const indices = groupAssistants(messages, userIndex, finalIndex);
  if (!indices) return undefined;
  const start = entryTime(entryTimestamps, userIndex);
  if (start === undefined) return undefined;
  // Intermediate retries/errors do not invalidate the outer write-time span.
  // Only the final turn needs a complete endpoint.
  const end = turnEndTime(messages, entryTimestamps, finalIndex);
  return end !== undefined && end > start ? end - start : undefined;
}
