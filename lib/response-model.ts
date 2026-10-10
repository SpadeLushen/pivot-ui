import type { AgentMessage } from "./types";
import type { RoutedModel } from "./session-models";

/** Public virtual-model wire API; no SDK internal imports or routing logic. */
export const VIRTUAL_CHAT_API = "pi-virtual";
export const knownModelLimit = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export function successfulResponseModel(message: AgentMessage): RoutedModel | null {
  if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted"
    || message.api === VIRTUAL_CHAT_API || !message.provider || !message.model) return null;
  return { provider: message.provider, modelId: message.model,
    ...(message.api ? { api: message.api } : {}),
    ...(message.thinkingLevel !== undefined ? { thinkingLevel: message.thinkingLevel } : {}) };
}
