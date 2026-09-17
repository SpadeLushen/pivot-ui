import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modal = await readFile(new URL("./AllWorkspacesModal.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("removed section starts collapsed and cannot collapse during search", () => {
  assert.match(modal, /\[removedOpen, setRemovedOpen\] = useState\(false\)/);
  assert.match(modal, /disabled=\{searching\}/);
  assert.match(modal, /!group\.removed \|\| searching \|\| removedOpen/);
  assert.match(modal, /mode === "tag" && <h3/);
});

test("tag headings do not separate removed workspaces or collapse them", () => {
  const heading = modal.match(/mode === "tag" && <h3[\s\S]*?<\/h3>/)?.[0];
  assert.ok(heading);
  assert.doesNotMatch(heading, /group\.removed|workspaces\.removed/);
  assert.match(modal, /mode === "status" && group\.removed && <button/);
  assert.match(modal, /mode === "tag" \|\| !group\.removed/);
});

test("row navigation is separate from copy, tag and reversible remove controls", () => {
  assert.match(modal, /disabled=\{entry\.removed\} onClick=\{\(\) => onSelect\(entry\.path\)\}/);
  assert.match(modal, /onSelect\(path\); onClose\(\);/);
  assert.match(modal, /removed: !entry\.removed/);
  assert.match(modal, /entry\.removed \? <RotateCcw/);
  assert.ok(modal.indexOf("void copy()") < modal.indexOf("onTag(entry.path)"));
  assert.ok(modal.indexOf("onTag(entry.path)") < modal.indexOf("void toggleRemoved()"));
});

test("tag mode relies on the section heading instead of a per-row tag prefix", () => {
  assert.match(modal, /showTag && <WorkspaceTag tag=\{entry\.tag\} \/>/);
  assert.match(modal, /showTag=\{mode === "status"\}/);
  assert.equal(modal.match(/<WorkspaceTag /g)?.length, 1);
});

test("See all is last and separated in More; tags appear in both workspace lists", () => {
  assert.match(sidebar, /role="separator" \/>\s*\{seeAllWorkspaces\}/);
  assert.match(sidebar, /overflowWorkspaceProjects.length === 0 && seeAllWorkspaces/);
  assert.equal(sidebar.match(/<WorkspaceTag tag=\{workspaceTags.get\(project\)\}/g)?.length, 2);
  assert.doesNotMatch(sidebar, /saveHiddenWorkspaces|saveCustomWorkspaces/);
});
