import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, SessionStatsInfo } from "./pi-types";
import { aggregateSessionUsage } from "./session-usage";

/** Read-only ledger projection; never constructs a runtime or loads MCP. */
export function sessionStatistics(sm: SessionManager, live?: AgentSessionLike, requestedLeafId?: string): SessionStatsInfo {
  const leafId = requestedLeafId ?? sm.getLeafId();
  if (leafId && !sm.getEntry(leafId)) throw new RangeError("Session leaf not found");
  const full = aggregateSessionUsage(sm.getEntries());
  const branch = aggregateSessionUsage(leafId ? sm.getBranch(leafId) : []);
  let source: "sdk" | "history" = "history";
  let sdk: Omit<SessionStatsInfo, "sessionName"> | undefined;
  if (live) {
    // Legacy records can lack fields which the SDK's strict aggregator expects.
    try {
      const result = live.getSessionStats();
      if (Number.isFinite(result.cost) && Object.values(result.tokens).every(Number.isFinite)) {
        sdk = result;
        source = "sdk";
        full.tokens = result.tokens;
        full.cost = result.cost;
      }
    } catch { /* Keep the recorded, partial read-only ledger instead of fabricating usage. */ }
  }
  return {
    sessionFile: sm.getSessionFile(), sessionId: sm.getSessionId(),
    userMessages: full.userMessages, assistantMessages: full.assistantMessages,
    toolCalls: full.toolCalls, toolResults: full.toolResults, totalMessages: full.totalMessages,
    tokens: full.tokens, cost: full.cost, ...sdk,
    sessionName: sm.getSessionName(),
    contextUsage: sdk?.contextUsage ?? live?.getContextUsage(),
    accounting: { full, branch, leafId, source },
  };
}
