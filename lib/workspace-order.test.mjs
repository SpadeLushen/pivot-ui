import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getWorkspaceDisplayGroups, getWorkspaceProjects } = await jiti.import("./workspace-order.ts");

const customWorkspaces = ["/alpha", "/beta"];
const sessions = [
  { cwd: "/alpha", projectRoot: "/alpha", modified: "2026-01-02T00:00:00.000Z", lastUserMessageAt: "2026-01-02T00:00:00.000Z" },
  { cwd: "/beta", projectRoot: "/beta", modified: "2026-01-01T00:00:00.000Z", lastUserMessageAt: "2026-01-01T00:00:00.000Z" },
];

test("workspace selection does not change its position", () => {
  const beforeSwitch = getWorkspaceProjects(sessions, customWorkspaces);
  const afterSwitch = getWorkspaceProjects(sessions, customWorkspaces);

  assert.deepEqual(beforeSwitch, ["/alpha", "/beta"]);
  assert.deepEqual(afterSwitch, beforeSwitch);
});

const eightWorkspaces = ["/alpha", "/beta", "/gamma", "/delta", "/epsilon", "/zeta", "/eta", "/theta"];

test("workspace picker reserves the seventh row for See all", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces.slice(0, 6)),
    { resident: eightWorkspaces.slice(0, 6), overflow: [] },
  );
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces.slice(0, 7)),
    { resident: eightWorkspaces.slice(0, 6), overflow: ["/eta"] },
  );
  assert.deepEqual(getWorkspaceDisplayGroups([]), { resident: [], overflow: [] });
});

test("workspace picker keeps six workspaces and moves the rest to More", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces),
    { resident: eightWorkspaces.slice(0, 6), overflow: ["/eta", "/theta"] },
  );
});

test("selecting an overflow workspace replaces the last resident slot", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces, "/eta"),
    { resident: [...eightWorkspaces.slice(0, 5), "/eta"], overflow: ["/zeta", "/theta"] },
  );
});

test("selecting a resident workspace restores the ordered first six", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces, "/beta"),
    { resident: eightWorkspaces.slice(0, 6), overflow: ["/eta", "/theta"] },
  );
});

test("the displaced sixth workspace remains selectable from More", () => {
  const selectedOverflow = getWorkspaceDisplayGroups(eightWorkspaces, "/eta");

  assert.ok(selectedOverflow.overflow.includes("/zeta"));
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces, "/zeta"),
    { resident: eightWorkspaces.slice(0, 6), overflow: ["/eta", "/theta"] },
  );
});

test("switching between overflow workspaces replaces only the temporary slot", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(eightWorkspaces, "/theta"),
    { resident: [...eightWorkspaces.slice(0, 5), "/theta"], overflow: ["/zeta", "/eta"] },
  );
});

test("activity-driven promotion recalculates the first six", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(["/eta", ...eightWorkspaces.slice(0, 6), "/theta"], "/eta"),
    { resident: ["/eta", ...eightWorkspaces.slice(0, 5)], overflow: ["/zeta", "/theta"] },
  );
});

test("a sent message immediately promotes its workspace", () => {
  const beforeMessage = getWorkspaceProjects(sessions, customWorkspaces, new Set(), []);
  const afterMessage = getWorkspaceProjects(sessions, customWorkspaces, new Set(), ["/beta"]);

  assert.deepEqual(beforeMessage, ["/alpha", "/beta"]);
  assert.deepEqual(afterMessage, ["/beta", "/alpha"]);
});

test("an assistant reply does not promote its workspace", () => {
  const afterReply = getWorkspaceProjects([
    sessions[0],
    { ...sessions[1], modified: "2026-01-04T00:00:00.000Z" },
  ], customWorkspaces);

  assert.deepEqual(afterReply, ["/alpha", "/beta"]);
});

test("a deleted workspace is not retained by stale message activity", () => {
  assert.deepEqual(
    getWorkspaceProjects([], ["/alpha"], new Set(), ["/deleted"]),
    ["/alpha"],
  );
});

test("new user activity promotes that workspace", () => {
  const afterMessage = getWorkspaceProjects([
    sessions[0],
    { ...sessions[1], modified: "2026-01-03T00:00:00.000Z", lastUserMessageAt: "2026-01-03T00:00:00.000Z" },
  ], customWorkspaces);

  assert.deepEqual(afterMessage, ["/beta", "/alpha"]);
});

test("a session created without a message does not promote its workspace", () => {
  assert.deepEqual(
    getWorkspaceProjects([
      { cwd: "/beta", projectRoot: "/beta" },
    ], customWorkspaces),
    ["/alpha", "/beta"],
  );
});

test("a workspace without sessions keeps its saved position until its first message", () => {
  assert.deepEqual(getWorkspaceProjects([], customWorkspaces), customWorkspaces);
  assert.deepEqual(
    getWorkspaceProjects([
      { cwd: "/beta", projectRoot: "/beta", modified: "2026-01-03T00:00:00.000Z", lastUserMessageAt: "2026-01-03T00:00:00.000Z" },
    ], customWorkspaces),
    ["/beta", "/alpha"],
  );
});
