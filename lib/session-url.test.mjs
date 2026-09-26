import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { replaceSessionUrl } = await jiti.import("./session-url.ts");

test("session selection uses history updates rather than Next metadata navigation", async () => {
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /replaceSessionUrl\(session\.id\)/);
  assert.match(shell, /replaceSessionUrl\(null\)/);
  assert.doesNotMatch(shell, /router\.replace|useRouter/);
});

test("switching sessions changes the URL without navigating or replacing the document title", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const urls = [];
  globalThis.window = { history: { replaceState: (_state, _unused, url) => urls.push(url) } };
  globalThis.document = { title: "First session" };
  try {
    replaceSessionUrl("second/id");
    globalThis.document.title = "Second session";
    replaceSessionUrl("third id");
    assert.deepEqual(urls, ["?session=second%2Fid", "?session=third%20id"]);
    assert.equal(globalThis.document.title, "Second session");
    replaceSessionUrl(null);
    assert.equal(urls.at(-1), "/");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
