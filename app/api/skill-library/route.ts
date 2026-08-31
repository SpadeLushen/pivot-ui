import { NextResponse } from "next/server";
import { scanLibrary } from "@/lib/skill-library";
import { scanLibraryMcpServers } from "@/lib/mcp-library";
import { readConfig, setLibraryRoot, writeConfig, ensureLibraryRoot, resolveLibraryRoot } from "@/lib/skill-packs-store";
import { allowFileRoot } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// GET /api/skill-library
// Returns the configured library root and the skills currently stored in it.
export async function GET() {
  const config = ensureLibraryRoot(readConfig());
  const libraryRoot = resolveLibraryRoot(config);
  const skills = libraryRoot ? scanLibrary(libraryRoot) : [];
  const mcpServers = libraryRoot ? scanLibraryMcpServers(libraryRoot).map((server) => ({
    serverKey: server.serverKey,
    name: server.name,
    description: server.description,
    source: server.source,
    sourceRef: server.sourceRef,
    definition: server.definition,
    configHash: server.configHash,
  })) : [];
  return NextResponse.json({ libraryRoot: config.libraryRoot, skills, mcpServers });
}

// PUT /api/skill-library body: { libraryRoot: string }
// Sets the global skill library root.
export async function PUT(req: Request) {
  try {
    const body = await req.json() as { libraryRoot?: string };
    const root = body.libraryRoot?.trim();
    if (!root) return NextResponse.json({ error: "libraryRoot required" }, { status: 400 });
    const config = setLibraryRoot(ensureLibraryRoot(readConfig()), root);
    writeConfig(config);
    const libraryRoot = resolveLibraryRoot(config);
    if (libraryRoot) allowFileRoot(libraryRoot);
    return NextResponse.json({ success: true, libraryRoot: root });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
