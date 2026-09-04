import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("does not auto-open the panel for a new workspace without saved state", async () => {
  const panel = await readFile(new URL("./RightPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /setPanelOpen\(saved\?\.panelOpen \?\? false\);/);
  assert.doesNotMatch(panel, /setPanelOpen\(saved\?\.panelOpen \?\? window\.matchMedia/);
});

test("hides the panel when closing the final file or tool tab", async () => {
  const panel = await readFile(new URL("./RightPanel.tsx", import.meta.url), "utf8");
  const closeTab = panel.slice(panel.indexOf("const closeTab"), panel.indexOf("const tabs:"));

  assert.equal((closeTab.match(/if \(remaining\.length === 0\)/g) ?? []).length, 2);
  assert.equal((closeTab.match(/setPanelOpen\(false\);/g) ?? []).length, 2);
  assert.match(closeTab, /const remaining = \[\.\.\.next, \.\.\.fileTabs\];[\s\S]*?if \(remaining\.length === 0\)/);
  assert.match(closeTab, /const remaining = \[\.\.\.toolTabs, \.\.\.next\];[\s\S]*?if \(remaining\.length === 0\)/);
});

test("exposes revealInFileTree on the imperative handle with isDir support", async () => {
  const panel = await readFile(new URL("./RightPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /const revealInFileTree = useCallback\(\(filePath: string, isDir = false\) => \{/);
  assert.match(panel, /setFileTreeRevealRequest\(\(current\) => \(\{ path: filePath, id: \(current\?\.id \?\? 0\) \+ 1, isDir \}\)\);/);
  assert.match(panel, /openTool\("file-tree"\);/);
  assert.match(panel, /useImperativeHandle\(ref, \(\) => \(\{ openFile, revealInFileTree \}\)/);
});
