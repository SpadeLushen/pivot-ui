import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { requestSessionSearchSync } from "@/lib/session-search";
import { getErrorRpcSessionIds, getRunningRpcSessionIds } from "@/lib/rpc-manager";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    requestSessionSearchSync();
    return NextResponse.json({
      sessions,
      runningSessionIds: getRunningRpcSessionIds(),
      errorSessionIds: getErrorRpcSessionIds(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
