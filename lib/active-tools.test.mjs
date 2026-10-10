import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { activateAllSessionTools } = await createJiti(import.meta.url).import("./active-tools.ts");

function fixture(active = []) {
  const tools = [
    { name: "read", sourceInfo: { source: "builtin" } },
    { name: "adapter", sourceInfo: { source: "extension" } },
    { name: "withdrawn", sourceInfo: { source: "extension" }, exposure: "hidden" },
  ];
  const calls = [];
  return { tools, calls, sessionManager: { getCwd: () => process.cwd() }, settingsManager: { isProjectTrusted: () => false },
    getToolDefinition: (name) => tools.find((tool) => tool.name === name), getAllTools: () => tools, getActiveToolNames: () => active,
    setActiveToolsByName: (names) => { calls.push(names); active = names; } };
}

test("all available built-in and extension tools replace an empty loadout", () => {
  const session = fixture();
  activateAllSessionTools(session);
  assert.deepEqual(session.getActiveToolNames(), ["read", "adapter"]);
});

test("equivalent active sets are not rewritten", () => {
  const session = fixture(["adapter", "read"]);
  activateAllSessionTools(session);
  assert.deepEqual(session.calls, []);
});

test("new tools are activated and withdrawn tools stay hidden", () => {
  const session = fixture(["read", "adapter", "withdrawn"]);
  session.tools.push({ name: "new_builtin", sourceInfo: { source: "builtin" } });
  activateAllSessionTools(session);
  assert.deepEqual(session.getActiveToolNames(), ["read", "adapter", "new_builtin"]);
});
