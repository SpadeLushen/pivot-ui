import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { computeSkillHash } from "./content-hash";
import { workspaceFile } from "./workspace-pack-files";

const SKILL_FILE = "SKILL.md";

/** Directory under a library root where skill copies live. */
export function getLibrarySkillsDir(libraryRoot: string): string {
  return join(libraryRoot, ".pi", "skills");
}

export interface LibrarySkill {
  /** Directory name (skillKey); case-insensitive for matching. */
  skillKey: string;
  /** Display name from SKILL.md frontmatter, falling back to skillKey. */
  name: string;
  /** Description from frontmatter. */
  description: string;
  /** Absolute skill directory (`<libraryRoot>/.pi/skills/<skillKey>`). */
  baseDir: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Deterministic content hash of the skill directory. */
  contentHash: string;
}

/** A skill discovered in an arbitrary directory (local import / git clone). */
export interface DiscoveredSkill {
  /** Proposed skillKey: basename of the directory containing SKILL.md. */
  skillKey: string;
  name: string;
  description: string;
  /** Absolute dir containing SKILL.md. */
  sourceDir: string;
  /** Path of SKILL.md relative to the scan root (empty for single-dir scan). */
  relPath: string;
  contentHash: string;
}

/** One pack that references a skillKey. Used to refuse deletion of in-use skills. */
export interface PackReference {
  packId: string;
  packName: string;
}

type HashFn = (skillDir: string) => string;

interface ReadOpts {
  hashFn?: HashFn;
}

function readMeta(filePath: string): { name?: string; description: string } {
  try {
    const content = readFileSync(filePath, "utf8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    return {
      name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
      description:
        typeof frontmatter.description === "string" ? frontmatter.description : "",
    };
  } catch {
    return { description: "" };
  }
}

function lowerKey(skillKey: string): string {
  return skillKey.toLowerCase();
}

function buildLibrarySkill(
  skillKey: string,
  baseDir: string,
  filePath: string,
  hashFn: HashFn,
): LibrarySkill {
  const meta = readMeta(filePath);
  return {
    skillKey,
    name: meta.name || skillKey,
    description: meta.description,
    baseDir,
    filePath,
    contentHash: hashFn(baseDir),
  };
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Never follow library links outside the canonical .pi/skills directory. */
function isLibrarySkillPath(libraryRoot: string, path: string): boolean {
  return isWithin(realpathSync(path), getLibrarySkillsDir(realpathSync(libraryRoot)));
}

function librarySkillDirectories(libraryRoot: string): { skillKey: string; baseDir: string }[] {
  const out: { skillKey: string; baseDir: string }[] = [];
  const dir = getLibrarySkillsDir(libraryRoot);
  if (!existsSync(dir) || realpathSync(dir) !== getLibrarySkillsDir(realpathSync(libraryRoot))) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const baseDir = join(dir, entry.name);
    if (!existsSync(baseDir) || !isLibrarySkillPath(libraryRoot, baseDir)) continue;
    if (!statSync(baseDir).isDirectory()) continue;
    out.push({ skillKey: entry.name, baseDir });
  }
  return out;
}

function hasSkillFile(baseDir: string): boolean {
  const file = join(baseDir, SKILL_FILE);
  return existsSync(file) && statSync(file).isFile()
    && isWithin(realpathSync(file), realpathSync(baseDir));
}

/** List .pi/skills, deduplicated by case-insensitive skillKey. */
export function scanLibrary(libraryRoot: string, opts: ReadOpts = {}): LibrarySkill[] {
  const hashFn = opts.hashFn ?? computeSkillHash;
  const skills = new Map<string, LibrarySkill>();
  for (const { skillKey, baseDir } of librarySkillDirectories(libraryRoot)) {
    const key = lowerKey(skillKey);
    if (skills.has(key) || !hasSkillFile(baseDir)) continue;
    const resolvedDir = realpathSync(baseDir);
    skills.set(key, buildLibrarySkill(skillKey, resolvedDir, join(resolvedDir, SKILL_FILE), hashFn));
  }
  return [...skills.values()].sort((a, b) => a.skillKey.localeCompare(b.skillKey));
}

/** Get a single library skill by skillKey (case-insensitive). */
export function getLibrarySkill(
  libraryRoot: string,
  skillKey: string,
  opts: ReadOpts = {},
): LibrarySkill | null {
  const hashFn = opts.hashFn ?? computeSkillHash;
  const target = lowerKey(skillKey);
  for (const entry of librarySkillDirectories(libraryRoot)) {
    if (lowerKey(entry.skillKey) !== target || !hasSkillFile(entry.baseDir)) continue;
    const resolvedDir = realpathSync(entry.baseDir);
    return buildLibrarySkill(entry.skillKey, resolvedDir, join(resolvedDir, SKILL_FILE), hashFn);
  }
  return null;
}

/** True when a skillKey already exists in the canonical library directory. */
export function librarySkillExists(libraryRoot: string, skillKey: string): boolean {
  const target = lowerKey(skillKey);
  return librarySkillDirectories(libraryRoot).some((entry) => lowerKey(entry.skillKey) === target);
}

/**
 * Discover a single skill in `dir` — the directory must contain SKILL.md as a
 * direct child. Throws if it does not.
 */
export function discoverSkillDir(dir: string, opts: ReadOpts = {}): DiscoveredSkill {
  const hashFn = opts.hashFn ?? computeSkillHash;
  const skillMd = join(dir, SKILL_FILE);
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) {
    throw new Error(`Directory does not contain a direct SKILL.md: ${dir}`);
  }
  const meta = readMeta(skillMd);
  const skillKey = basename(dir);
  return {
    skillKey,
    name: meta.name || skillKey,
    description: meta.description,
    sourceDir: dir,
    relPath: SKILL_FILE,
    contentHash: hashFn(dir),
  };
}

/** Find every SKILL.md under `rootDir`, recursively (git import preview). */
export function discoverSkillsRecursive(
  rootDir: string,
  opts: ReadOpts = {},
): DiscoveredSkill[] {
  const hashFn = opts.hashFn ?? computeSkillHash;
  const out: DiscoveredSkill[] = [];
  walk(rootDir, rootDir, out, hashFn);
  return out;
}

function walk(dir: string, root: string, out: DiscoveredSkill[], hashFn: HashFn): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, root, out, hashFn);
    } else if (entry.isFile() && entry.name === SKILL_FILE) {
      const skillDir = dirname(abs);
      const meta = readMeta(abs);
      out.push({
        skillKey: basename(skillDir),
        name: meta.name || basename(skillDir),
        description: meta.description,
        sourceDir: skillDir,
        relPath: relative(root, abs).split(sep).join("/"),
        contentHash: hashFn(skillDir),
      });
    }
  }
}

interface WriteOpts {
  overwrite?: boolean;
  hashFn?: HashFn;
}

/** Copy `sourceDir` into the library under `skillKey`. Returns the new entry. */
export function writeLibrarySkill(
  libraryRoot: string,
  skillKey: string,
  sourceDir: string,
  opts: WriteOpts = {},
): LibrarySkill {
  const hashFn = opts.hashFn ?? computeSkillHash;
  if (!skillKey || skillKey.startsWith(".") || /[/\\\\:\x00]/.test(skillKey)) {
    throw new Error("Invalid library skill key");
  }
  if (librarySkillExists(libraryRoot, skillKey) && !opts.overwrite) {
    throw new Error(`A skill named "${skillKey}" already exists in the library`);
  }
  mkdirSync(libraryRoot, { recursive: true });
  const dest = workspaceFile(libraryRoot, join("skills", skillKey));
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = join(dirname(dest), `.skill-import-${randomUUID()}`);
  try {
    cpSync(sourceDir, tmp, { recursive: true });
    const skill = buildLibrarySkill(skillKey, tmp, join(tmp, SKILL_FILE), hashFn);
    if (existsSync(dest)) {
      if (!opts.overwrite) throw new Error(`A skill named "${skillKey}" already exists in the library`);
      rmSync(dest, { recursive: true, force: true });
    }
    renameSync(tmp, dest);
    return { ...skill, baseDir: dest, filePath: join(dest, SKILL_FILE) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
  referencedBy?: PackReference[];
}

/** Remove a library skill, refusing if any pack still references it. */
export function deleteLibrarySkill(
  libraryRoot: string,
  skillKey: string,
  referencedBy: PackReference[],
): DeleteResult {
  if (referencedBy.length > 0) {
    return {
      ok: false,
      error: `Skill "${skillKey}" is referenced by ${referencedBy.length} pack(s)`,
      referencedBy,
    };
  }
  const target = lowerKey(skillKey);
  const entries = librarySkillDirectories(libraryRoot)
    .filter((entry) => lowerKey(entry.skillKey) === target);
  // Remove the CLI's receipt as well so a reinstall starts cleanly. Preserve
  // unrelated entries and fields; parse before deleting to surface corruption.
  const lockPath = join(libraryRoot, "skills-lock.json");
  let updatedLock: string | undefined;
  if (existsSync(lockPath)) {
    if (realpathSync(lockPath) !== join(realpathSync(libraryRoot), "skills-lock.json")) {
      return { ok: false, error: "Skills lock file escapes the library root" };
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      skills?: Record<string, unknown>;
    };
    if (lock.skills && typeof lock.skills === "object" && !Array.isArray(lock.skills)) {
      const keys = Object.keys(lock.skills).filter((key) => lowerKey(key) === target);
      for (const key of keys) delete lock.skills[key];
      if (keys.length > 0) updatedLock = `${JSON.stringify(lock, null, 2)}\n`;
    }
  }
  // Remove matching copies only from the canonical .pi/skills directory.
  for (const entry of entries) rmSync(entry.baseDir, { recursive: true, force: true });
  if (updatedLock !== undefined) {
    const tmp = `${lockPath}.tmp-${randomUUID()}`;
    try {
      writeFileSync(tmp, updatedLock, { encoding: "utf8", flag: "wx" });
      renameSync(tmp, lockPath);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  return { ok: true };
}