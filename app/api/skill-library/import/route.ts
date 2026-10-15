import { NextResponse } from "next/server";
import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNpx } from "@/lib/npx";
import { scanLibrary, discoverSkillDir, writeLibrarySkill, librarySkillExists } from "@/lib/skill-library";
import { readPackFile, savePackFile } from "@/lib/workspace-pack-files";
import { readConfig, resolveLibraryRoot } from "@/lib/skill-packs-store";
import { getAllowedFileRoots, isFilePathAllowed, allowFileRoot } from "@/lib/file-access";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

function getLibraryRoot(): string {
  const config = readConfig();
  const root = resolveLibraryRoot(config);
  if (!root) throw new Error("Skill library not configured");
  return root;
}

// CLI-specific layouts are staging details, never library scan locations.
function stagedMarketSkills(root: string) {
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop()!;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Installed skills must not contain symbolic links");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) pending.push(join(path, name));
    } else if (!stat.isFile()) {
      throw new Error("Installed skills must contain only regular files and directories");
    }
  }
  const found = new Map<string, ReturnType<typeof discoverSkillDir>>();
  for (const layout of [".pi", ".agents"]) {
    const dir = join(root, layout, "skills");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const sourceDir = join(dir, entry.name);
      if (!existsSync(join(sourceDir, "SKILL.md"))) continue;
      const key = entry.name.toLowerCase();
      if (!found.has(key)) found.set(key, discoverSkillDir(sourceDir));
    }
  }
  return [...found.values()];
}

function marketLockUpdate(root: string, libraryRoot: string, keys: string[]) {
  const stagedPath = join(root, "skills-lock.json");
  if (!existsSync(stagedPath)) return null;
  const staged = readPackFile(stagedPath).value.skills;
  if (!staged || typeof staged !== "object" || Array.isArray(staged)) {
    throw new Error("Invalid installer skills lock");
  }
  const path = join(libraryRoot, "skills-lock.json");
  if (existsSync(path) && realpathSync(path) !== join(realpathSync(libraryRoot), "skills-lock.json")) {
    throw new Error("Skills lock file escapes the library root");
  }
  const lock = readPackFile(path).value;
  if (lock.skills !== undefined && (!lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills))) {
    throw new Error("Invalid library skills lock");
  }
  const skills = { ...lock.skills as Record<string, unknown> | undefined };
  const receipts = staged as Record<string, unknown>;
  for (const key of keys) {
    const name = Object.keys(receipts).find((name) => name.toLowerCase() === key.toLowerCase());
    if (!name) throw new Error(`Missing installer receipt for "${key}"`);
    for (const oldKey of Object.keys(skills)) {
      if (oldKey.toLowerCase() === key.toLowerCase()) delete skills[oldKey];
    }
    skills[key] = receipts[name];
  }
  return { path, text: `${JSON.stringify({ ...lock, version: lock.version ?? 1, skills }, null, 2)}\n` };
}

async function marketImport(pkg: string) {
  const libraryRoot = getLibraryRoot();
  const stagingRoot = mkdtempSync(join(tmpdir(), "pivot-ui-market-import-"));
  const added: ReturnType<typeof writeLibrarySkill>[] = [];
  try {
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi", "--copy"];
    const { stdout, stderr } = await runNpx(args, {
      timeout: 120000,
      cwd: stagingRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const output = (stdout + stderr).replace(ANSI_RE, "");
    if (!/Installation complete|Installed \d+ skill/.test(output)) {
      throw new Error(output.slice(-300) || "Install failed");
    }
    const installed = stagedMarketSkills(stagingRoot);
    if (installed.length === 0) throw new Error("Installer completed but no skills were found");
    for (const skill of installed) {
      if (librarySkillExists(libraryRoot, skill.skillKey)) {
        throw new Error(`A skill named "${skill.skillKey}" already exists in the library`);
      }
    }
    const lock = marketLockUpdate(stagingRoot, libraryRoot, installed.map((skill) => skill.skillKey));
    for (const skill of installed) {
      added.push(writeLibrarySkill(libraryRoot, skill.skillKey, skill.sourceDir));
    }
    const skills = scanLibrary(libraryRoot);
    if (lock) savePackFile(lock.path, lock.text);
    return { skills, added };
  } catch (error) {
    // Only these newly created copies belong to this import; never remove existing skills.
    for (const skill of added) rmSync(skill.baseDir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function localImport(sourcePath: string, targetKey?: string) {
  const libraryRoot = getLibraryRoot();
  const allowed = await getAllowedFileRoots();
  if (!isFilePathAllowed(sourcePath, allowed)) {
    throw new Error("Selected path is not within an allowed file root");
  }
  allowFileRoot(sourcePath);
  const discovered = discoverSkillDir(sourcePath);
  const skillKey = targetKey?.trim() || discovered.skillKey;
  const written = writeLibrarySkill(libraryRoot, skillKey, sourcePath);
  return { skill: written };
}

interface GitImportBody {
  source: "git";
  url: string;
  selectedKeys?: string[];
}

async function gitImport(body: GitImportBody) {
  const libraryRoot = getLibraryRoot();
  const tmpDir = mkdtempSync(join(tmpdir(), "pivot-ui-git-import-"));
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("git", ["clone", "--depth", "1", body.url, tmpDir], { timeout: 60000 });
    const { discoverSkillsRecursive } = await import("@/lib/skill-library");
    const all = discoverSkillsRecursive(tmpDir);
    const selected = body.selectedKeys?.length
      ? all.filter((s) => body.selectedKeys!.includes(s.skillKey))
      : all;
    const written: Awaited<ReturnType<typeof writeLibrarySkill>>[] = [];
    for (const s of selected) {
      written.push(writeLibrarySkill(libraryRoot, s.skillKey, s.sourceDir));
    }
    return { discovered: all, imported: written };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// POST /api/skill-library/import
// body: { source: "market", package: string } |
//       { source: "local", path: string, targetKey?: string } |
//       { source: "git", url: string, selectedKeys?: string[] }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { source?: string } & Record<string, unknown>;
    const source = body.source;
    if (source === "market") {
      const pkg = typeof body.package === "string" ? body.package : "";
      if (!pkg.trim()) return NextResponse.json({ error: "package required" }, { status: 400 });
      const result = await marketImport(pkg);
      return NextResponse.json(result);
    }
    if (source === "local") {
      const path = typeof body.path === "string" ? body.path : "";
      const targetKey = typeof body.targetKey === "string" ? body.targetKey : undefined;
      if (!path.trim()) return NextResponse.json({ error: "path required" }, { status: 400 });
      const result = await localImport(path, targetKey);
      return NextResponse.json(result);
    }
    if (source === "git") {
      const gitBody = body as unknown as GitImportBody;
      const url = typeof gitBody.url === "string" ? gitBody.url : "";
      if (!url.trim()) return NextResponse.json({ error: "url required" }, { status: 400 });
      const result = await gitImport(gitBody);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "source must be market/local/git" }, { status: 400 });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    return NextResponse.json({ error: output || err.message || String(e) }, { status: 500 });
  }
}