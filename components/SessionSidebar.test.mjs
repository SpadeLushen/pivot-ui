import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace menus keep actions separate", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /open=\{workspaceMenu === "new"\}/);
  assert.match(sidebar, /t\("app\.useDefaultDir"\)/);
  assert.match(sidebar, /t\("app\.chooseFolder"\)/);
  assert.match(sidebar, /open=\{workspaceMenu === "active"\}/);
  assert.match(sidebar, /t\("general\.remove"\)/);
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

test("More keeps See all in a non-scrolling footer beneath the workspace list", async () => {
  const [sidebar, css] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /className="sidebar-workspace-overflow-menu" style=\{\{ maxHeight: isMobile \? 278 : 318 \}\}/);
  assert.match(sidebar, /className="sidebar-workspace-overflow-list">[\s\S]*?overflowWorkspaceProjects\.map[\s\S]*?\}\)\}\s*<\/div>\s*<div className="sidebar-workspace-overflow-footer">\s*<div[^>]+role="separator" \/>\s*\{seeAllWorkspaces\}/);
  const block = (name) => css.match(new RegExp(`\\.${name} \\{[^}]*\\}`))?.[0] ?? "";
  assert.match(block("sidebar-workspace-overflow-menu"), /display: flex;\s*flex-direction: column;\s*overflow: hidden;/);
  assert.match(block("sidebar-workspace-overflow-list"), /min-height: 0;\s*overflow-y: auto;/);
  assert.match(block("sidebar-workspace-overflow-footer"), /flex-shrink: 0;/);
});

test("overflow workspaces use a reachable hover menu", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebar, /getWorkspaceDisplayGroups\(workspaceProjects, selectedProject\)/);
  assert.match(sidebar, /overflowWorkspaceProjects\.length > 0/);
  assert.match(sidebar, /onMouseEnter=\{\(\) => \{[\s\S]*?cancelMoreWorkspacesClose\(\);[\s\S]*?setMoreWorkspacesOpen\(true\);/);
  assert.match(sidebar, /onMouseLeave=\{closeMoreWorkspacesSoon\}/);
  assert.match(sidebar, /slide=\{isMobile \? "down" : "right"\}/);
  assert.match(sidebar, /left: "100%"/);
  assert.match(sidebar, /overflowWorkspaceProjects\.map/);
});
