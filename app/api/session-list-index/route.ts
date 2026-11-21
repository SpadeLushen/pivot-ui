import { NextResponse } from "next/server";
import { sessionIndexStatus, startSessionIndexRebuild } from "@/lib/session-reader";

export function GET() {
  return NextResponse.json(sessionIndexStatus(), { headers: { "Cache-Control": "no-store" } });
}

export function POST() {
  return NextResponse.json(startSessionIndexRebuild(), { status: 202 });
}
