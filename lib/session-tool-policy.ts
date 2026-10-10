import type { AgentSessionLike, ToolInfo } from "./pi-types";
import type { ToolExposure, ToolRuleOverrides } from "./tool-settings-types";

type Definition = NonNullable<ReturnType<AgentSessionLike["getToolDefinition"]>>;
type Ownership = { original: ToolExposure; applied?: ToolExposure };
declare global { var __pivotToolOwnership: WeakMap<object, Ownership> | undefined; }
function ownership(definition: Definition): Ownership {
  const states = globalThis.__pivotToolOwnership ??= new WeakMap();
  let state = states.get(definition);
  const current = definition.exposure ?? "direct";
  if (!state) { state = { original: current }; states.set(definition, state); }
  else if (state.applied !== undefined && current !== state.applied) {
    // An owner re-registered/withdrew the tool: its new policy wins.
    state.original = current; state.applied = undefined;
  }
  return state;
}
export function isMcpTool(tool: ToolInfo): boolean {
  return tool.name.startsWith("mcp__") || tool.sourceInfo.path === "builtin:mcp" || tool.namespace?.name.startsWith("mcp__") === true;
}
export function originalToolExposure(session: AgentSessionLike, name: string): ToolExposure {
  const definition = session.getToolDefinition(name);
  return definition ? ownership(definition).original : "hidden";
}
export function applyToolExposure(session: AgentSessionLike, tool: ToolInfo, rule?: ToolRuleOverrides) {
  const definition = session.getToolDefinition(tool.name);
  if (!definition) return { exposure: "hidden" as ToolExposure, changed: false };
  const state = ownership(definition);
  const exposure = state.original === "hidden" || rule?.enabled === false ? "hidden" : rule?.exposure ?? state.original;
  const changed = (definition.exposure ?? "direct") !== exposure;
  if (changed) definition.exposure = exposure;
  state.applied = exposure;
  return { exposure, changed };
}
