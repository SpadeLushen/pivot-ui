import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getWorkspaceEntries, groupWorkspaces, matchingWorkspaceSessions, workspaceName } = await createJiti(import.meta.url).import("./workspace-registry.ts");
const records = [
  { path: "/team/Zulu", tag: "Work", removed: false },
  { path: "/team/Alpha", tag: "Work", removed: true },
  { path: "/other/Beta", tag: "", removed: false },
  { path: "/team/Gamma", tag: "Work", removed: false },
  { path: "/team/Space App", tag: "Side projects", removed: true },
];
const entries = getWorkspaceEntries([], records);

test("tag grouping keeps removed workspaces at the end of the same tag section", () => {
  const groups = groupWorkspaces(entries, "", "tag");
  assert.deepEqual(groups.map((g) => g.tag), ["Side projects", "Work", ""]);
  assert.deepEqual(groups[1].entries.map((e) => e.name), ["Gamma", "Zulu", "Alpha"]);
  assert.deepEqual(groups[1].entries.map((e) => e.removed), [false, false, true]);
  assert.ok(groups.every((g) => g.removed === undefined));
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
});

test("each status stays name-sorted within a tag, including untagged workspaces", () => {
  const mixed = getWorkspaceEntries([], [
    ...records,
    { path: "/team/Echo", tag: "Work", removed: true },
    { path: "/other/Aardvark", tag: "", removed: true },
  ]).reverse();
  const groups = groupWorkspaces(mixed, "", "tag");
  assert.deepEqual(groups.find((g) => g.tag === "Work").entries.map((e) => e.name), ["Gamma", "Zulu", "Alpha", "Echo"]);
  assert.deepEqual(groups.find((g) => g.tag === "").entries.map((e) => e.name), ["Beta", "Aardvark"]);
  assert.deepEqual(groupWorkspaces(mixed, "wOrK", "tag"), [groups.find((g) => g.tag === "Work")]);
});

test("search matches a single case-insensitive phrase in tag, name or path", () => {
  const search = (query) => groupWorkspaces(entries, query, "status").flatMap((g) => g.entries);
  assert.equal(search("SIDE PROJ")[0].name, "Space App");
  assert.equal(search("  space app  ")[0].name, "Space App");
  assert.equal(search("/other/")[0].name, "Beta");
  assert.equal(search("team Zulu").length, 0);
  assert.equal(search("space  app").length, 0);
  assert.equal(search("space app")[0].removed, true);
});

test("session-title matches add their workspaces without changing workspace-only matches", () => {
  const sessions = [
    { id: "1", cwd: "/team/Zulu", name: "Fix [login] flow", firstMessage: "", modified: "2026-01-01" },
    { id: "2", cwd: "/worktrees/feature", projectRoot: "/team/Zulu", name: "Login checks", firstMessage: "", modified: "2026-02-01" },
    { id: "3", cwd: "/team/Alpha", name: "[LOGIN] details", firstMessage: "", modified: "2026-01-01" },
    { id: "4", cwd: "/other/Beta", firstMessage: "Login introduction", modified: "2026-01-01" },
    { id: "5", cwd: "/team/Gamma", name: "Other", firstMessage: "Login details", modified: "2026-01-01" },
  ];
  const matched = matchingWorkspaceSessions(sessions, "login");
  assert.deepEqual(matched.get("/team/Zulu")?.map((s) => s.id), ["2", "1"]);
  assert.deepEqual(matched.get("/team/Alpha")?.map((s) => s.id), ["3"]);
  assert.deepEqual(matched.get("/other/Beta")?.map((s) => s.id), ["4"]);
  assert.equal(matched.has("/team/Gamma"), false);
  const groups = groupWorkspaces(entries, "login", "status", new Set(matched.keys()));
  assert.deepEqual(groups.map((g) => g.entries.map((e) => e.name)), [["Beta", "Zulu"], ["Alpha"]]);
  assert.deepEqual(groupWorkspaces(entries, "gamma", "status", new Set()).flatMap((g) => g.entries.map((e) => e.name)), ["Gamma"]);
  assert.deepEqual(groupWorkspaces(entries, "no match", "tag", new Set()), []);
  assert.equal(matchingWorkspaceSessions(sessions, " ").size, 0);
  assert.deepEqual(matchingWorkspaceSessions(sessions, "[LOGIN]").get("/team/Zulu")?.map((s) => s.id), ["1"]);
  assert.deepEqual(groupWorkspaces(entries, "login", "tag", new Set(matched.keys())).map((g) => g.tag), ["Work", ""]);
});

test("names support Windows, POSIX and filesystem roots", () => {
  assert.equal(workspaceName("F:\\Projects\\hello\\"), "hello");
  assert.equal(workspaceName("/work/hello/"), "hello");
  assert.equal(workspaceName("/"), "/");
  assert.equal(workspaceName("F:\\"), "F:");
});

test("session roots and saved workspaces form one name-sorted list", () => {
  const result = getWorkspaceEntries([
    { cwd: "/team/Zulu" }, { cwd: "/worktrees/Zulu", projectRoot: "/team/Zulu" }, { cwd: "/new/Delta" },
  ], records);
  assert.deepEqual(result.map((entry) => entry.name), ["Alpha", "Beta", "Delta", "Gamma", "Space App", "Zulu"]);
  assert.equal(result.find((entry) => entry.name === "Zulu").tag, "Work");
  assert.equal(result[0].removed, true);
});

test("status grouping puts removed last, each section sorted by name", () => {
  const groups = groupWorkspaces(entries.slice().reverse(), "", "status");
  assert.deepEqual(groups[0].entries.map((e) => e.name), ["Beta", "Gamma", "Zulu"]);
  assert.deepEqual(groups[1].entries.map((e) => e.name), ["Alpha", "Space App"]);
  assert.equal(groups[1].removed, true);
});
