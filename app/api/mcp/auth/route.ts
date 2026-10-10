import { NativeMcpManagementError } from "@/lib/native-mcp-management";
import { startMcpOAuth, submitMcpOAuth } from "@/lib/native-mcp-oauth";
import { PackWorkspaceAccessError } from "@/lib/workspace-pack-access";
import type { NativeMcpAuthEvent } from "@/lib/native-mcp-management-types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; serverKey?: unknown; action?: unknown; token?: unknown; url?: unknown } | null;
    if (!body || typeof body.cwd !== "string" || typeof body.serverKey !== "string") throw new NativeMcpManagementError("mcp.invalidRequest");
    const { cwd, serverKey } = body;
    if (body.action === "callback" || body.action === "cancel") {
      if (typeof body.token !== "string" || (body.action === "callback" && typeof body.url !== "string")) throw new NativeMcpManagementError("mcp.invalidRequest");
      await submitMcpOAuth(cwd, serverKey, body.token, body.action, body.url as string | undefined);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "start") throw new NativeMcpManagementError("mcp.invalidRequest");
    const abort = new AbortController(), encoder = new TextEncoder();
    let cancel: (() => void) | undefined, ended = false;
    const onAbort = () => { abort.abort(); cancel?.(); };
    req.signal.addEventListener("abort", onAbort, { once: true });
    if (req.signal.aborted) onAbort();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: NativeMcpAuthEvent) => {
          if (!ended && !abort.signal.aborted) {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
            catch { onAbort(); }
          }
        };
        const heartbeat = setInterval(() => {
          if (!ended && !abort.signal.aborted) {
            try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
            catch { onAbort(); }
          }
        }, 15_000);
        const close = () => {
          clearInterval(heartbeat); req.signal.removeEventListener("abort", onAbort);
          if (!ended) { ended = true; try { controller.close(); } catch { /* Client disconnected. */ } }
        };
        try {
          cancel = await startMcpOAuth(cwd, serverKey, abort.signal, send, close);
          if (abort.signal.aborted) { cancel(); close(); }
        } catch (error) {
          send({ type: "error", message: NativeMcpManagementError.is(error) ? error.message : "mcp.oauthFailed" }); close();
        }
      },
      cancel() { ended = true; onAbort(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no",
    } });
  } catch (error) {
    return Response.json({ error: NativeMcpManagementError.is(error) ? error.message : "mcp.managementFailed" }, {
      status: NativeMcpManagementError.is(error) ? error.status : error instanceof PackWorkspaceAccessError ? 403 : 500,
    });
  }
}
