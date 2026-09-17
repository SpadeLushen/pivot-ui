import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences-types.ts";

test("shared preferences have safe defaults", () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    theme: "light",
    locale: "en",
    "tool-preset": "full",
    "sound-enabled": false,
    "tps-enabled": false,
    "enter-behavior": "followUp",
    "time-format": "24",
  });
});

test("shared preferences ignore invalid values", () => {
  assert.deepEqual(normalizePreferences({
    theme: "unexpected",
    locale: "unexpected",
    "tool-preset": "unexpected",
    "sound-enabled": "true",
    "tps-enabled": 1,
    "enter-behavior": "unexpected",
    "time-format": "system",
  }), DEFAULT_PREFERENCES);

  assert.equal(normalizePreferences({ theme: "dark", locale: "zh", "time-format": "12" }).theme, "dark");
  assert.equal(normalizePreferences({ theme: "dark", locale: "zh", "time-format": "12" }).locale, "zh");
  assert.equal(normalizePreferences({ theme: "dark", locale: "zh", "time-format": "12" })["time-format"], "12");
});
