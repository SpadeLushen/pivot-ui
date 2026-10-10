import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { sessionStatistics } from "@/lib/session-statistics";

export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const wrapper = getRpcSession(id);
    const live = wrapper?.isAlive() ? wrapper.inner : undefined;
    const path = live ? undefined : await resolveSessionPath(id);
    if (!live && !path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const sm = live?.sessionManager ?? SessionManager.open(path!);
    const leafId = new URL(req.url).searchParams.get("leafId") ?? undefined;
    return NextResponse.json(sessionStatistics(sm, live, leafId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? "Session leaf not found" : "Unable to read session statistics" },
      { status: error instanceof RangeError ? 404 : 500 });
  }
}
