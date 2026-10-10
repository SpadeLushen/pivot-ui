import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import lockfile from "proper-lockfile";
import { nativeProjectTrusted } from "./native-mcp-runtime";
import { orchestrationFiles, orchestrationRevision } from "./tool-orchestration";
import { saveToolSettingsFile } from "./tool-settings-files";
import { withWorkspaceLock } from "./skill-pack-apply";
import { notifyResourceConfigurationChanged } from "./session-resource-events";
import { ToolSettingsError } from "./workspace-tools";
import { BUILTIN_EXTENSION_NAMES, type BuiltinExtensionName } from "./builtin-extension-types";

async function resolveBuiltins(cwd: string, settings: SettingsManager) {
  // Only resolve paths with the SDK. Never evaluate extension factories or connect servers.
  const manager = new DefaultPackageManager({ cwd, agentDir: getAgentDir(), settingsManager: settings,
    builtinExtensions: [...BUILTIN_EXTENSION_NAMES] });
  const paths = await manager.resolve(async () => "skip");
  return paths.extensions.filter(item => item.metadata.source === "builtin");
}
export async function readBuiltinSettings(cwd: string) {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const trusted = nativeProjectTrusted(cwd, agentDir, settings);
  settings.setProjectTrusted(trusted);
  if (settings.drainErrors().length) throw new ToolSettingsError("tools.settingsReadFailed", 409);
  const files = orchestrationFiles(cwd, trusted);
  // Resolve from the same captured bytes used for revisions, and omit package
  // declarations: their installation/discovery is irrelevant to built-in switches.
  const onlyExtensions = (value: Record<string, unknown>) => {
    const paths = value.extensions ?? [];
    if (!Array.isArray(paths) || !paths.every(path => typeof path === "string")) {
      throw new ToolSettingsError("tools.settingsInvalid", 409);
    }
    return JSON.stringify({ extensions: paths });
  };
  const globalSource = onlyExtensions(files.global.value);
  const projectSource = onlyExtensions(files.project.value);
  const captured = SettingsManager.fromStorage({ withLock: (scope, action) => {
    action(scope === "global" ? globalSource : projectSource);
  } }, { projectTrusted: trusted });
  const effective = await resolveBuiltins(cwd, captured);
  const global = await resolveBuiltins(cwd, SettingsManager.fromStorage({ withLock: (scope, action) => {
    action(scope === "global" ? globalSource : undefined);
  } }, { projectTrusted: false }));
  return { trusted, revision: orchestrationRevision(files, trusted),
    globalRevision: orchestrationRevision(files, trusted, "global"),
    builtins: BUILTIN_EXTENSION_NAMES.map(name => {
      const item = effective.find(item => item.path === `builtin:${name}`);
      return { name, configured: item?.enabled ?? true,
        source: item?.metadata.scope === "project" ? "project" as const : "global" as const,
        globalEnabled: global.find(item => item.path === `builtin:${name}`)?.enabled ?? true };
    }) };
}

export async function writeBuiltinSetting(cwd: string, input: {
  name: BuiltinExtensionName; scope: "global" | "project"; enabled: boolean; revision: string;
}) {
  if (!BUILTIN_EXTENSION_NAMES.includes(input.name) || !["global", "project"].includes(input.scope)
    || typeof input.enabled !== "boolean" || typeof input.revision !== "string") {
    throw new ToolSettingsError("plugins.builtinInvalid");
  }
  await withWorkspaceLock(cwd, async () => {
    const current = await readBuiltinSettings(cwd);
    if (input.scope === "project" && !current.trusted) throw new ToolSettingsError("tools.trustRequired", 403);
    const expected = input.scope === "global" ? current.globalRevision : current.revision;
    if (expected !== input.revision) throw new ToolSettingsError("tools.settingsConflict", 409);
    const files = orchestrationFiles(cwd, current.trusted);
    const file = input.scope === "global" ? files.global : files.project;
    mkdirSync(dirname(file.path), { recursive: true });
    const release = await lockfile.lock(file.path, { realpath: false,
      retries: { retries: 5, minTimeout: 30, maxTimeout: 150 } });
    try {
      const latest = orchestrationFiles(cwd, current.trusted);
      if (orchestrationRevision(latest, current.trusted, input.scope === "global" ? "global" : "workspace") !== input.revision) {
        throw new ToolSettingsError("tools.settingsConflict", 409);
      }
      const target = input.scope === "global" ? latest.global : latest.project;
      const paths = target.value.extensions ?? [];
      if (!Array.isArray(paths) || !paths.every(path => typeof path === "string")) {
        throw new ToolSettingsError("tools.settingsInvalid", 409);
      }
      const identity = `builtin:${input.name}`;
      const next = paths.filter(path => ![identity, `+${identity}`, `-${identity}`, `!${identity}`].includes(path));
      // Keep unrelated resource entries and glob rules. Exact SDK include/exclude wins.
      next.push(`${input.enabled ? "+" : "-"}${identity}`);
      saveToolSettingsFile(target, { ...target.value, extensions: next });
    } finally { await release(); }
  });
  notifyResourceConfigurationChanged(input.scope === "project" ? cwd : undefined);
}
