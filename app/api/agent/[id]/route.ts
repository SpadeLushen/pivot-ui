import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { AgentBusyError, startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    // Argument suggestions use the runtime already loaded by get_commands.
    // Never start an expired session just for a delayed completion request.
    if (body.type === "get_command_completions") {
      return NextResponse.json({ success: true, data: { items: [] } });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    // An explicit model change can recover an old Azure session whose saved identity
    // is no longer configured; ordinary prompts must never silently pick a fallback.
    const requestedModel = body.type === "set_model" && typeof body.provider === "string" && typeof body.modelId === "string"
      ? { provider: body.provider, modelId: body.modelId } : undefined;
    const { session } = await startRpcSession(id, filePath, cwd, undefined, undefined, requestedModel);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof AgentBusyError || (error instanceof Error && error.name === "AgentBusyError")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
