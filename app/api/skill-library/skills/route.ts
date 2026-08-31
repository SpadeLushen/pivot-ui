import { NextResponse } from "next/server";
import { scanLibrary } from "@/lib/skill-library";
import { readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";

export const dynamic = "force-dynamic";

// GET /api/skill-library/skills
// Lists every skill copy in the configured library.
export async function GET() {
  const config = readConfig();
  const libraryRoot = resolveLibraryRoot(config);
  const skills = libraryRoot ? scanLibrary(libraryRoot) : [];
  return NextResponse.json({ skills });
}
