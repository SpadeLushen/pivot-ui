import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { restoreSessionToolPreset, saveSessionToolPreset } = await jiti.import("./session-tool-preset.ts");
const { getToolNamesForPreset, getPresetFromTools, withExtensionTools } = await jiti.import("./tool-presets.ts");

function manager(entries = []) {
  return {
    getBranch: () => entries,
    buildSessionContext: () => ({ messages: entries.filter((entry) => entry.type === "message").map((entry) => entry.message) }),
    appendCustomEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
  };
}

function assistantTool(name) {
  return { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name }] } };
}

test("persists each preset and restores the latest choice on the active branch", () => {
  const active = manager();
  saveSessionToolPreset(active, "full");
  saveSessionToolPreset(active, "none");
  assert.equal(restoreSessionToolPreset(active), "none");
  const alternate = manager([active.getBranch()[0]]);
  assert.equal(restoreSessionToolPreset(alternate), "full");
  saveSessionToolPreset(alternate, "default");
  assert.equal(restoreSessionToolPreset(alternate), "default");
});

test("historical sessions without a system loadout default to full regardless of tool-call evidence", () => {
  for (const entries of [[], [assistantTool("bash")], [assistantTool("grep")], [assistantTool("find")]]) {
    const session = manager(entries);
    const registry = ["read", "bash", "edit", "write", "powershell", "future-tool"].map((name) => ({
      name, sourceInfo: { source: "builtin" }, description: "",
    }));
    const before = JSON.stringify(entries);
    for (let open = 0; open < 3; open++) {
      const preset = restoreSessionToolPreset(session);
      assert.equal(preset, "full");
      const active = withExtensionTools(registry, getToolNamesForPreset(preset, registry));
      assert.deepEqual(active, registry.map((tool) => tool.name));
      assert.equal(getPresetFromTools(registry.map((tool) => ({ ...tool, active: active.includes(tool.name) }))), "full");
    }
    assert.equal(JSON.stringify(entries), before);
  }
});

test("explicit default and none override the missing-system fallback", () => {
  for (const preset of ["default", "none"]) {
    const session = manager([assistantTool("bash")]);
    saveSessionToolPreset(session, preset);
    for (let open = 0; open < 3; open++) {
      assert.equal(restoreSessionToolPreset(session), preset);
    }
  }
});

test("a system loadout preserved in a compaction checkpoint is not treated as missing", () => {
  const session = manager([{ type: "compaction" }]);
  session.buildSessionContext = () => ({ messages: [{
    role: "system", content: "", toolsAdded: ["read", "bash", "edit", "write"].map((name) => ({ name })),
  }] });
  assert.equal(restoreSessionToolPreset(session), undefined);
});

test("restores a historical seven-tool full declaration on repeated opens", () => {
  const names = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const entries = [{ type: "message", message: { role: "system", content: "", toolsAdded: names.map((name) => ({ name })) } }];
  const session = manager(entries);
  const registry = [...names, "powershell"].map((name) => ({ name, sourceInfo: { source: "builtin" }, description: "" }));
  for (let open = 0; open < 2; open++) {
    const preset = restoreSessionToolPreset(session);
    assert.equal(preset, "full");
    const active = withExtensionTools(registry, getToolNamesForPreset(preset, registry));
    assert.equal(getPresetFromTools(registry.map((tool) => ({ ...tool, active: active.includes(tool.name) }))), "full");
    assert.ok(active.includes("powershell"));
  }
  assert.equal(entries.length, 1); // Reading must not silently rewrite the session.

  entries.push({ type: "message", message: { role: "system", content: "", toolsRemoved: ["grep", "find", "ls"].map((name) => ({ name })) } });
  assert.equal(restoreSessionToolPreset(session), undefined); // Pi's later default is authoritative.
  saveSessionToolPreset(session, "default");
  assert.equal(restoreSessionToolPreset(session), "default");
});

test("an explicitly saved default wins over a historical full loadout", () => {
  const names = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const session = manager([{ type: "message", message: { role: "system", content: "", toolsAdded: names.map((name) => ({ name })) } }]);
  saveSessionToolPreset(session, "default");
  assert.equal(restoreSessionToolPreset(session), "default");
  assert.equal(restoreSessionToolPreset(session), "default");
});

test("does not replace a Pi system tool declaration with legacy inference", () => {
  const entries = [assistantTool("ls"), { type: "message", message: { role: "system", content: "" } }];
  assert.equal(restoreSessionToolPreset(manager(entries)), undefined);
  saveSessionToolPreset(manager(entries), "none");
  assert.equal(restoreSessionToolPreset(manager(entries)), "none");
});
