import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { PRESET_DEFAULT, type ToolPreset } from "./tool-presets";

const CUSTOM_TYPE = "pivot-ui:tool-preset";
// Historical evidence only: these tools were exclusive to the old fixed full
// preset. This is not the current full preset's tool list.
const LEGACY_FULL_ONLY_TOOLS = ["grep", "find", "ls"];

// Custom entries are branch-local and don't enter the model's context. Pi restores
// tool declarations from system messages, but older sessions have none, and a
// preset change without a subsequent prompt has no system message to restore.
export function saveSessionToolPreset(manager: SessionManager, preset: ToolPreset): void {
  manager.appendCustomEntry(CUSTOM_TYPE, { preset });
}

export function restoreSessionToolPreset(manager: SessionManager): ToolPreset | undefined {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
    const preset = (entry.data as { preset?: unknown } | undefined)?.preset;
    if (preset === "none" || preset === "default" || preset === "full") return preset;
  }

  // Pi's saved system messages describe the last actual tool loadout. A legacy
  // full declaration lacks newer built-ins (such as powershell), so Pi can
  // restore it faithfully while the current full preset would appear default.
  // Upgrade only the exact old full core, not a user's custom tool selection.
  // Use the resolved context so compaction checkpoints count as saved state too.
  const messages = manager.buildSessionContext().messages;
  if (messages.some((message) => message.role === "system")) {
    // Even an empty system message is saved state (potentially tools off),
    // although the SDK's merged-system helper may return undefined for it.
    const system = getCurrentSystemMessage(messages);
    const names = new Set(system?.toolsAdded?.map((tool) => tool.name) ?? []);
    if (PRESET_DEFAULT.every((name) => names.has(name)) && LEGACY_FULL_ONLY_TOOLS.every((name) => names.has(name))) {
      return "full";
    }
    return undefined;
  }

  // Historical sessions with neither an explicit preset nor a saved system
  // loadout use Pivot UI's full default, not the SDK's four-tool default.
  return "full";
}
