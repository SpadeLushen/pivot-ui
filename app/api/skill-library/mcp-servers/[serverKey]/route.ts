import { NextResponse } from "next/server";
import { getLibraryMcpServer } from "@/lib/mcp-library";
import { mcpConfigUnavailableResponse } from "@/lib/mcp-config-phase";
import { ensureLibraryRoot, readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ serverKey: string }>;
}

function toInfo(server: NonNullable<ReturnType<typeof getLibraryMcpServer>>) {
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

function libraryRoot(): string | null {
  return resolveLibraryRoot(ensureLibraryRoot(readConfig()));
}

export async function GET(_req: Request, { params }: RouteParams) {
  const root = libraryRoot();
  const { serverKey } = await params;
  const server = root ? getLibraryMcpServer(root, serverKey) : null;
  return server ? NextResponse.json(toInfo(server)) : NextResponse.json({ error: "MCP server not found" }, { status: 404 });
}

export async function PATCH() { return mcpConfigUnavailableResponse(); }
export async function DELETE() { return mcpConfigUnavailableResponse(); }
