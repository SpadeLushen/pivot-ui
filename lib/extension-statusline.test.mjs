import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getFastModeTitleSuffix } = await jiti.import("./extension-statusline.ts");

test("uses the runtime-rendered fast-mode label as the title suffix", () => {
  assert.equal(
    getFastModeTitleSuffix([{ key: "pi-plugins:statusline", lines: ["speed 42 ·   [fast mode]"] }]),
    "[fast mode]",
  );
  assert.equal(
    getFastModeTitleSuffix([{ key: "pi-plugins:statusline", lines: ["speed 42"] }]),
    null,
  );
  assert.equal(
    getFastModeTitleSuffix([{ key: "other-widget", lines: ["[fast mode]"] }]),
    null,
  );
});
