import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { withWorkspaceLock } from "./skill-pack-apply";
import { workspaceFile, type PackFile } from "./workspace-pack-files";
import { readWorkspaceTools, ToolSettingsError } from "./workspace-tools";
import { codemodeValues, orchestrationFiles, orchestrationRevision } from "./tool-orchestration";
import { restoreToolSettingsFile, saveToolSettingsFile } from "./tool-settings-files";
import { notifyResourceConfigurationChanged } from "./session-resource-events";
import { TOOL_EXPOSURES, type ToolRulePatch, type CodemodePatch, type ToolSettingsTarget, type ToolExposure } from "./tool-settings-types";

export interface ToolSettingsChanges {
  target: ToolSettingsTarget;
  revision: string;
  orchestrationRevision: string;
  tools: Record<string, ToolRulePatch>;
  codemode?: CodemodePatch;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function mergePatch(value: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...value };
  for (const [key, item] of Object.entries(patch)) {
    if (item === null) delete next[key]; else next[key] = item;
  }
  return next;
}
function inheritMatchingFields(patch: Record<string, unknown>, inherited: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) =>
    [key, value !== undefined && value === inherited[key] ? null : value]));
}
function conflict(): never { throw new ToolSettingsError("tools.settingsConflict", 409); }

function pendingFiles(rules: ReturnType<typeof readWorkspaceTools>, settings: ReturnType<typeof orchestrationFiles>, change: ToolSettingsChanges,
  defaultExposures: Readonly<Record<string, ToolExposure>>) {
  const pending: { file: PackFile; value: Record<string, unknown> }[] = [];
  if (Object.keys(change.tools).length) {
    const file = change.target === "global" ? rules.globalFile : rules.file;
    const tools = { ...file.value.tools as Record<string, unknown> };
    for (const [name, patch] of Object.entries(change.tools)) {
      const inherited = { enabled: rules.globalRules[name]?.enabled ?? true,
        exposure: rules.globalRules[name]?.exposure ?? (Object.hasOwn(defaultExposures, name) ? defaultExposures[name] : undefined) };
      const edited = change.target === "workspace" ? inheritMatchingFields(patch, inherited) : patch;
      const next = mergePatch(object(tools[name]) ? tools[name] : {}, edited);
      if (Object.keys(next).length) tools[name] = next; else delete tools[name];
    }
    pending.push({ file, value: { ...file.value, version: 1, tools } });
  }
  if (change.codemode) {
    const file = change.target === "global" ? settings.global : settings.project;
    const raw = file.value.codemode;
    if (raw !== undefined && !object(raw)) throw new ToolSettingsError("tools.settingsInvalid", 409);
    const edited = change.target === "workspace"
      ? inheritMatchingFields(change.codemode, codemodeValues(settings.global.value)) : change.codemode;
    const codemode = mergePatch(object(raw) ? raw : {}, edited);
    const value = { ...file.value };
    if (Object.keys(codemode).length) value.codemode = codemode; else delete value.codemode;
    pending.push({ file, value });
  }
  return pending;
}

export async function saveToolSettings(cwd: string, change: ToolSettingsChanges,
  validateOwner: () => Promise<Readonly<Record<string, ToolExposure>> | void>): Promise<void> {
  validateToolSettingsChanges(change);
  try { await withWorkspaceLock(cwd, async () => {
    const defaultExposures = await validateOwner() ?? {};
    const initial = orchestrationFiles(cwd, false);
    const trusted = new ProjectTrustStore(getAgentDir()).get(cwd) ?? initial.global.value.defaultProjectTrust === "always";
    if (change.target === "workspace" && !trusted) throw new ToolSettingsError("tools.trustRequired", 403);
    const settings = orchestrationFiles(cwd, trusted), rules = readWorkspaceTools(cwd, trusted);
    if ((change.target === "global" ? rules.globalRevision : rules.revision) !== change.revision ||
        orchestrationRevision(settings, trusted, change.target) !== change.orchestrationRevision) conflict();
    const paths = [settings.global.path, rules.globalFile.path,
      ...(change.target === "workspace" ? [settings.project.path, rules.file.path] : [])];
    const releases: (() => void)[] = [];
    try {
      // No async work while these locks are held: SDK reads use synchronous locks too.
      for (const path of [...new Set(paths)].sort()) {
        mkdirSync(dirname(path), { recursive: true });
        try { releases.push(lockfile.lockSync(path, { realpath: false })); }
        catch { throw new ToolSettingsError("tools.settingsBusy", 409); }
      }
      commitChanges(cwd, trusted, change, defaultExposures);
    } finally { for (const release of releases.reverse()) release(); }
  }); } catch (error) {
    if (error instanceof ToolSettingsError && error.message === "tools.rollbackFailed") {
      notifyResourceConfigurationChanged(change.target === "global" ? undefined : cwd);
    }
    throw error;
  }
  notifyResourceConfigurationChanged(change.target === "global" ? undefined : cwd);
}

function commitChanges(cwd: string, trusted: boolean, change: ToolSettingsChanges,
  defaultExposures: Readonly<Record<string, ToolExposure>>): void {
  const settings = orchestrationFiles(cwd, trusted), rules = readWorkspaceTools(cwd, trusted);
  const nowTrusted = new ProjectTrustStore(getAgentDir()).get(cwd) ?? settings.global.value.defaultProjectTrust === "always";
  if (nowTrusted !== trusted || (change.target === "global" ? rules.globalRevision : rules.revision) !== change.revision ||
      orchestrationRevision(settings, trusted, change.target) !== change.orchestrationRevision) conflict();
  const pending = pendingFiles(rules, settings, change, defaultExposures), written: PackFile[] = [];
  try {
    for (const { file, value } of pending) {
      if (change.target === "workspace") workspaceFile(cwd, file === rules.file ? "pivot-tools.json" : "settings.json");
      saveToolSettingsFile(file, value); written.push(file);
    }
  } catch (error) {
    let failed = false;
    for (const file of written.reverse()) {
      try { restoreToolSettingsFile(file); } catch { failed = true; }
    }
    if (failed) throw new ToolSettingsError("tools.rollbackFailed", 500);
    throw error;
  }
}

export function validateToolSettingsChanges(change: ToolSettingsChanges): void {
  if (!change || !["global", "workspace"].includes(change.target) || typeof change.revision !== "string" ||
      typeof change.orchestrationRevision !== "string" || !object(change.tools)) throw new ToolSettingsError("tools.invalidChanges");
  for (const patch of Object.values(change.tools)) {
    if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !["enabled", "exposure"].includes(key)) ||
        (patch.enabled !== undefined && patch.enabled !== null && typeof patch.enabled !== "boolean") ||
        (patch.exposure !== undefined && patch.exposure !== null && !TOOL_EXPOSURES.includes(patch.exposure as never))) {
      throw new ToolSettingsError("tools.invalidChanges");
    }
  }
  if (change.codemode !== undefined) {
    const patch = change.codemode;
    if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !["mode", "inlineBudget"].includes(key)) ||
        (patch.mode !== undefined && patch.mode !== null && !["on", "only"].includes(patch.mode as string)) ||
        (patch.inlineBudget !== undefined && patch.inlineBudget !== null && (!Number.isSafeInteger(patch.inlineBudget) || (patch.inlineBudget as number) < 0))) {
      throw new ToolSettingsError("tools.invalidChanges");
    }
  }
  if (!Object.keys(change.tools).length && !change.codemode) throw new ToolSettingsError("tools.invalidChanges");
  if (change.target === "global" && [...Object.values(change.tools), change.codemode ?? {}].some(patch => Object.values(patch).includes(null))) {
    throw new ToolSettingsError("tools.restoreWorkspaceOnly");
  }
}
