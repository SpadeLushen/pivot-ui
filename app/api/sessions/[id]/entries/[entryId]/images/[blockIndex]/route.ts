import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { isImageMimeType } from "@/lib/message-images";

// Read one persisted image, never a caller-supplied filesystem path or live SDK session.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string; blockIndex: string }> },
) {
  const { id, entryId, blockIndex: rawIndex } = await params;
  const blockIndex = Number(rawIndex);
  if (!/^\d+$/.test(rawIndex) || !Number.isSafeInteger(blockIndex)) {
    return NextResponse.json({ error: "Invalid image index" }, { status: 400 });
  }
  const toolCallId = new URL(req.url).searchParams.get("toolCallId");
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolCallId !== toolCallId) {
      return NextResponse.json({ error: "Tool result not found" }, { status: 404 });
    }
    const block = entry.message.content[blockIndex];
    if (!block || block.type !== "image") return NextResponse.json({ error: "Image not found" }, { status: 404 });
    const data = block.source?.type === "base64" ? block.source.data : block.data;
    const mime = block.source?.type === "base64" ? block.source.media_type : block.mimeType;
    if (typeof data !== "string" || !isImageMimeType(mime)) {
      return NextResponse.json({ error: "Invalid image" }, { status: 422 });
    }
    const base64 = data.replace(/\s/g, "");
    if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return NextResponse.json({ error: "Invalid image data" }, { status: 422 });
    }
    return new NextResponse(new Uint8Array(Buffer.from(base64, "base64")), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to read image" }, { status: 500 });
  }
}
