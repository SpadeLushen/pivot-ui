import { searchSessionText, sessionSearchStatus, configureSessionSearch } from "@/lib/session-search";
import type { SessionSearchAction } from "@/lib/session-search-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q");
    if (query && query.length > 1000) throw new Error("Search query is too long");
    return Response.json(query?.trim() ? await searchSessionText(query) : await sessionSearchStatus(), { headers });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const actions = ["enable", "disable", "rebuild", "check-path", "move"];
    if (!body || !actions.includes(body.action)) throw new Error("Invalid search action");
    if (body.action === "move" || body.action === "check-path") {
      if (typeof body.path !== "string" || !body.path.trim()) throw new Error("Database path is required");
      if (body.action === "move" && body.migrate !== true) throw new Error("Migration confirmation is required");
    }
    return Response.json(await configureSessionSearch(body as SessionSearchAction), { headers });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400, headers });
  }
}
