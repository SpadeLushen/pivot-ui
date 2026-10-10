import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { mcpFormValues, buildMcpFormDefinition, isMcpWorkspaceOverride } = await jiti.import("./mcp-editor-form.ts");
const { redactMcpDefinition, restoreMcpSecrets, hasMcpSecretPlaceholder, MCP_SECRET_PLACEHOLDER: MASK } = await jiti.import("./native-mcp-editor-secrets.ts");
function fixture(raw, display = raw, scope = "global") {
  const original = redactMcpDefinition(raw), initial = mcpFormValues(redactMcpDefinition(display));
  const form = structuredClone(initial), enabled = display.enabled !== false;
  return { original, initial, form, save: (nextEnabled = enabled) =>
    buildMcpFormDefinition(original, initial, form, nextEnabled, enabled, isMcpWorkspaceOverride(scope, original)) };
}
test("new stdio form preserves individual arguments, spaces and empty values", () => {
  const f = fixture({ type: "stdio", enabled: false });
  f.form.command = "npx";
  f.form.args = ["-y", "server", "directory with spaces", ""].map((value, id) => ({ id, value }));
  assert.deepEqual(f.save(), { type: "stdio", enabled: false, command: "npx", args: ["-y", "server", "directory with spaces", ""] });
});
test("no-op saves do not materialize absent type, defaults or enabled", () => {
  const raw = { command: "server", custom: { untouched: [1, 2] } }, f = fixture(raw);
  assert.deepEqual(f.save(), raw); assert.deepEqual(f.original, raw);
});
test("streamable-http and implicit HTTP display as http without rewriting type", () => {
  for (const type of [undefined, "http", "streamable-http"]) {
    const raw = { url: "https://example.com/mcp", ...(type ? { type } : {}) }, f = fixture(raw);
    assert.equal(f.form.type, "http"); assert.deepEqual(f.save(), raw);
  }
});
test("visible edits preserve unknown nested fields, auth, OAuth and toolExposure", () => {
  const raw = { url: "https://example.com/mcp?token=private", headers: { Authorization: "private-header" },
    oauth: { clientId: "client", clientSecret: "private-oauth", extra: { token: "private-extra" } },
    auth: { provider: "example" }, toolExposure: { "get_*": "direct" }, future: { settings: [1, false, null] } };
  const f = fixture(raw); f.form.description = "Edited";
  assert.deepEqual(restoreMcpSecrets(f.save(), raw), { ...raw, description: "Edited" });
  assert.doesNotMatch(JSON.stringify(f.original), /private/);
});
test("env and headers preserve unchanged masks alongside explicit replacements", () => {
  for (const key of ["env", "headers"]) {
    const raw = { ...(key === "env" ? { command: "server" } : { url: "https://example.com" }),
      [key]: { KEEP: "private-keep", CHANGE: "private-old" } };
    const f = fixture(raw); f.form[key][1].value = "new-value";
    assert.deepEqual(restoreMcpSecrets(f.save(), raw)[key], { KEEP: "private-keep", CHANGE: "new-value" });
  }
});
test("clearing optional fields removes them but not hidden fields", () => {
  const f = fixture({ command: "server", description: "old", timeout: 12, cwd: "old", args: ["one"], env: { OLD: "private" }, hidden: 7 });
  Object.assign(f.form, { description: "", timeout: "", cwd: "", args: [], env: [] });
  assert.deepEqual(f.save(), { command: "server", hidden: 7 });
});
test("enabled and exposure edits write the requested values", () => {
  const f = fixture({ command: "server" }); f.form.exposure = "hidden";
  assert.deepEqual(f.save(false), { command: "server", enabled: false, exposure: "hidden" });
});
test("stdio to HTTP removes only listed stdio fields and retains unshown configuration", () => {
  const f = fixture({ command: "server", args: ["one"], env: { TOKEN: "private" }, cwd: ".", oauth: { scope: "read" }, toolExposure: { "*": "hidden" }, custom: 1 });
  Object.assign(f.form, { type: "http", url: "https://example.com/mcp", headers: [{ id: 0, key: "Accept", value: "application/json" }] });
  assert.deepEqual(f.save(), { type: "http", url: "https://example.com/mcp", headers: { Accept: "application/json" },
    oauth: { scope: "read" }, toolExposure: { "*": "hidden" }, custom: 1 });
});
test("HTTP to stdio retains unshown auth, OAuth and unknown fields", () => {
  const f = fixture({ url: "https://example.com", headers: { TOKEN: "private" }, auth: { provider: "example" }, oauth: { scope: "read" }, custom: 1 });
  Object.assign(f.form, { type: "stdio", command: "server" });
  assert.deepEqual(f.save(), { type: "stdio", command: "server", auth: { provider: "example" }, oauth: { scope: "read" }, custom: 1 });
});
test("sparse overrides never copy inherited connections or credentials", () => {
  const f = fixture({ toolExposure: { "read_*": "direct" } },
    { url: "https://example.com", headers: { TOKEN: "private" }, enabled: false, exposure: "codemode", description: "inherited" }, "project");
  assert.deepEqual(f.save(), { toolExposure: { "read_*": "direct" } });
  f.form.exposure = "deferred"; f.form.command = "must-not-copy";
  assert.deepEqual(f.save(true), { toolExposure: { "read_*": "direct" }, enabled: true, exposure: "deferred" });
});
test("full workspace definitions are not sparse overrides", () => {
  for (const key of ["type", "url", "command"]) assert.equal(isMcpWorkspaceOverride("project", { [key]: "" }), false);
  assert.equal(isMcpWorkspaceOverride("global", { enabled: false }), false);
});
for (const timeout of ["0", "-1", "NaN", "Infinity"]) test(`rejects invalid timeout ${timeout}`, () => {
  const f = fixture({ command: "server" }); f.form.timeout = timeout;
  assert.throws(() => f.save(), /mcp.timeoutPositive/);
});
test("fractional timeout is saved as a number", () => {
  const f = fixture({ command: "server" }); f.form.timeout = "0.5"; assert.equal(f.save().timeout, 0.5);
});
test("duplicate and empty keys cannot silently overwrite entries", () => {
  for (const keys of [["", "OTHER"], ["   "], ["SAME", "SAME"]]) {
    const f = fixture({ command: "server" }); f.form.env = keys.map((key, id) => ({ id, key, value: "value" }));
    assert.throws(() => f.save(), /mcp.invalidMappingKey/);
  }
});
test("moving a masked argument or renaming its mapping key is rejected", () => {
  const f = fixture({ command: "server", args: ["--token", "private-token"], env: { TOKEN: "private-env" } });
  f.form.args.shift(); assert.throws(() => f.save(), /mcp.movedSecret/);
  f.form.args = structuredClone(f.initial.args); f.form.env[0].key = "RENAMED";
  assert.throws(() => f.save(), /mcp.movedSecret/);
  f.form.env[0].value = "replacement"; assert.deepEqual(f.save().env, { RENAMED: "replacement" });
});
test("Force OAuth opt-in writes only a native empty OAuth object", () => {
  const f = fixture({ url: "https://example.com", headers: { "X-Key": "private" }, custom: 1 });
  f.form.oauth = true;
  assert.deepEqual(restoreMcpSecrets(f.save(), { url: "https://example.com", headers: { "X-Key": "private" } }),
    { url: "https://example.com", headers: { "X-Key": "private" }, custom: 1, oauth: {} });
});
test("only empty OAuth markers can be removed; configured client secrets survive edits", () => {
  const empty = fixture({ url: "https://example.com", oauth: {} }); empty.form.oauth = false;
  assert.deepEqual(empty.save(), { url: "https://example.com" });
  const f = fixture({ url: "https://example.com", oauth: { clientSecret: "private", scope: "read" } });
  assert.equal(f.form.oauthSettings, true); f.form.oauth = false;
  assert.throws(() => f.save(), /mcp.oauthSettingsPresent/);
});
test("sparse workspace edits never materialize inherited OAuth settings", () => {
  const f = fixture({ enabled: false }, { url: "https://example.com", oauth: {} }, "project");
  f.form.oauth = false;
  assert.deepEqual(f.save(), { enabled: false });
});
test("masked-value detection follows nested values rather than metadata keys or substrings", () => {
  assert.equal(hasMcpSecretPlaceholder({ oauth: { clientSecret: MASK } }), true);
  assert.equal(hasMcpSecretPlaceholder([null, { value: MASK }]), true);
  for (const value of [null, undefined, false, [], {}, { [MASK]: "public" }, MASK + "-literal"])
    assert.equal(hasMcpSecretPlaceholder(value), false);
});
test("mask strings cannot introduce a new credential", () => {
  const f = fixture({ command: "server" }); f.form.env = [{ id: 0, key: "TOKEN", value: MASK }];
  assert.throws(() => f.save(), /mcp.movedSecret/);
});
