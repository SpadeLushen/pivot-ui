import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace menus keep actions separate", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /open=\{workspaceMenu === "new"\}/);
  assert.match(sidebar, /t\("app\.useDefaultDir"\)/);
  assert.match(sidebar, /t\("app\.chooseFolder"\)/);
  assert.match(sidebar, /open=\{workspaceMenu === "active"\}/);
  assert.match(sidebar, /t\("app\.confirmWorkspaceDelete"\)/);
  assert.match(sidebar, /t\("fileTree\.copyFullPath"\)/);
  assert.match(sidebar, /className="sidebar-workspace-menu-path"/);
  assert.match(sidebar, /<PathLabel text=\{projectLabel\(project\)\}/);
  assert.match(sidebar, /className="sidebar-project-menu-button"[\s\S]*?<MoreHorizontal/);
  assert.match(sidebar, /left: 0,[\s\S]*?minWidth: "min\(260px, calc\(100vw - 24px\)\)"/);
  assert.match(sidebar, /hoveredWorkspace === project/);
  assert.doesNotMatch(sidebar, /className="sidebar-workspace-menu-item"[\s\S]*?t\("general\.cancel"\)/);
});

test("directory picker can create and select a named workspace", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /placeholder=\{t\("app\.workspaceFolderName"\)\}/);
  assert.match(sidebar, /body: JSON\.stringify\(\{ path: listing\.path, name \}\)/);
  assert.match(sidebar, /const selectError = await onSelect\(data\.path\);/);
});
