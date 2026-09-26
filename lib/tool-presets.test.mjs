import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getPresetFromTools, getToolNamesForPreset, withExtensionTools, PRESET_DEFAULT } = await jiti.import("./tool-presets.ts");
const { restoreSessionToolPreset } = await jiti.import("./session-tool-preset.ts");
const builtin = (name, active = true) => ({ name, description: "", active, sourceInfo: { source: "builtin" } });
const extension = (name, active = true) => ({ name, description: "", active, sourceInfo: { source: "package" } });

const tools = [...PRESET_DEFAULT.map((name) => builtin(name)), builtin("grep"), builtin("powershell"), builtin("future"), extension("extra"), { name: "unknown", sourceInfo: undefined }];

test("full selects every SDK built-in, including newly added tools", () => {
  assert.deepEqual(getToolNamesForPreset("full", tools), [...PRESET_DEFAULT, "grep", "powershell", "future"]);
  assert.deepEqual(getToolNamesForPreset("default", tools), PRESET_DEFAULT);
  assert.deepEqual(getToolNamesForPreset("none", tools), []);
  assert.deepEqual(withExtensionTools(tools, getToolNamesForPreset("full", tools)), [...PRESET_DEFAULT, "grep", "powershell", "future", "extra"]);
  assert.deepEqual(withExtensionTools(tools, getToolNamesForPreset("default", tools)), [...PRESET_DEFAULT, "extra"]);
  assert.deepEqual(withExtensionTools(tools, getToolNamesForPreset("none", tools)), []);
  assert.deepEqual(withExtensionTools([extension("extra")], getToolNamesForPreset("full", [extension("extra")]), true), ["extra"]);
});

test("restoring a saved full preset includes new SDK built-ins", () => {
  const manager = { getBranch: () => [{ type: "custom", customType: "pivot-ui:tool-preset", data: { preset: "full" } }] };
  assert.deepEqual(getToolNamesForPreset(restoreSessionToolPreset(manager), tools), [...PRESET_DEFAULT, "grep", "powershell", "future"]);
});

test("preset inference treats any built-in beyond default as full, without requiring every available built-in", () => {
  assert.equal(getPresetFromTools(tools.filter((tool) => tool.sourceInfo)), "full");
  assert.equal(getPresetFromTools(tools.map((tool) => ({ ...tool, active: PRESET_DEFAULT.includes(tool.name) || tool.name === "grep" }))), "full");
  assert.equal(getPresetFromTools(tools.map((tool) => ({ ...tool, active: PRESET_DEFAULT.includes(tool.name) || tool.name === "powershell" }))), "full");
  assert.equal(getPresetFromTools(tools.map((tool) => ({ ...tool, active: PRESET_DEFAULT.includes(tool.name) || tool.name === "extra" }))), "default");
  assert.equal(getPresetFromTools(tools.map((tool) => ({ ...tool, active: false }))), "none");
  assert.equal(getPresetFromTools([...PRESET_DEFAULT.map((name) => builtin(name)), extension("grep")]), "default");
});
