import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

test("mobile and touch form controls avoid iOS focus zoom despite inline font sizes", async () => {
  const css = postcss.parse(await readFile(new URL("./globals.css", import.meta.url), "utf8"));
  const rules = [];
  css.walkAtRules("media", (media) => {
    if (media.params !== "(max-width: 640px), (any-pointer: coarse)") return;
    media.walkRules((rule) => {
      if (rule.selector !== "input, textarea, select") return;
      rule.walkDecls("font-size", (decl) => rules.push(decl));
    });
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].value, "16px");
  assert.equal(rules[0].important, true);
});

test("viewport configuration does not disable user zoom", async () => {
  const layout = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /userScalable:\s*false|maximumScale:\s*1|user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
});
