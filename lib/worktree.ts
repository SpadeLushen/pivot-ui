import { execFile } from "child_process";
import { existsSync, mkdirSync, realpathSync } from "fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./allowed-roots";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  return { projectRoot: repoRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

// Session grouping only needs linked checkout metadata. Ordinary checkouts and
// nested folders keep their own cwd, so no repository discovery is necessary.
export async function resolveSessionProject(cwd: string): Promise<Pick<ProjectInfo, "projectRoot" | "branch" | "isWorktree">> {
  const standalone = { projectRoot: cwd, branch: null, isWorktree: false };
  const marker = join(cwd, ".git");
  try {
    if ((await stat(marker)).isFile()) return resolveProject(cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && dirname(cwd).endsWith("-worktrees") && !existsSync(cwd)) {
      return inferRemovedWorktree(cwd) ?? standalone;
    }
  }
  return standalone;
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
      cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      return info;
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDir, gitDir, toplevel, ref] = out.split("\n").map((l) => l.trim());
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    let realCwd = cwd;
    try { realCwd = realpathSync(cwd); } catch { /* keep as-is */ }
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = relative(toplevel, realCwd) === "";
    const isWorktreeTopLevel = gitDir !== commonDir && isTopLevel;
    info = {
      projectRoot: isWorktreeTopLevel ? dirname(normalize(commonDir)) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }

  cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(commonDir);
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(current.path)) {
        worktrees.push({
          path: normalize(current.path),
          branch: current.branch ?? null,
          isMain: worktrees.length === 0,
        });
      }
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return worktrees;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  try {
    const { getAgentDir, ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
    const trust = new ProjectTrustStore(getAgentDir());
    // Both checkouts already share global policy. Copy a saved grant only
    // when the new path has no decision of its own or from its ancestors.
    if (trust.get(repoRoot) === true && trust.get(worktreePath) === null) {
      trust.set(worktreePath, true);
    }
  } catch (error) {
    throw new Error(`Worktree created at ${worktreePath}, but trust inheritance failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: worktreePath, branch: trimmed };
}

async function removableWorktree(cwd: string, worktreePath: string) {
  const worktrees = await listWorktrees(cwd);
  const target = worktrees.find((w) => w.path === normalize(worktreePath));
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  return target;
}

export async function inspectRemoval(cwd: string, path: string) {
  const target = await removableWorktree(cwd, path);
  const [dirty, status] = await Promise.all([
    hasChanges(target.path),
    target.branch ? inspectBranch(cwd, target.branch) : countUnpushed(target.path, "HEAD"),
  ]);
  return { ...status, branch: target.branch, dirty };
}

async function countUnpushed(cwd: string, ref: string, upstream?: string) {
  // Without a live upstream, count commits not on any known remote branch.
  const args = upstream ? [`${upstream}..${ref}`] : [ref, "--not", "--remotes"];
  return { unpushed: Number(await git(cwd, ["rev-list", "--count", ...args, "--"])) };
}

export async function inspectBranch(cwd: string, branch: string) {
  const ref = `refs/heads/${branch}`;
  await git(cwd, ["check-ref-format", ref]);
  const info = await git(cwd, ["for-each-ref", "--format=%(refname)%09%(upstream)%09%(upstream:remotename)%09%(upstream:track,nobracket)%09%(worktreepath)", ref]);
  const row = info.split("\n").find(line => line.split("\t")[0] === ref);
  if (!row) throw new Error("Local branch no longer exists");
  const [, upstream, remote, tracking, checkout] = row.split("\t");
  return { ...await countUnpushed(cwd, ref, remote !== "." && tracking !== "gone" ? upstream : undefined),
    branch, dirty: false, checkedOut: Boolean(checkout) };
}

async function hasChanges(path: string) {
  return (await git(path, ["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"])).length > 0;
}

export async function deleteLocalBranch(cwd: string, branch: string) {
  await git(cwd, ["check-ref-format", `refs/heads/${branch}`]);
  // Git refuses to delete a checked-out branch, even with -D.
  await git(cwd, ["branch", "-D", "--", branch]);
}

export async function removeWorktree(cwd: string, worktreePath: string, deleteBranch?: string) {
  const target = await removableWorktree(cwd, worktreePath);
  if (deleteBranch !== undefined && target.branch !== deleteBranch) {
    throw new Error("Cannot delete the branch: the checkout changed.");
  }
  const root = await getRepoRoot(cwd);
  if (await hasChanges(target.path)) {
    throw new Error("Worktree contains modified or untracked files");
  }
  try {
    await git(root, ["worktree", "remove", "--", target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
  if (deleteBranch) {
    try { await deleteLocalBranch(root, deleteBranch); }
    catch (error) { return { branchError: extractGitError(error) }; }
  }
  return {};
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
