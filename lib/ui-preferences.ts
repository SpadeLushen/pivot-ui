// Preference types and defaults are shared with the server preferences API.
// Runtime reads and writes go through usePreferences; this compatibility module
// intentionally does not access browser storage.
export { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences-types";
export type {
  EnterBehavior,
  TimeFormat,
  Theme,
  UserPreferences,
} from "./preferences-types";
export type { ToolPreset } from "./tool-presets";
