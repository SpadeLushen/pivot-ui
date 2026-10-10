import { NextResponse } from "next/server";
import { scanLibraryMcpServers } from "@/lib/mcp-library";
import { mcpConfigUnavailableResponse } from "@/lib/mcp-config-phase";
import { ensureLibraryRoot, readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";

export const dynamic = "force-dynamic";

function toInfo(server: ReturnType<typeof scanLibraryMcpServers>[number]) {
  return {
    serverKey: server.serverKey,
    name: server.name,
    description: server.description,
    source: server.source,
    sourceRef: server.sourceRef,
    definition: server.definition,
    configHash: server.configHash,
  };
}

export async function GET() {
  const config = ensureLibraryRoot(readConfig());
  const libraryRoot = resolveLibraryRoot(config);
  return NextResponse.json({ mcpServers: libraryRoot ? scanLibraryMcpServers(libraryRoot).map(toInfo) : [] });
}

export async function POST() { return mcpConfigUnavailableResponse(); }
