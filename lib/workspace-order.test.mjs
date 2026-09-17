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

const sixWorkspaces = ["/alpha", "/beta", "/gamma", "/delta", "/epsilon", "/zeta"];

test("workspace picker reserves the fifth row for See all", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces.slice(0, 4)),
    { resident: sixWorkspaces.slice(0, 4), overflow: [] },
  );
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces.slice(0, 5)),
    { resident: sixWorkspaces.slice(0, 4), overflow: ["/epsilon"] },
  );
  assert.deepEqual(getWorkspaceDisplayGroups([]), { resident: [], overflow: [] });
});

test("workspace picker keeps four workspaces and moves the rest to More", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces),
    { resident: ["/alpha", "/beta", "/gamma", "/delta"], overflow: ["/epsilon", "/zeta"] },
  );
});

test("selecting an overflow workspace replaces the last resident slot", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces, "/epsilon"),
    { resident: ["/alpha", "/beta", "/gamma", "/epsilon"], overflow: ["/delta", "/zeta"] },
  );
});

test("selecting a resident workspace restores the ordered first four", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces, "/beta"),
    { resident: ["/alpha", "/beta", "/gamma", "/delta"], overflow: ["/epsilon", "/zeta"] },
  );
});

test("the displaced fourth workspace remains selectable from More", () => {
  const selectedOverflow = getWorkspaceDisplayGroups(sixWorkspaces, "/epsilon");

  assert.ok(selectedOverflow.overflow.includes("/delta"));
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces, "/delta"),
    { resident: ["/alpha", "/beta", "/gamma", "/delta"], overflow: ["/epsilon", "/zeta"] },
  );
});

test("switching between overflow workspaces replaces only the temporary slot", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(sixWorkspaces, "/zeta"),
    { resident: ["/alpha", "/beta", "/gamma", "/zeta"], overflow: ["/delta", "/epsilon"] },
  );
});

test("activity-driven promotion recalculates the first four", () => {
  assert.deepEqual(
    getWorkspaceDisplayGroups(["/epsilon", ...sixWorkspaces.slice(0, 4), "/zeta"], "/epsilon"),
    { resident: ["/epsilon", "/alpha", "/beta", "/gamma"], overflow: ["/delta", "/zeta"] },
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
