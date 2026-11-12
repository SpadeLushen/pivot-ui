import { NextResponse } from "next/server";
import { setUnreadSession } from "@/lib/session-unread";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ unreadSessions: setUnreadSession(id, null, "readable") });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
