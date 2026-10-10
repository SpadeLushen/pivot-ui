import type { AgentSessionLike } from "./pi-types";

declare global {
  var __pivotAppliedToolRules: WeakMap<object, string> | undefined;
  var __pivotToolRuleFailures: WeakSet<object> | undefined;
}
export function recordAppliedToolRules(session: AgentSessionLike, revision: string): void {
  (globalThis.__pivotAppliedToolRules ??= new WeakMap()).set(session, revision);
  globalThis.__pivotToolRuleFailures?.delete(session);
}
export function recordToolRuleFailure(session: AgentSessionLike): void {
  (globalThis.__pivotToolRuleFailures ??= new WeakSet()).add(session);
}
export function toolRulesFailed(session: AgentSessionLike): boolean {
  return globalThis.__pivotToolRuleFailures?.has(session) ?? false;
}
export function appliedToolRulesRevision(session: AgentSessionLike): string | undefined {
  return globalThis.__pivotAppliedToolRules?.get(session);
}
