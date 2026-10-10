import type { AgentSessionLike } from "./pi-types";
import { readWorkspaceTools } from "./workspace-tools";
import { applyToolExposure, isMcpTool } from "./session-tool-policy";
import { recordAppliedToolRules, recordToolRuleFailure } from "./tool-application";

/** Available tools by default, with explicit workspace enablement/exposure overrides. */
export function activateAllSessionTools(session: AgentSessionLike): void {
  try { applySessionTools(session); }
  catch (error) { recordToolRuleFailure(session); throw error; }
}
function applySessionTools(session: AgentSessionLike): void {
  const { rules, revision } = readWorkspaceTools(session.sessionManager.getCwd(), session.settingsManager.isProjectTrusted());
  const active = new Set(session.getActiveToolNames());
  let exposureChanged = false;
  const names = session.getAllTools().filter((tool) => {
    const rule = isMcpTool(tool) ? undefined : rules[tool.name];
    const effective = isMcpTool(tool) ? { exposure: tool.exposure ?? "direct", changed: false } : applyToolExposure(session, tool, rule);
    exposureChanged ||= effective.changed;
    if (effective.exposure === "hidden") return false;
    if (rule) {
      if (effective.exposure === "direct" || effective.exposure === "model-only") return true;
      return !effective.changed && active.has(tool.name);
    }
    // Native orchestration chooses its own activation; do not defeat MCP exposure
    // or declare every deferred server tool before tool_search loads it.
    if (tool.name === "codemode" || tool.name === "tool_search") return active.has(tool.name);
    if (effective.exposure === "codemode" || effective.exposure === "deferred") return active.has(tool.name);
    return true;
  }).map((tool) => tool.name);
  const updated = session.getAllTools();
  for (const [exposure, helper] of [["codemode", "codemode"], ["deferred", "tool_search"]] as const) {
    // Workspace-owned indirect tools need an orchestrator even without MCP servers.
    const needed = updated.some((tool) => !isMcpTool(tool) && tool.name !== helper && tool.exposure === exposure);
    const orchestrator = updated.find((tool) => tool.name === helper);
    if (needed && orchestrator && (orchestrator.exposure === "direct" || orchestrator.exposure === "model-only") && !names.includes(helper)) names.push(helper);
  }
  if (exposureChanged || active.size !== names.length || !names.every((name) => active.has(name))) {
    session.setActiveToolsByName(names);
  }
  recordAppliedToolRules(session, revision);
}
