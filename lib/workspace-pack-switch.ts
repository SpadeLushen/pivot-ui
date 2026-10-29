import { existsSync, readFileSync, rmSync } from "node:fs";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SkillPack, SkillPacksConfig } from "./skill-packs-store";
import { collectActiveNativeMcpServers, readWorkspaceState, unionSkillRefs, type WorkspaceState, type AppliedPack } from "./workspace-packs";
import { preview, copyPlanSkills, withWorkspaceLock, WorkspaceRevisionConflict, WorkspacePlanBlocked, type WorkspacePackPlan } from "./skill-pack-apply";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { loadNativeMcpConfig } from "./native-mcp-config";
import { NativeMcpConfigurationUnavailable } from "./mcp-config-phase";
import { canonicalWorkspace, workspaceKey, workspaceFile, readPackFile, savePackFile, formatPackFile, type PackFile } from "./workspace-pack-files";

const nativeSnapshots = new WeakMap<WorkspacePackPlan, PackFile>();
function nativeNames(pack: SkillPack): string[] {
  if (pack.mcpServers.length && pack.nativeMcpServers === undefined) throw new NativeMcpConfigurationUnavailable("This Pack has legacy Library MCP references. Select native servers in Packs and save before changing its workspace switch.");
  return pack.nativeMcpServers ?? [];
}
function resolvePacks(config: SkillPacksConfig, ids: string[], state: WorkspaceState): SkillPack[] {
  return ids.map((id) => {
    const defined = config.packs.find((pack) => pack.id === id);
    if (defined) return defined;
    const saved = [...state.appliedPacks, ...(state.disabledPacks ?? [])].find((pack) => pack.packId === id);
    if (!saved) throw new Error(`Unknown Pack: ${id}`);
    return { id, name: id, description: "", skills: saved.receipt.installed,
      mcpServers: saved.receipt.mcpServers, nativeMcpServers: saved.receipt.nativeMcpServers };
  });
}
function validSkillKey(key: string): void {
  if (!key || key === "." || key === ".." || /[/\\\0]/.test(key)) throw new Error("Invalid Pack skill key");
}

async function buildPlan(cwd: string, libraryRoot: string, ids: string[], config: SkillPacksConfig, state: WorkspaceState): Promise<WorkspacePackPlan> {
  const targetPackIds = [...new Set(ids)];
  const packs = resolvePacks(config, targetPackIds, state);
  const touched = resolvePacks(config, [...new Set([...targetPackIds, ...state.appliedPacks.map((p) => p.packId)])], state);
  for (const pack of touched) nativeNames(pack); // Preserve the explicit native-binding requirement for legacy Packs.
  const names = [...new Set([...collectActiveNativeMcpServers(state, config), ...packs.flatMap(nativeNames)])];
  for (const pack of packs) for (const ref of pack.skills) validSkillKey(ref.skillKey);
  const newIds = targetPackIds.filter((id) => !state.appliedPacks.some((p) => p.packId === id));
  const effectiveConfig = { ...config, packs };
  const skillPlan = preview(cwd, libraryRoot, newIds, effectiveConfig);
  skillPlan.versionConflicts = unionSkillRefs(packs).conflicts;
  const mcp: WorkspacePackPlan["mcp"] = { toConfigure: [], skipped: [], blocked: [], versionConflicts: [], canApply: true };
  if (packs.some((p) => p.skills.length) || names.length) {
    const agentDir = getAgentDir();
    if (!nativeProjectTrusted(cwd, agentDir, SettingsManager.create(cwd, agentDir))) {
      mcp.blocked.push({ serverKey: "", reason: "untrusted_project" });
    }
  }
  let nativeFile: PackFile | undefined;
  if (names.length) {
    nativeFile = readPackFile(workspaceFile(cwd, "mcp.json"));
    const entries = nativeFile.value.mcpServers;
    const native = await loadNativeMcpConfig(cwd);
    for (const name of names) {
      const configured = native.servers.find((server) => server.name === name);
      const hasProjectEntry = entries && typeof entries === "object" && Object.hasOwn(entries, name);
      if (!configured || (hasProjectEntry && configured.scope !== "project" && configured.override !== native.projectConfig)) {
        if (configured || packs.some((pack) => nativeNames(pack).includes(name))) mcp.blocked.push({ serverKey: name, reason: "missing_native_server" });
      } else mcp.toConfigure.push({ serverKey: name, configHash: "" });
    }
  }
  mcp.canApply = mcp.blocked.length === 0;
  const plan = { ...skillPlan, workspaceRevision: state.revision, targetPackIds, mcp, mcpRelevant: names.length > 0,
    canApply: skillPlan.blocked.length === 0 && skillPlan.versionConflicts.length === 0 && mcp.canApply };
  if (nativeFile) nativeSnapshots.set(plan, nativeFile);
  return plan;
}

export async function previewWorkspacePackSwitch(cwd: string, libraryRoot: string, ids: string[], config: SkillPacksConfig) {
  cwd = canonicalWorkspace(cwd);
  readPackFile(workspaceFile(cwd, "skill-packs.json"));
  return buildPlan(cwd, libraryRoot, ids, config, readWorkspaceState({ cwd }));
}

function resourceFiles(cwd: string, state: WorkspaceState, packs: SkillPack[], managedSkills: string[], mcpNames: string[], nativeFile?: PackFile) {
  const settings = readPackFile(workspaceFile(cwd, "settings.json"));
  if (settings.value.skills !== undefined && (!Array.isArray(settings.value.skills) || settings.value.skills.some((p) => typeof p !== "string"))) {
    throw new Error("Invalid workspace skills settings");
  }
  const activeSkills = new Set(packs.flatMap((pack) => pack.skills.map((ref) => ref.skillKey.toLowerCase())));
  const patterns = ((settings.value.skills ?? []) as string[]).filter((p) => !state.skillExclusions?.includes(p));
  const exclusions: string[] = [];
  for (const key of managedSkills) {
    validSkillKey(key);
    workspaceFile(cwd, `skills/${key}`);
    const pattern = `-skills/${key}`;
    if (!activeSkills.has(key.toLowerCase()) && !patterns.includes(pattern)) exclusions.push(pattern);
  }
  const nextSettings = { ...settings.value, skills: [...patterns, ...exclusions] };
  const changes: { file: PackFile; value: Record<string, unknown> }[] = [];
  if (JSON.stringify(nextSettings.skills) !== JSON.stringify(settings.value.skills ?? [])) changes.push({ file: settings, value: nextSettings });
  if (mcpNames.length) {
    const mcp = nativeFile ?? readPackFile(workspaceFile(cwd, "mcp.json"));
    const servers = mcp.value.mcpServers ?? {};
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("Invalid native MCP server map");
    const nextServers = new Map(Object.entries(servers as Record<string, unknown>));
    const active = new Set(packs.flatMap(nativeNames));
    for (const name of mcpNames) {
      const previous = nextServers.get(name) ?? {};
      if (!previous || typeof previous !== "object" || Array.isArray(previous)) throw new Error("Invalid native MCP entry");
      nextServers.set(name, { ...previous, enabled: active.has(name) });
    }
    const nextMcp = { ...mcp.value, mcpServers: Object.fromEntries(nextServers) };
    if (JSON.stringify(nextMcp) !== JSON.stringify(mcp.value)) changes.push({ file: mcp, value: nextMcp });
  }
  return { changes, exclusions, watched: [settings, ...(nativeFile ? [nativeFile] : [])] };
}

function makeState(state: WorkspaceState, packs: SkillPack[], plan: WorkspacePackPlan, managedSkills: string[], names: string[], exclusions: string[]): WorkspaceState {
  const saved = [...state.appliedPacks, ...(state.disabledPacks ?? [])];
  const appliedPacks: AppliedPack[] = packs.map((pack) => {
    const prior = saved.find((p) => p.packId === pack.id);
    const installed = pack.skills.filter((ref) => managedSkills.some((key) => key.toLowerCase() === ref.skillKey.toLowerCase()));
    const skipped = plan.skipped.filter((ref) => pack.skills.some((s) => s.skillKey === ref.skillKey) && !managedSkills.includes(ref.skillKey));
    return { packId: pack.id, status: skipped.length ? "partial" : prior?.status ?? "full",
      receipt: { appliedAt: prior?.receipt.appliedAt ?? new Date().toISOString(), installed,
        mcpServers: prior?.receipt.mcpServers ?? [], nativeMcpServers: nativeNames(pack) } };
  });
  return { ...state, revision: state.revision + 1, appliedPacks,
    disabledPacks: saved.filter((p) => !packs.some((pack) => pack.id === p.packId)),
    skippedConflicts: plan.skipped.filter((ref) => !managedSkills.includes(ref.skillKey)).flatMap((ref) => packs
      .filter((pack) => pack.skills.some((s) => s.skillKey === ref.skillKey))
      .map((pack) => ({ packId: pack.id, ...ref }))),
    managedSkillKeys: managedSkills, managedNativeMcpServers: names, skillExclusions: exclusions };
}

function commitFiles(changes: { file: PackFile; value: Record<string, unknown> }[], watched: PackFile[], beforeStateWrite?: () => void) {
  const writes = changes.map(({ file, value }) => ({ file, text: formatPackFile(file, value) }));
  for (const file of [...writes.map((write) => write.file), ...watched]) {
    const current = existsSync(file.path) ? readFileSync(file.path, "utf8") : null;
    if (current !== file.before) throw new Error("Workspace configuration changed; retry the Pack switch");
  }
  const committed: typeof writes = [];
  try {
    for (const write of writes) {
      if (write === writes.at(-1)) beforeStateWrite?.();
      savePackFile(write.file.path, write.text);
      committed.push(write);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const { file, text } of committed.reverse()) {
      try {
        if (readFileSync(file.path, "utf8") !== text) throw new Error("Configuration was edited externally");
        if (file.before === null) rmSync(file.path); else savePackFile(file.path, file.before);
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Pack rollback conflict; external edits were preserved");
    throw error;
  }
}

export async function applyWorkspacePackSwitch(cwd: string, libraryRoot: string, ids: string[], revision: number, config: SkillPacksConfig,
  deps: { copyFn?: (source: string, dest: string) => void; beforeStateWrite?: () => void } = {}) {
  cwd = canonicalWorkspace(cwd);
  return withWorkspaceLock(workspaceKey(cwd), async () => {
    const stateFile = readPackFile(workspaceFile(cwd, "skill-packs.json"));
    const state = readWorkspaceState({ cwd });
    if (state.revision !== revision) throw new WorkspaceRevisionConflict(state.revision);
    const plan = await buildPlan(cwd, libraryRoot, ids, config, state);
    if (!plan.canApply) throw new WorkspacePlanBlocked(plan);
    const packs = resolvePacks(config, plan.targetPackIds, state);
    const managed = [...new Set([...(state.managedSkillKeys ?? []), ...[...state.appliedPacks, ...(state.disabledPacks ?? [])].flatMap((p) => p.receipt.installed.map((s) => s.skillKey)),
      ...plan.toInstall.map((s) => s.skillKey)])];
    const names = [...new Set([...collectActiveNativeMcpServers(state, config), ...packs.flatMap(nativeNames)])];
    const resources = resourceFiles(cwd, state, packs, managed, plan.mcp.toConfigure.map((s) => s.serverKey), nativeSnapshots.get(plan));
    const next = makeState(state, packs, plan, managed, names, resources.exclusions);
    const copied = copyPlanSkills(cwd, libraryRoot, plan, deps);
    try {
      commitFiles([...resources.changes, { file: stateFile, value: { ...stateFile.value, ...next } }], resources.watched, deps.beforeStateWrite);
    } catch (error) {
      for (const path of copied.created) rmSync(path, { recursive: true, force: true });
      throw error;
    }
    return { plan, installed: copied.installed };
  });
}
