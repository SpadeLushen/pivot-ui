import { recordModelThinkingLevel } from "./preferences";
import { isThinkingLevelOption } from "./thinking-levels";

/** Record only accepted chat input; handled commands and rejected input are not messages. */
export async function recordSentThinkingPreference(command: Record<string, unknown>, result: unknown): Promise<unknown> {
  if (command.type !== "prompt" && command.type !== "steer" && command.type !== "follow_up") return result;
  if (!result || typeof result !== "object" || !("disposition" in result)
    || (result.disposition !== "started" && result.disposition !== "queued")) return result;
  const selection = command.thinkingSelection;
  if (!selection || typeof selection !== "object" || !("modelId" in selection) || !("level" in selection)
    || typeof selection.modelId !== "string" || !selection.modelId || !isThinkingLevelOption(selection.level)) return result;
  try {
    await recordModelThinkingLevel(selection.modelId, selection.level);
    return result;
  } catch (error) {
    console.error("Failed to save model thinking preference:", error);
    return { ...result, thinkingPreferenceError: "chat.modelThinkingSaveFailed" };
  }
}
