import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { workspaceFile, type PackFile } from "./workspace-pack-files";
import { readToolSettingsFile as readSettingsFile, saveToolSettingsFile as saveSettings } from "./tool-settings-files";
import { withWorkspaceLock } from "./skill-pack-apply";
import { ToolSettingsError } from "./workspace-tools";
import { notifyResourceConfigurationChanged } from "./session-resource-events";
import type { CodemodeMode, OrchestrationSnapshot } from "./tool-settings-types";

export function codemodeValues(settings: { codemode?: unknown }) {
  const raw = settings.codemode;
  const value = raw !== null && typeof raw === "object" ? raw as { mode?: unknown; inlineBudget?: unknown } : undefined;
  const budget = value?.inlineBudget;
  return { mode: value?.mode === "only" ? "only" as const : "on" as const,
    inlineBudget: typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : 3000 };
}
export function orchestrationFiles(cwd: string, trusted: boolean) {
  try {
    const global = readSettingsFile(join(getAgentDir(), "settings.json"));
    const path = workspaceFile(cwd, "settings.json");
    const project: PackFile = trusted ? readSettingsFile(path) : { path, before: null, value: {} };
    return { global, project };
  } catch { throw new ToolSettingsError("tools.settingsReadFailed", 409); }
}
export function orchestrationRevision(files: ReturnType<typeof orchestrationFiles>, trusted: boolean, target: "global" | "workspace" = "workspace") {
  const values = target === "global" ? [files.global.path, files.global.before]
    : [trusted, files.global.path, files.global.before, files.project.path, files.project.before];
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
export function readOrchestration(cwd: string): OrchestrationSnapshot {
  const agentDir = getAgentDir();
  const base = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const trusted = nativeProjectTrusted(cwd, agentDir, base);
  const settings = trusted ? SettingsManager.create(cwd, agentDir, { projectTrusted: true }) : base;
  if (settings.drainErrors().length) throw new ToolSettingsError("tools.settingsReadFailed", 409);
  const global = settings.getGlobalSettings().codemode ?? {};
  const project = settings.getProjectSettings().codemode ?? {};
  const values = codemodeValues(settings.getSettings());
  const files = orchestrationFiles(cwd, trusted);
  return { ...values, trusted, revision: orchestrationRevision(files, trusted),
    globalRevision: orchestrationRevision(files, trusted, "global"),
    sources: {
      mode: project.mode !== undefined ? "workspace" : global.mode !== undefined ? "global" : "default",
      inlineBudget: project.inlineBudget !== undefined ? "workspace" : global.inlineBudget !== undefined ? "global" : "default",
    },
    overrides: { ...(project.mode === "on" || project.mode === "only" ? { mode: project.mode } : {}),
      ...(typeof project.inlineBudget === "number" ? { inlineBudget: project.inlineBudget } : {}) },
    inherited: codemodeValues(settings.getGlobalSettings()), nativeState: "unknown" };
}
export type OrchestrationChange = { mode: CodemodeMode; inlineBudget: number } | { reset: true };
export async function writeOrchestration(cwd: string, expected: string, change: OrchestrationChange,
  checkNative: () => Promise<void>): Promise<void> {
  if (!("reset" in change) && (!["on", "only"].includes(change.mode) ||
      !Number.isSafeInteger(change.inlineBudget) || change.inlineBudget < 0)) {
    throw new ToolSettingsError("tools.invalidBudget");
  }
  await withWorkspaceLock(cwd, async () => {
    const current = readOrchestration(cwd);
    if (!current.trusted) throw new ToolSettingsError("tools.trustRequired", 403);
    if (!expected || expected !== current.revision) throw new ToolSettingsError("tools.settingsConflict", 409);
    await checkNative();
    const path = workspaceFile(cwd, "settings.json");
    mkdirSync(dirname(path), { recursive: true });
    // Share the SDK FileSettingsStorage lock, including when settings.json is absent.
    const release = await lockfile.lock(path, { realpath: false, retries: { retries: 5, minTimeout: 30, maxTimeout: 150 } });
    try {
      const files = orchestrationFiles(cwd, true);
      if (orchestrationRevision(files, true) !== expected) throw new ToolSettingsError("tools.settingsConflict", 409);
      const raw = files.project.value.codemode;
      if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
        throw new ToolSettingsError("tools.settingsInvalid", 409);
      }
      const codemode = { ...raw as Record<string, unknown> };
      if ("reset" in change) { delete codemode.mode; delete codemode.inlineBudget; }
      else {
        const inherited = codemodeValues(files.global.value);
        if (change.mode === inherited.mode) delete codemode.mode; else codemode.mode = change.mode;
        if (change.inlineBudget === inherited.inlineBudget) delete codemode.inlineBudget; else codemode.inlineBudget = change.inlineBudget;
      }
      const value = { ...files.project.value };
      if (Object.keys(codemode).length) value.codemode = codemode;
      else delete value.codemode;
      saveSettings(files.project, value);
    } finally { await release(); }
  });
  notifyResourceConfigurationChanged(cwd);
}


