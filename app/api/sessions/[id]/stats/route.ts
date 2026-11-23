import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { sessionStatistics } from "@/lib/session-statistics";
import { offlineContextUsage } from "@/lib/session-context-usage";
import { usableContextUsage } from "@/lib/context-usage";

export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const wrapper = getRpcSession(id);
    const live = wrapper?.isAlive() ? wrapper.inner : undefined;
    const path = live ? undefined : await resolveSessionPath(id);
    if (!live && !path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const sm = live?.sessionManager ?? SessionManager.open(path!);
    const query = new URL(req.url).searchParams;
    let leafId = query.get("leafId") ?? undefined;
    if (leafId && query.get("followWarm") === "1") {
      // A background warm advances the SDK leaf without adding a chat message.
      // Follow only that suffix; never switch the selected branch after a missed event.
      const tip = sm.getLeafId();
      let cursor = tip;
      const seen = new Set<string>();
      while (cursor && cursor !== leafId && !seen.has(cursor)) {
        seen.add(cursor);
        const entry = sm.getEntry(cursor);
        if (entry?.type !== "usage" || entry.kind !== "cache_warm") break;
        cursor = entry.parentId;
      }
      if (cursor === leafId && tip) leafId = tip;
    }
    const stats = sessionStatistics(sm, live, leafId);
    const selectedLeaf = leafId ?? sm.getLeafId();
    if (selectedLeaf !== sm.getLeafId()) stats.contextUsage = undefined;
    if (!usableContextUsage(stats.contextUsage)) {
      stats.contextUsage = await offlineContextUsage(sm, selectedLeaf, live,
        stats.contextUsage?.contextWindow) ?? stats.contextUsage;
    }
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? "Session leaf not found" : "Unable to read session statistics" },
      { status: error instanceof RangeError ? 404 : 500 });
  }
}
