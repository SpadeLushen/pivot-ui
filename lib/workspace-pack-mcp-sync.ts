import { join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { readConfig, getDefaultConfigPath, packDefinitionsRevision } from "./skill-packs-store";
import { collectActiveNativeMcpServers, collectAppliedNativeMcpServers, activeNativeMcpReferences, nativeMcpDefinitionRevision, readWorkspaceState } from "./workspace-packs";
import { withWorkspaceLock } from "./skill-pack-apply";
import { canonicalWorkspace, workspaceKey, workspaceFile, readPackFile, commitPackFiles, releasePackMcpEnabled, PackFileConflict, type PackFile } from "./workspace-pack-files";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { loadNativeMcpConfig } from "./native-mcp-config";
import { notifyWorkspacePacks } from "./workspace-pack-events";
import { notifyMcpConfigurationChanged } from "./session-resource-events";

export interface PackMcpSyncResult {
  revision: number;
  definitionsRevision: string;
  pendingServers: string[];
  trusted: boolean;
  changed: boolean;
}

export async function reconcileWorkspacePackMcp(cwd: string): Promise<PackMcpSyncResult> {
  cwd = canonicalWorkspace(cwd);
  return withWorkspaceLock(workspaceKey(cwd), () => reconcileWorkspacePackMcpLocked(cwd));
}

/** Caller must hold the canonical workspace lock (also used by switches and MCP edits). */
export async function reconcileWorkspacePackMcpLocked(cwd: string): Promise<PackMcpSyncResult> {
  for (let attempt = 0; ; attempt++) {
    try { return await reconcile(cwd); }
    catch (error) { if (!(error instanceof PackFileConflict) || attempt >= 2) throw error; }
  }
}

async function reconcile(cwd: string): Promise<PackMcpSyncResult> {
  const definitionFile = readPackFile(getDefaultConfigPath());
  const config = readConfig({ strict: true });
  const stateFile = readPackFile(workspaceFile(cwd, "skill-packs.json"));
  const state = readWorkspaceState({ cwd, strict: true });
  const agentDir = getAgentDir(), settings = SettingsManager.create(cwd, agentDir);
  if (settings.drainErrors().length) throw new Error("Unable to read workspace trust settings");
  const trusted = nativeProjectTrusted(cwd, agentDir, settings);
  const result: PackMcpSyncResult = { revision: state.revision, definitionsRevision: packDefinitionsRevision(config),
    pendingServers: [], trusted, changed: false };
  if (!trusted || !state.appliedPacks.length) return result;
  const previous = collectAppliedNativeMcpServers(state);
  const desired = collectActiveNativeMcpServers(state, config);
  const desiredByPack = activeNativeMcpReferences(state, config);
  const definitionRevision = nativeMcpDefinitionRevision(desiredByPack);
  let mcp: PackFile;
  try { mcp = readPackFile(workspaceFile(cwd, "mcp.json")); }
  catch { throw new Error("Unable to read workspace MCP configuration; repair .pi/mcp.json before synchronizing Packs"); }
  const entries = mcp.value.mcpServers ?? {};
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Invalid native MCP server map");
  const servers = new Map(Object.entries(entries as Record<string, unknown>));
  for (const name of previous) if (!desired.has(name)) releasePackMcpEnabled(servers, name);
  const applied = new Set([...previous].filter((name) => desired.has(name)));
  const additions = [...desired].filter((name) => !previous.has(name));
  const watched = [definitionFile, stateFile, mcp];
  if (additions.length) {
    // Pure SDK validation only; never start MCP or evaluate credential commands here.
    let native: Awaited<ReturnType<typeof loadNativeMcpConfig>> | undefined;
    try {
      watched.push(readPackFile(join(agentDir, "mcp.json")));
      native = await loadNativeMcpConfig(cwd);
    } catch { /* Invalid additions must not block unrelated releases. Retry on the next activation. */ }
    for (const name of additions) {
      if (!native) { result.pendingServers.push(name); continue; }
      const server = native.servers.find((entry) => entry.name === name);
      const local = servers.get(name);
      const invalidOverride = servers.has(name) && (!local || typeof local !== "object" || Array.isArray(local)
        || (server?.scope !== "project" && server?.override !== native.projectConfig));
      if (!server || invalidOverride) { result.pendingServers.push(name); continue; }
      servers.set(name, { ...(local as Record<string, unknown> | undefined), enabled: true });
      applied.add(name);
    }
  }
  result.pendingServers.sort();
  const rawPacks = stateFile.value.appliedPacks as typeof state.appliedPacks;
  const appliedPacks = rawPacks.map((pack) => ({ ...pack,
    receipt: { ...pack.receipt, nativeMcpServers: desiredByPack.get(pack.packId)!.filter((name) => applied.has(name)) } }));
  const nativeMcpSync = { definitionRevision, pendingServers: result.pendingServers };
  const stateChanged = JSON.stringify(appliedPacks) !== JSON.stringify(rawPacks)
    || JSON.stringify(nativeMcpSync) !== JSON.stringify(state.nativeMcpSync);
  const nextMcp = { ...mcp.value, mcpServers: Object.fromEntries(servers) };
  const mcpChanged = JSON.stringify(entries) !== JSON.stringify(nextMcp.mcpServers);
  if (!stateChanged && !mcpChanged) return result;
  // Trust can change while SDK validation is awaited. Never commit with stale permission.
  const currentSettings = SettingsManager.create(cwd, agentDir);
  if (currentSettings.drainErrors().length || !nativeProjectTrusted(cwd, agentDir, currentSettings)) {
    throw new Error("Workspace trust changed during Pack synchronization");
  }
  result.revision++;
  commitPackFiles([
    ...(mcpChanged ? [{ file: mcp, value: nextMcp }] : []),
    { file: stateFile, value: { ...stateFile.value, revision: result.revision, appliedPacks, nativeMcpSync } },
  ], watched);
  result.changed = true;
  if (mcpChanged) notifyMcpConfigurationChanged(cwd);
  notifyWorkspacePacks(cwd);
  return result;
}
