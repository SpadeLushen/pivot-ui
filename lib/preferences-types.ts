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
  "turn-tps-enabled": boolean;
  "cost-enabled": boolean;
  "fork-hierarchy-enabled": boolean;
  "enter-behavior": EnterBehavior;
  "time-format": TimeFormat;
  "default-workspace-parent": string;
  "workspace-picker-start-directory": string;
  "session-search-enabled": boolean;
  "session-search-path": string;
}

export type PreferencePatch = Partial<UserPreferences>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "light",
  locale: "en",
  "tool-preset": "full",
  "sound-enabled": false,
  "tps-enabled": false,
  "turn-tps-enabled": false,
  "cost-enabled": true,
  "fork-hierarchy-enabled": false,
  "enter-behavior": "followUp",
  "time-format": "24",
  "default-workspace-parent": "~/pivot-default-workspaces",
  "workspace-picker-start-directory": "",
  "session-search-enabled": false,
  "session-search-path": "~/.pivot-ui/session-search.sqlite",
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
    "turn-tps-enabled": raw["turn-tps-enabled"] === true,
    "cost-enabled": typeof raw["cost-enabled"] === "boolean" ? raw["cost-enabled"] : DEFAULT_PREFERENCES["cost-enabled"],
    "fork-hierarchy-enabled": typeof raw["fork-hierarchy-enabled"] === "boolean"
      ? raw["fork-hierarchy-enabled"]
      : DEFAULT_PREFERENCES["fork-hierarchy-enabled"],
    "enter-behavior": raw["enter-behavior"] === "steer" ? "steer" : DEFAULT_PREFERENCES["enter-behavior"],
    "time-format": raw["time-format"] === "12" ? "12" : DEFAULT_PREFERENCES["time-format"],
    "session-search-enabled": raw["session-search-enabled"] === true,
    "session-search-path": typeof raw["session-search-path"] === "string" && raw["session-search-path"].trim()
      ? raw["session-search-path"].trim()
      : DEFAULT_PREFERENCES["session-search-path"],
    "workspace-picker-start-directory": typeof raw["workspace-picker-start-directory"] === "string"
      ? raw["workspace-picker-start-directory"].trim()
      : DEFAULT_PREFERENCES["workspace-picker-start-directory"],
    "default-workspace-parent": typeof raw["default-workspace-parent"] === "string" && raw["default-workspace-parent"].trim()
      ? raw["default-workspace-parent"].trim()
      : DEFAULT_PREFERENCES["default-workspace-parent"],
  };
}
