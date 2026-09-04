import type { ToolPreset } from "./tool-presets";

export const TOOL_PRESET_STORAGE_KEY = "pi-tool-preset";
export const SOUND_ENABLED_STORAGE_KEY = "pi-sound-enabled";
export const TPS_ENABLED_STORAGE_KEY = "pi-tps-enabled";
export const ENTER_BEHAVIOR_STORAGE_KEY = "pi-enter-behavior";
export const TIME_FORMAT_STORAGE_KEY = "pi-time-format";
export type EnterBehavior = "steer" | "followUp";
export type TimeFormat = "12" | "24";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readValue(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string): void {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // Storage may be unavailable in private browsing or when its quota is full.
  }
}

export function readToolPresetPreference(): ToolPreset {
  const value = readValue(TOOL_PRESET_STORAGE_KEY);
  return value === "none" || value === "full" || value === "default" ? value : "full";
}

export function writeToolPresetPreference(value: ToolPreset): void {
  writeValue(TOOL_PRESET_STORAGE_KEY, value);
}

export function readSoundEnabledPreference(): boolean {
  const value = readValue(SOUND_ENABLED_STORAGE_KEY);
  return value === "true";
}

export function writeSoundEnabledPreference(value: boolean): void {
  writeValue(SOUND_ENABLED_STORAGE_KEY, String(value));
}

export function readTpsEnabledPreference(): boolean {
  const value = readValue(TPS_ENABLED_STORAGE_KEY);
  return value === "true";
}

export function writeTpsEnabledPreference(value: boolean): void {
  writeValue(TPS_ENABLED_STORAGE_KEY, String(value));
}

export function readEnterBehaviorPreference(): EnterBehavior {
  const value = readValue(ENTER_BEHAVIOR_STORAGE_KEY);
  return value === "steer" ? "steer" : "followUp";
}

export function writeEnterBehaviorPreference(value: EnterBehavior): void {
  writeValue(ENTER_BEHAVIOR_STORAGE_KEY, value);
}

export function readTimeFormatPreference(): TimeFormat {
  const value = readValue(TIME_FORMAT_STORAGE_KEY);
  return value === "12" ? "12" : "24";
}

export function writeTimeFormatPreference(value: TimeFormat): void {
  writeValue(TIME_FORMAT_STORAGE_KEY, value);
}
