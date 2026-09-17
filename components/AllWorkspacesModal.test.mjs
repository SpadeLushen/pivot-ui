import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const modal = await readFile(new URL("./AllWorkspacesModal.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("archived section starts collapsed and cannot collapse during search", () => {
  assert.match(modal, /\[archivedOpen, setArchivedOpen\] = useState\(false\)/);
  assert.match(modal, /disabled=\{searching\}/);
  assert.match(modal, /!group\.removed \|\| searching \|\| archivedOpen/);
  assert.match(modal, /t\("workspaces\.archived"\)/);
  assert.match(modal, /mode === "tag" && <h3/);
});

test("tag headings do not separate archived workspaces or collapse them", () => {
  const heading = modal.match(/mode === "tag" && <h3[\s\S]*?<\/h3>/)?.[0];
  assert.ok(heading);
  assert.doesNotMatch(heading, /group\.removed|workspaces\.archived/);
  assert.match(modal, /mode === "status" && group\.removed && <button/);
  assert.match(modal, /mode === "tag" \|\| !group\.removed/);
});

test("row navigation is separate from copy, tag and reversible archive controls", () => {
  assert.match(modal, /disabled=\{entry\.removed\} onClick=\{\(\) => onSelect\(entry\.path\)\}/);
  assert.match(modal, /onSelect\(path\); onClose\(\);/);
  assert.match(modal, /removed: !entry\.removed/);
  assert.match(modal, /entry\.removed \? <RotateCcw size=\{16\} \/> : <Archive size=\{16\} \/>/);
  assert.match(modal, /title=\{t\(entry\.removed \? "workspaces.restore" : "workspaces.archive"\)\}/);
  assert.match(modal, /aria-label=\{t\(entry\.removed \? "workspaces.restore" : "workspaces.archive"\)\}/);
  assert.doesNotMatch(modal, /Trash2|general\.remove|workspaces\.removed/);
  assert.ok(modal.indexOf("void copy()") < modal.indexOf("onTag(entry.path)"));
  assert.ok(modal.indexOf("onTag(entry.path)") < modal.indexOf("void toggleArchived()"));
});

test("archive action and status use matching English and Chinese labels", async () => {
  const jiti = createJiti(import.meta.url);
  for (const [locale, action, status] of [["en", "Archive", "Archived"], ["zh", "归档", "已归档"]]) {
    const { default: strings } = await jiti.import(`../lib/i18n/${locale}.ts`);
    assert.equal(strings["workspaces.archive"], action);
    assert.equal(strings["workspaces.archived"], status);
    assert.ok(strings["app.confirmWorkspaceArchive"]);
    assert.ok(strings["workspaces.restore"]);
    assert.equal(strings["workspaces.removed"], undefined);
  }
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
