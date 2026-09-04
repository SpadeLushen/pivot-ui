import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings theme buttons select the requested theme directly", async () => {
  const settings = await readFile(new URL("./SettingsModal.tsx", import.meta.url), "utf8");

  assert.match(settings, /const \{ theme, setTheme \} = useTheme\(\);/);
  for (const key of ["light", "dark", "eye"]) {
    assert.match(settings, new RegExp(`\\{ key: "${key}"`));
  }
  assert.match(settings, /const isActive = theme === th\.key;/);
  assert.match(settings, /setTheme\(th\.key, \{/);
  assert.doesNotMatch(settings, /toggleTheme/);
  assert.doesNotMatch(settings, /Cycle through themes until we hit the target/);
  assert.doesNotMatch(settings, /currentIndex|targetIndex|diff/);
  assert.doesNotMatch(settings, /for \(let i = 0; i < diff; i\+\+\)/);
});

test("direct theme selection shares the DOM and persistence path with the toggle", async () => {
  const [themeHook, appShell] = await Promise.all([
    readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(themeHook, /const setTheme = useCallback\(\(next: Theme/);
  assert.match(themeHook, /document\.documentElement\.classList\.remove\("dark", "eye"\)/);
  assert.match(themeHook, /localStorage\.setItem\("pi-theme", next\)/);
  assert.match(themeHook, /setTheme\(next, origin\);/);
  assert.match(appShell, /toggleTheme\(\{[\s\S]*?x: rect\.left/);
});
