// Server-side shared user preferences.
//
// The file is intentionally kept outside any workspace so every browser that
// connects to this Pivot UI instance observes the same settings.

import { mkdirSync, readFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getPivotUiConfigDir } from "./attachment-config";
import { resolveDefaultWorkspaceParent } from "./default-workspace-parent";
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  type PreferencePatch,
  type UserPreferences,
} from "./preferences-types";

export function getPreferencesPath(): string {
  return join(getPivotUiConfigDir(), "preferences.json");
}

export function readPreferences(): UserPreferences {
  try {
    const raw = JSON.parse(readFileSync(getPreferencesPath(), "utf8")) as unknown;
    return normalizePreferences(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

async function writePreferences(preferences: UserPreferences): Promise<void> {
  const path = getPreferencesPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

// Serialize read-modify-write operations so simultaneous browser updates do
// not overwrite a field changed by another request in this Node process.
let writeChain: Promise<void> = Promise.resolve();

export function updatePreferences(patch: PreferencePatch): Promise<UserPreferences> {
  const run = writeChain.then(async () => {
    const next = normalizePreferences({ ...readPreferences(), ...patch });
    await writePreferences(next);
    return next;
  });
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePreferencePatch(value: unknown): { patch: PreferencePatch } | { error: string } {
  if (!isRecord(value)) return { error: "Preferences must be a JSON object" };

  const patch: PreferencePatch = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    switch (key) {
      case "theme":
        if (item !== "light" && item !== "dark" && item !== "eye") return { error: `Invalid preference: ${key}` };
        patch.theme = item;
        break;
      case "locale":
        if (item !== "en" && item !== "zh") return { error: `Invalid preference: ${key}` };
        patch.locale = item;
        break;
      case "tool-preset":
        if (item !== "none" && item !== "default" && item !== "full") return { error: `Invalid preference: ${key}` };
        patch["tool-preset"] = item;
        break;
      case "sound-enabled":
      case "tps-enabled":
        if (typeof item !== "boolean") return { error: `Invalid preference: ${key}` };
        patch[key] = item;
        break;
      case "enter-behavior":
        if (item !== "steer" && item !== "followUp") return { error: `Invalid preference: ${key}` };
        patch["enter-behavior"] = item;
        break;
      case "time-format":
        if (item !== "12" && item !== "24") return { error: `Invalid preference: ${key}` };
        patch["time-format"] = item;
        break;
      case "default-workspace-parent":
        if (typeof item !== "string" || !item.trim()) return { error: `Invalid preference: ${key}` };
        try {
          resolveDefaultWorkspaceParent(item);
        } catch {
          return { error: `Invalid preference: ${key} (use an absolute path or ~/...)` };
        }
        patch["default-workspace-parent"] = item.trim();
        break;
      default:
        return { error: `Unknown preference: ${key}` };
    }
  }
  return { patch };
}
