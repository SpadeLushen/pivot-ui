import type { ToolPreset } from "./tool-presets";

export type Theme = "light" | "dark" | "eye";
export type Locale = "en" | "zh";
export type EnterBehavior = "steer" | "followUp";
export type TimeFormat = "12" | "24";

export interface UserPreferences {
  theme: Theme;
  locale: Locale;
  "tool-preset": ToolPreset;
  "sound-enabled": boolean;
  "tps-enabled": boolean;
  "enter-behavior": EnterBehavior;
  "time-format": TimeFormat;
  "default-workspace-parent": string;
}

export type PreferencePatch = Partial<UserPreferences>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "light",
  locale: "en",
  "tool-preset": "full",
  "sound-enabled": false,
  "tps-enabled": false,
  "enter-behavior": "followUp",
  "time-format": "24",
  "default-workspace-parent": "~/pivot-default-workspaces",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePreferences(value: unknown): UserPreferences {
  const raw = isRecord(value) ? value : {};
  return {
    theme: raw.theme === "dark" || raw.theme === "eye" ? raw.theme : DEFAULT_PREFERENCES.theme,
    locale: raw.locale === "zh" ? "zh" : DEFAULT_PREFERENCES.locale,
    "tool-preset": raw["tool-preset"] === "none" || raw["tool-preset"] === "default" || raw["tool-preset"] === "full"
      ? raw["tool-preset"]
      : DEFAULT_PREFERENCES["tool-preset"],
    "sound-enabled": raw["sound-enabled"] === true,
    "tps-enabled": raw["tps-enabled"] === true,
    "enter-behavior": raw["enter-behavior"] === "steer" ? "steer" : DEFAULT_PREFERENCES["enter-behavior"],
    "time-format": raw["time-format"] === "12" ? "12" : DEFAULT_PREFERENCES["time-format"],
    "default-workspace-parent": typeof raw["default-workspace-parent"] === "string" && raw["default-workspace-parent"].trim()
      ? raw["default-workspace-parent"].trim()
      : DEFAULT_PREFERENCES["default-workspace-parent"],
  };
}
