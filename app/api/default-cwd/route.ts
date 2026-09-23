import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { readPreferences } from "@/lib/preferences";
import { createDefaultWorkspaceDirectory } from "@/lib/default-workspace-parent";

// POST /api/default-cwd
// Creates <configured parent>/pi-cwd-<YYYYMMDD> if needed and returns the path.
export async function POST() {
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = createDefaultWorkspaceDirectory(readPreferences()["default-workspace-parent"], date);
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
