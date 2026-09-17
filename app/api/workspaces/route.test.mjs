import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { PATCH } = route;
const request = (method, body) => new Request("http://localhost/api/workspaces", { method, headers: { "Content-Type": "application/json" }, body });

test("workspace API rejects malformed JSON and invalid metadata before any write", async () => {
  for (const body of ["invalid", "null", '{"path":"relative"}', '{"path":"/a","removed":1}', '{"path":"/a","tag":null}']) {
    const response = await PATCH(request("PATCH", body));
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
});

test("workspace API has no legacy import endpoint and rejects batch imports", async () => {
  assert.equal(route.POST, undefined);
  const response = await PATCH(request("PATCH", '[{"path":"/legacy","removed":true}]'));
  assert.equal(response.status, 400);
});
