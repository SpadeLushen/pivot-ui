import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("../app/api/sessions/[id]/export/route.ts");
const { cacheSessionPath } = await jiti.import("./session-reader.ts");

test("SDK file export retains generic tool results and patches a deep session tree", { timeout: 45000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "pivot-export-102-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir);
  for (let i = 0; i < 5100; i++) manager.appendMessage({ role: "user", content: `deep message ${i}`, timestamp: i });
  manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "local", model: "stub",
    content: [{ type: "toolCall", id: "call1", name: "historical_adapter_tool", arguments: {} }],
    stopReason: "toolUse", timestamp: 6000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendMessage({ role: "toolResult", toolCallId: "call1", toolName: "historical_adapter_tool",
    content: [{ type: "text", text: "retained generic result" }], isError: false, timestamp: 6001 });
  cacheSessionPath(manager.getSessionId(), manager.getSessionFile());
  const response = await GET(new Request("http://localhost/export"), { params: Promise.resolve({ id: manager.getSessionId() }) });
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
  const html = await response.text();
  const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
  assert.ok(encoded, "export must embed its session data");
  const data = JSON.parse(Buffer.from(encoded[1], "base64").toString("utf8"));
  assert.equal(data.entries.filter((entry) => entry.type === "message").length, 5102);
  assert.ok(data.entries.some((entry) => entry.message?.content === "deep message 5099"));
  assert.ok(data.entries.some((entry) => entry.message?.content?.[0]?.text === "retained generic result"));
  assert.ok(html.includes("// Post-order traversal using two stacks"));
  assert.ok(!html.includes("node.children.forEach(sortChildren)"));
  const definitions = ["sortChildren", "markActive"].map((name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing ${name}`);
    let braces = 0;
    for (let i = html.indexOf("{", start); i < html.length; i++) {
      if (html[i] === "{") braces++;
      if (html[i] === "}" && --braces === 0) return html.slice(start, i + 1);
    }
    throw new Error(`Missing end of ${name}`);
  }).join("\n");
  const mappingStart = html.indexOf("const stack = [...tree].reverse();");
  assert.ok(mappingStart >= 0);
  const mappingEnd = html.indexOf("\n          }", mappingStart) + "\n          }".length;
  const mapping = html.slice(mappingStart, mappingEnd);
  let root = { entry: { id: "leaf", timestamp: 0 }, children: [] };
  for (let i = 0; i < 5100; i++) root = { entry: { id: String(i), timestamp: i }, children: [root] };
  const nodes = new Map();
  const active = new Map();
  const run = new Function("treeNodeMap", "containsActive", "activePathIds", "root", "tree",
    `${definitions}\nsortChildren(root); markActive(root); ${mapping}`);
  assert.doesNotThrow(() => run(nodes, active, new Set(["leaf"]), root, [root]));
  assert.equal(nodes.size, 5101);
  assert.equal(active.get(root), true);
});
