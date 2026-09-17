import { parsePreferencePatch, readPreferences, updatePreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  return Response.json(readPreferences(), noStore);
}

async function handleUpdate(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parsePreferencePatch(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    return Response.json(await updatePreferences(parsed.patch), noStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Failed to save preferences: ${message}` }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  return handleUpdate(request);
}

export async function PUT(request: Request) {
  return handleUpdate(request);
}
