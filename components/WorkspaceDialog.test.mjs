import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialog = await readFile(new URL("./WorkspaceDialog.tsx", import.meta.url), "utf8");
const tagDialog = await readFile(new URL("./WorkspaceTagDialog.tsx", import.meta.url), "utf8");

test("native dialog applies initial focus after showModal, without scrolling", () => {
  assert.match(dialog, /dialog\?\.showModal\(\);[\s\S]*?initialFocusRef\?\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /\}, \[initialFocusRef\]\);/);
  assert.match(dialog, /return \(\) => dialog\?\.close\(\);/);
});

test("Set tag uses a stable input ref for initial focus instead of pre-open autoFocus", () => {
  assert.match(tagDialog, /const inputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(tagDialog, /<WorkspaceDialog[^>]*initialFocusRef=\{inputRef\}/);
  assert.match(tagDialog, /<input ref=\{inputRef\} id="workspace-tag-input"/);
  assert.doesNotMatch(tagDialog, /autoFocus/);
});
