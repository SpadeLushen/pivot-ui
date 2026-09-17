import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hook = await readFile(new URL("./useBackdropDismiss.ts", import.meta.url), "utf8");

test("backdrop hook records both endpoints in capture phase and closes only on click", () => {
  assert.match(hook, /onPointerDownCapture/);
  assert.match(hook, /onPointerUpCapture/);
  assert.match(hook, /onPointerCancelCapture/);
  assert.match(hook, /window.addEventListener\("blur", reset\)/);
  assert.match(hook, /onClickCapture[\s\S]*?consumeClick\(\)[\s\S]*?event.detail > 0\) onClose\(\)/);
  assert.equal(hook.match(/onClose\(\)/g)?.length, 1);
});

for (const name of ["WorkspaceDialog", "SessionSidebar", "SettingsModal", "SkillPacksModal", "WorkspacePacks", "SkillsConfig", "PluginsConfig", "ModelsConfig", "McpConfig", "ChatWindow"]) {
  test(`${name} uses the shared two-endpoint backdrop handling`, async () => {
    const source = await readFile(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    const count = name === "ModelsConfig" ? 2 : 1;
    assert.equal(source.match(/const backdrop = useBackdropDismiss\(onClose\)/g)?.length, count);
    assert.equal(source.match(/\{\.\.\.backdrop\}/g)?.length, count);
    assert.doesNotMatch(source, /if \((?:event|e).target === (?:event|e).currentTarget\) onClose\(\)/);
  });
}
