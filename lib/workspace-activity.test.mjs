import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getWorkspaceActivity } = await jiti.import("./workspace-activity.ts");

const sessions = [
  { id: "main", cwd: "/repo", projectRoot: "/repo" },
  { id: "worktree", cwd: "/repo-feature", projectRoot: "/repo" },
  { id: "other", cwd: "/other", projectRoot: "/other" },
];

test("aggregates activity across all sessions in a workspace", () => {
  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(["worktree"]), new Set()),
    { isRunning: true, hasUnread: false },
  );

  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(), new Set(["worktree"])),
    { isRunning: false, hasUnread: true },
  );

  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(), new Set()),
    { isRunning: false, hasUnread: false },
  );

  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(), new Set(["other"])),
    { isRunning: false, hasUnread: false },
  );
});

test("running activity takes precedence over unread activity", () => {
  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(["main"]), new Set(["worktree"])),
    { isRunning: true, hasUnread: false },
  );
});

test("error activity takes precedence over running and unread activity", () => {
  assert.deepEqual(
    getWorkspaceActivity("/repo", sessions, new Set(["main"]), new Set(["worktree"]), new Set(["worktree"])),
    { isRunning: false, hasUnread: false, isError: true },
  );
});
