import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getWorkspaceProjects } = await jiti.import("./workspace-order.ts");

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

test("an assistant reply does not promote its workspace", () => {
  const afterReply = getWorkspaceProjects([
    sessions[0],
    { ...sessions[1], modified: "2026-01-04T00:00:00.000Z" },
  ], customWorkspaces);

  assert.deepEqual(afterReply, ["/alpha", "/beta"]);
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
