import { readModelHttpTimeout, saveModelHttpTimeout } from "@/lib/model-http-settings";

export const dynamic = "force-dynamic";

export function GET() {
  try { return Response.json({ timeoutMs: readModelHttpTimeout() }); }
  catch { return Response.json({ error: "Could not read Pi settings" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const ms: unknown = body?.timeoutMs;
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > 2_147_483_647) {
    return Response.json({ error: "Expected an integer timeout between 0 and 2147483647 ms" }, { status: 400 });
  }
  try { return Response.json({ timeoutMs: await saveModelHttpTimeout(ms) }); }
  catch { return Response.json({ error: "Could not save Pi settings" }, { status: 500 }); }
}
