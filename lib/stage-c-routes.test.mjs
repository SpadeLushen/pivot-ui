import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const stats = await jiti.import("../app/api/sessions/[id]/stats/route.ts");
const image = await jiti.import("../app/api/sessions/[id]/entries/[entryId]/images/[blockIndex]/route.ts");
const trust = await jiti.import("../app/api/workspace-trust/route.ts");
const { cacheSessionPath } = await jiti.import("./session-reader.ts");
const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
const { imageSource } = await jiti.import("./message-images.ts");
const { collectActiveNativeMcpServers } = await jiti.import("./workspace-packs.ts");
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pivot-c-routes-")), cwd = path.join(root, "work");
  await mkdir(path.join(cwd, ".pi"), { recursive: true }); allowFileRoot(cwd);
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  await writeFile(path.join(root, "settings.json"), '{"defaultProjectTrust":"never"}');
  t.after(async () => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(root, { recursive: true, force: true }); });
  const sm = SessionManager.create(cwd, path.join(root, "sessions"));
  sm.appendMessage({ role: "user", content: "hello", timestamp: 1 });
  sm.appendMessage({ role: "assistant", content: [], timestamp: 2, provider: "fixture", model: "local", api: "test",
    usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, stopReason: "stop" });
  cacheSessionPath(sm.getSessionId(), sm.getSessionFile());
  return { root, cwd, sm };
}

test("C4 history stats API is read-only, no-store and rejects unknown leaves", async t => {
  const { sm } = await fixture(t), file = sm.getSessionFile(), before = await readFile(file, "utf8");
  const running = globalThis.__piSessions?.size ?? 0, params = Promise.resolve({ id: sm.getSessionId() });
  const response = await stats.GET(new Request("http://localhost/stats"), { params });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.accounting.source, "history");
  assert.equal(data.accounting.full.costRecords, 1); assert.equal(data.cost, 0);
  assert.equal(globalThis.__piSessions?.size ?? 0, running);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await stats.GET(new Request("http://localhost/stats?leafId=missing"), { params })).status, 404);
});
test("C3 trust GET never grants; saved deny overrides global allow and only explicit POST grants", async t => {
  const { root, cwd } = await fixture(t), url = "http://localhost/trust?cwd=" + encodeURIComponent(cwd);
  assert.equal((await (await trust.GET(new Request(url))).json()).trusted, false);
  assert.equal(new ProjectTrustStore(root).get(cwd), null);
  new ProjectTrustStore(root).set(cwd, false);
  await writeFile(path.join(root, "settings.json"), '{"defaultProjectTrust":"always"}');
  assert.equal((await (await trust.GET(new Request(url))).json()).trusted, false);
  const post = body => trust.POST(new Request(url, { method: "POST", body: JSON.stringify(body) }));
  assert.equal((await post({ cwd })).status, 400);
  assert.equal((await post({ cwd, trusted: true })).status, 200);
  assert.equal((await (await trust.GET(new Request(url))).json()).trusted, true);
});

test("C1 image API verifies session entry, tool identity, index and MIME without rewriting history", async t => {
  const { sm } = await fixture(t);
  const entryId = sm.appendMessage({ role: "toolResult", toolCallId: "parent", timestamp: 3, content: [
    { type: "image", data: "aGk=", mimeType: "image/png" },
    { type: "image", data: "aGk=", mimeType: "text/html" },
    { type: "image", data: "%%%=", mimeType: "image/png" }] });
  const file = sm.getSessionFile(), before = await readFile(file, "utf8");
  const get = (index, id = "parent") => image.GET(new Request("http://localhost/image?toolCallId=" + id), {
    params: Promise.resolve({ id: sm.getSessionId(), entryId, blockIndex: String(index) }) });
  const response = await get(0); assert.equal(response.status, 200);
  assert.equal(await response.text(), "hi"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await get(0, "wrong")).status, 404); assert.equal((await get(-1)).status, 400);
  assert.equal((await get(1)).status, 422); assert.equal((await get(2)).status, 422);
  assert.equal(await readFile(file, "utf8"), before);
});
test("C1 display image sources reject executable, file, network-relative and unsafe MIME URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///private.png", "//remote/image.png", "/\\remote", "data:text/html;base64,eA=="]) {
    assert.equal(imageSource({ type: "image", source: { type: "url", url } }), "");
  }
  assert.equal(imageSource({ type: "image", data: "aA==", mimeType: "text/html" }), "");
  assert.equal(imageSource({ type: "image", data: "aA==", mimeType: "image/png" }), "data:image/png;base64,aA==");
});

test("C3 Pack ownership uses active receipts, not disabled packs or historical ledgers", () => {
  const applied = (packId, nativeMcpServers) => ({ packId, receipt: { nativeMcpServers } });
  const config = { packs: [{ id: "legacy", nativeMcpServers: ["legacy-native"] },
    { id: "empty", nativeMcpServers: ["not-owned"] }, { id: "off", nativeMcpServers: ["disabled"] }] };
  const state = { appliedPacks: [applied("active", ["shared"]), applied("legacy"), applied("empty", [])],
    disabledPacks: [applied("off", ["disabled"])], managedNativeMcpServers: ["historical"] };
  assert.deepEqual([...collectActiveNativeMcpServers(state, config)].sort(), ["legacy-native", "shared"]);
  state.appliedPacks = [];
  assert.equal(collectActiveNativeMcpServers(state, config).size, 0);
});

