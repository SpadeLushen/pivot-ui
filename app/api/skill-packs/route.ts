import { NextResponse } from "next/server";
import { createPack, readConfig, writeConfig, packDefinitionsRevision, type SkillPack } from "@/lib/skill-packs-store";
import type { SkillPackInfo } from "@/lib/api-types";
import { schedulePackMcpSync } from "@/lib/workspace-pack-mcp-scheduler";

export const dynamic = "force-dynamic";

function toInfo(pack: SkillPack): SkillPackInfo {
  return { id: pack.id, name: pack.name, description: pack.description, skillCount: pack.skills.length, mcpServerCount: pack.nativeMcpServers?.length ?? 0, legacyMcpServerCount: pack.mcpServers.length };
}

// GET /api/skill-packs
export async function GET() {
  try {
    const config = readConfig({ strict: true });
    return NextResponse.json({ packs: config.packs.map(toInfo), definitionsRevision: packDefinitionsRevision(config) });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 500 }); }
}

// POST /api/skill-packs body: { name: string; description?: string }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { name?: string; description?: string };
    if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const config = readConfig({ strict: true });
    const { config: next, pack } = createPack(config, { name: body.name.trim(), description: body.description?.trim() });
    writeConfig(next);
    schedulePackMcpSync();
    return NextResponse.json({ pack: toInfo(pack) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
