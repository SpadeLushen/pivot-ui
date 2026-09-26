import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { nextBackgroundTitleStatus, getSessionDocumentTitle } = await jiti.import("./background-title.ts");

test("document title uses the active session name or the same message preview as the sidebar", () => {
  assert.equal(getSessionDocumentTitle({ name: "Named chat", firstMessage: "First question" }), "Named chat");
  assert.equal(getSessionDocumentTitle({ firstMessage: "a".repeat(60) }), "a".repeat(50));
  assert.equal(getSessionDocumentTitle({ firstMessage: "(no messages)" }), "Pivot UI");
  assert.equal(getSessionDocumentTitle(null), "Pivot UI");
});

test("background run changes from Ongoing to Done until focus returns", () => {
  let status = nextBackgroundTitleStatus(null, true, true, true);
  assert.equal(status, "ongoing");
  status = nextBackgroundTitleStatus(status, true, false, true);
  assert.equal(status, "done");
  assert.equal(nextBackgroundTitleStatus(status, true, false, true), "done");
  assert.equal(nextBackgroundTitleStatus(status, false, false, true), null);
});

test("idle, focused and closed sessions never show a completion badge", () => {
  assert.equal(nextBackgroundTitleStatus(null, true, false, true), null);
  assert.equal(nextBackgroundTitleStatus(null, false, true, true), null);
  assert.equal(nextBackgroundTitleStatus("ongoing", true, false, false), null);
  assert.equal(nextBackgroundTitleStatus("done", true, true, true), "ongoing");
});
