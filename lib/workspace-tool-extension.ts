import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { readWorkspaceTools } from "./workspace-tools";
import { isMcpTool } from "./session-tool-policy";
import type { WorkspaceToolRule } from "./tool-settings-types";

/** Enforcement also covers tools dynamically re-registered during an existing turn. */
export function workspaceToolExtension(): InlineExtension {
  return { name: "pivot-workspace-tools", hidden: true, factory(pi) {
    let rules: Record<string, WorkspaceToolRule> = Object.create(null);
    pi.on("before_agent_start", async (_event, ctx) => {
      // Capture once per run; saving settings must not change an in-flight loadout.
      rules = readWorkspaceTools(ctx.cwd).rules;
    });
    pi.on("tool_call", async (event) => {
      const tool = pi.getAllTools().find((item) => item.name === event.toolName);
      if (tool && isMcpTool(tool)) return;
      const rule = rules[event.toolName];
      if (rule && (!rule.enabled || rule.exposure === "hidden")) {
        return { block: true, reason: "This tool is disabled in the current workspace" };
      }
    });
  } };
}
